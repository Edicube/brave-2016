/* global WebSocket */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// End to end checks for the security properties this browser claims, run
// against the real app over the DevTools protocol.
//
//   npm run e2e              offline checks
//   npm run e2e -- --network also the ones that need the internet
//   npm run e2e -- --show    with the window visible, to watch it
//
// Runs on a throwaway profile (BRAVE_PROFILE_DIR), so it can run while the
// browser is open. Filter engines are copied in from the real profile when
// present, so the blocking checks do not have to download anything.

const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const fixtures = path.join(root, 'test', 'e2e', 'fixtures')
const network = process.argv.includes('--network')
const debugPort = 9500 + Math.floor(Math.random() * 400)
const pagePort = 18900 + Math.floor(Math.random() * 400)

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const results = []
let log = ''

// --- fixtures ---------------------------------------------------------------

const crossSiteHeaders = []

function serveFixtures () {
  const pages = http.createServer((req, res) => {
    const file = path.join(fixtures, path.normalize(req.url.split('?')[0]).replace(/^(\.\.[/\\])+/, ''))
    if (!file.startsWith(fixtures) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    fs.createReadStream(file).pipe(res)
  }).listen(pagePort, '127.0.0.1')

  // the "other site": records what it was sent, and tries to set a cookie
  const other = http.createServer((req, res) => {
    crossSiteHeaders.push({ referer: req.headers.referer, cookie: req.headers.cookie })
    res.writeHead(200, { 'Content-Type': 'image/png', 'Set-Cookie': 'tracker=1; Path=/' })
    res.end()
  }).listen(pagePort + 1, '127.0.0.1')

  return [pages, other]
}

// --- DevTools ---------------------------------------------------------------

async function targets () {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
  return res.json()
}

async function evaluate (type, expression) {
  const target = (await targets()).find(t => t.type === type)
  if (!target) {
    throw new Error(`no ${type} target`)
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('evaluate timed out')), 10000)
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id === 1) {
        clearTimeout(timer)
        resolve(msg.result)
      }
    }
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true }
    }))
  })
  ws.close()
  if (result.exceptionDetails) {
    throw new Error((result.exceptionDetails.exception || {}).description || 'threw')
  }
  return result.result.value
}

// The most recently started renderer under the browser process: the UI's
// renderer comes up first, so with one tab open this is the tab's.
function newestRenderer (browserPid) {
  let rows
  try {
    rows = require('child_process').execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
  } catch (e) {
    return null
  }
  const procs = rows.trim().split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    return m && { pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }
  }).filter(Boolean)
  const byPid = new Map(procs.map(p => [p.pid, p]))
  const descends = (p) => {
    for (let q = p; q; q = byPid.get(q.ppid)) {
      if (q.ppid === browserPid) return true
    }
    return false
  }
  const renderers = procs.filter(p => /--type=renderer/.test(p.args) && descends(p))
    .map(p => ({ pid: p.pid, id: Number((p.args.match(/renderer-client-id=(\d+)/) || [])[1]) }))
    .sort((a, b) => b.id - a.id)
  return renderers.length > 1 ? renderers[0].pid : null
}

// the app's own action path, as the menu uses it
const setProtection = (resourceName, enabled) => evaluate('page',
  `window.braveBridge.send('app-action', ${JSON.stringify({
    actionType: 'app-set-resource-enabled', resourceName, enabled
  })}), 'ok'`)

let expectedCrashes = 0

const ui = (expr) => evaluate('page', expr)
const web = (expr) => evaluate('webview', expr)
const navigate = (target) => ui(`document.querySelector('webview').src = ${JSON.stringify(target)}, 'ok'`)

async function waitFor (fn, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      if (await fn()) {
        return true
      }
    } catch (e) {}
    await sleep(300)
  }
  return false
}

// --- checks -----------------------------------------------------------------

async function check (name, fn) {
  try {
    const outcome = await fn()
    if (outcome === 'skip') {
      results.push({ name, status: 'skip' })
    } else {
      results.push({ name, status: outcome ? 'pass' : 'FAIL' })
    }
  } catch (e) {
    results.push({ name, status: 'FAIL', why: e.message })
  }
}

const page = `http://127.0.0.1:${pagePort}/deep/page.html`

const other = `http://127.0.0.1:${pagePort}/other.html`
const webviews = () => ui("document.querySelectorAll('webview').length")
const tabUrl = async () => {
  const t = (await targets()).filter(x => x.type === 'webview')
  return t.length === 1 ? t[0].url : null
}
const shortcut = (channel, ...args) =>
  ui(`window.braveBridge.sendToSelf(${[channel, ...args].map(a => JSON.stringify(a)).join(', ')}), 'ok'`)

// Ordinary browsing, through the app's own action paths. Runs first, while
// there is one tab, and leaves the browser back on the fixture page.
async function functional () {
  await check('typing an address in the URL bar navigates', async () => {
    await ui(`(function () {
      var input = document.getElementById('urlInput')
      input.focus()
      var set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, ${JSON.stringify(other)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 13, which: 13, key: 'Enter' }))
      return 1 })()`)
    return waitFor(async () => (await tabUrl()) === other, 8000)
  })

  await check('back and forward', async () => {
    // let the previous navigation finish committing before walking history
    const settled = () => waitFor(async () => (await web('document.readyState')) === 'complete', 8000)
    const go = async (channel, want) => {
      await settled()
      await shortcut(channel)
      return waitFor(async () => (await tabUrl()) === want, 8000)
    }
    const back = await go('shortcut-active-frame-back', page)
    const forward = await go('shortcut-active-frame-forward', other)
    return back && forward
  })

  await check('find in page opens the find bar', async () => {
    await shortcut('shortcut-active-frame-show-findbar')
    return waitFor(async () => (await ui("!!document.querySelector('.findBar')")) === true, 5000)
  })

  await check('bookmarking marks the page as bookmarked', async () => {
    await shortcut('shortcut-active-frame-bookmark')
    const on = await waitFor(async () =>
      (await ui("document.getElementById('navigator').classList.contains('bookmarked')")) === true, 5000)
    await shortcut('shortcut-active-frame-remove-bookmark')
    const off = await waitFor(async () =>
      (await ui("document.getElementById('navigator').classList.contains('bookmarked')")) === false, 5000)
    return on && off
  })

  await check('the site info panel opens and lists what was blocked', async () => {
    await navigate(page)
    await waitFor(async () => (await tabUrl()) === page, 8000)
    await ui("document.querySelector('.urlbarIcon').click(), 1")
    const open = await waitFor(async () => (await ui("!!document.querySelector('.siteInfo')")) === true, 5000)
    // close it again so it does not cover later checks
    await ui("document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, bubbles: true })), 1")
    return open
  })

  await check('opening and closing a tab', async () => {
    const before = await webviews()
    await shortcut('shortcut-new-frame', page)
    const opened = await waitFor(async () => (await webviews()) === before + 1, 5000)
    await shortcut('shortcut-close-frame')
    const closed = await waitFor(async () => (await webviews()) === before, 5000)
    return opened && closed
  })

  // back to where the security checks expect to start
  await navigate(page)
  await waitFor(async () => (await tabUrl()) === page &&
    (await web('typeof window.probe')) === 'function', 8000)
}

async function run () {
  await functional()

  await check('UI is served from brave://ui', async () =>
    (await ui('location.origin')) === 'brave://ui')

  await check('app state is not carried in the UI URL', async () =>
    (await ui('location.search')) === '')

  await check('UI window has no node', async () => {
    const r = JSON.parse(await ui(`JSON.stringify([typeof window.require, typeof window.module,
      typeof window.global, typeof window.Buffer])`))
    return r.every(t => t === 'undefined')
  })

  await check('web page has no node and no bridge', async () => {
    const r = JSON.parse(await web(`JSON.stringify([typeof require, typeof process,
      typeof module, typeof window.braveBridge])`))
    return r.every(t => t === 'undefined')
  })

  await check('UI cannot read the disk', async () =>
    (await ui("fetch('file:///etc/passwd').then(() => 'read').catch(() => 'refused')")) === 'refused')

  await check('bridge refuses channels outside the allowlist', async () =>
    (await ui(`(function () {
      try { window.braveBridge.send('not-a-channel'); return 'sent' } catch (e) {}
      try { window.braveBridge.sendToSelf('bridge-download-url', 'x'); return 'sent' } catch (e) {}
      return 'refused' })()`)) === 'refused')

  await check('permissions are denied', async () =>
    (await web(`navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => 'granted').catch(() => 'denied')`)) === 'denied')

  await check('cross-site referrer trimmed, third-party cookie not sent', async () => {
    await web('location.reload(), 1')
    await waitFor(async () => crossSiteHeaders.length >= 2, 8000)
    const last = crossSiteHeaders[crossSiteHeaders.length - 1]
    return !!last && last.referer === `http://127.0.0.1:${pagePort}/` && !last.cookie
  })

  await check('ads and trackers are blocked', async () => {
    const ok = await waitFor(async () => /\[(adblock|trackingProtection)\] blocked/.test(log), 45000)
    return ok || (hasEngines ? false : 'skip')
  })

  await check('window.open refuses javascript:, data: and brave://', async () => {
    await waitFor(async () => (await web('typeof window.probe')) === 'function', 8000)
    const before = await ui("document.querySelectorAll('webview').length")
    for (const target of ['javascript:alert(1)', 'data:text/html,x', 'brave://ui/index.html']) {
      await web(`window.probe(${JSON.stringify(target)})`)
    }
    await sleep(1500)
    return (await ui("document.querySelectorAll('webview').length")) === before
  })

  await check('file: is refused even through webview src', async () => {
    await navigate('file:///etc/passwd')
    await sleep(2500)
    const body = await web("document.body ? document.body.innerText : ''").catch(() => '')
    return !/root:/.test(body)
  })

  await check('phishing URL gets the warning page', async () => {
    if (!/\[phishing\] blocklist ready/.test(log) &&
        !(await waitFor(async () => /\[phishing\] blocklist ready/.test(log), 45000))) {
      return 'skip'
    }
    await navigate('https://0.gravatar.com/avatar/3c6ecd4e90b1931cfcc710e4ce1b1580eba333f2929ea117201c6d70e9c03ddb')
    const shown = await waitFor(async () =>
      (await web("(document.querySelector('h1') || {}).textContent")) === 'This site was blocked', 8000)
    // and it says which rule matched
    return shown && /matched rule:/.test(await web("document.getElementById('why').textContent"))
  })

  if (network) {
    await networkChecks()
  }

  await check('a page cannot open brave://ui by itself', async () => {
    await navigate(page)
    await waitFor(async () => (await tabUrl()) === page, 8000)
    await web("location.href = 'brave://ui/blocked.html#%7B%22reason%22%3A%22phishing%22%7D', 1")
    await sleep(2000)
    return (await tabUrl()) === page
  })

  await check('a crashed tab shows a page with a reload button', async () => {
    // Electron ignores Page.crash and chrome://crash, so crash it the way the
    // kernel would: kill the tab's renderer process outright.
    const tabRenderer = newestRenderer(current.pid)
    if (!tabRenderer) {
      return 'skip'
    }
    expectedCrashes++
    process.kill(tabRenderer, 'SIGKILL')
    const shown = await waitFor(async () =>
      (await web("(document.querySelector('h1') || {}).textContent")) === 'This page crashed', 10000)
    if (!shown) {
      return false
    }
    await web("document.getElementById('action').click(), 1")
    return waitFor(async () => (await tabUrl()) === page, 8000)
  })

  await check('window.open of an http page opens a tab', async () => {
    await navigate(page)
    await waitFor(async () => (await web('typeof window.probe')) === 'function', 8000)
    const before = await ui("document.querySelectorAll('webview').length")
    await web(`window.probe(${JSON.stringify(`http://127.0.0.1:${pagePort}/other.html`)})`)
    return waitFor(async () =>
      (await ui("document.querySelectorAll('webview').length")) === before + 1, 5000)
  })
}

async function networkChecks () {
  await check('[network] HTTPS-only refuses a site without HTTPS', async () => {
    await setProtection('httpsOnly', true)
    try {
      await navigate('http://neverssl.com/')
      return await waitFor(async () =>
        (await web("(document.querySelector('h1') || {}).textContent")) ===
          'This site does not offer a secure connection', 20000)
    } finally {
      await setProtection('httpsOnly', false)
    }
  })

  await check('[network] URL bar suggestions: arrow down and enter opens one', async () => {
    await ui(`(function () {
      var input = document.getElementById('urlInput')
      input.focus()
      var set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, 'wikipedia')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 1 })()`)
    const shown = await waitFor(async () =>
      (await ui("document.querySelectorAll('.urlBarSuggestions li').length")) > 0, 5000)
    // separate keystrokes, as a person makes them: React batches updates
    // within one task, so Enter in the same tick would not yet see the selection
    const key = (code, name) => ui(`document.getElementById('urlInput').dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, keyCode: ${code}, which: ${code}, key: '${name}' })), 1`)
    await key(40, 'ArrowDown')
    await waitFor(async () => (await ui("!!document.querySelector('.urlBarSuggestions li.selected')")) === true, 3000)
    await key(13, 'Enter')
    const went = await waitFor(async () => /wikipedia\.org/.test((await tabUrl()) || ''), 15000)
    return shown && went
  })

  await check('[network] cosmetic filters hide ad containers', async () => {
    // the engine has no cosmetic rules for bare IP hosts, so this needs a
    // real domain; the rule used is a generic one that applies on any site
    await navigate('https://example.com/')
    await waitFor(async () => (await web('location.host')) === 'example.com', 15000)
    return waitFor(async () => (await web(`(function () {
      var el = document.createElement('div')
      el.setAttribute('data-ad-cls', 'x')
      document.body.appendChild(el)
      var d = getComputedStyle(el).display
      el.remove()
      return d === 'none'
    })()`)), 10000)
  })

  await check('[network] http is upgraded to https', async () => {
    await navigate('http://en.wikipedia.org/wiki/HTTPS')
    return waitFor(async () => (await web('location.protocol')) === 'https:', 15000)
  })

  await check('[network] bad certificate shows the warning page', async () => {
    await navigate('https://expired.badssl.com/')
    return waitFor(async () =>
      (await web("(document.querySelector('h1') || {}).textContent")) === 'This connection is not private', 15000)
  })
}

// --- harness ----------------------------------------------------------------

let hasEngines = false
let current = null

function launch (profile) {
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron')
  const child = spawn(electron, [root, `--remote-debugging-port=${debugPort}`, page], {
    env: Object.assign({}, process.env, {
      BRAVE_DEBUG: '1',
      BRAVE_PROFILE_DIR: profile,
      // the browser exits by itself if this script dies without cleaning up
      BRAVE_PARENT_PID: String(process.pid),
      // refuse instead of opening a prompt nobody is there to answer
      BRAVE_DENY_PERMISSIONS: '1',
      // no window flashing through test pages on your screen
      BRAVE_HIDDEN: process.argv.includes('--show') ? '' : '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  current = child
  return child
}

// Runs last: needs a real quit and a second start on the same profile
async function clearOnExitCheck (child, profile) {
  await check('clear site data on exit removes cookies', async () => {
    while ((await webviews()) > 1) {
      await shortcut('shortcut-close-frame')
      await sleep(500)
    }
    await navigate(page)
    await waitFor(async () => (await tabUrl()) === page, 8000)
    await web("document.cookie = 'e2e=kept; max-age=3600; path=/', 1")
    if (!/e2e=kept/.test(await web('document.cookie'))) {
      return false
    }
    await setProtection('clearOnExit', true)
    await sleep(500)

    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    await Promise.race([exited, sleep(15000)])
    const cleared = /\[clearOnExit\] site data cleared/.test(log)

    launch(profile)
    const up = await waitFor(async () =>
      (await targets()).some(t => t.type === 'webview' && t.url.startsWith(page)), 30000)
    if (!up) {
      return false
    }
    // the restored session may bring back other tabs, so read this one by URL
    let cookie = null
    await waitFor(async () => {
      const target = (await targets()).find(t => t.type === 'webview' && t.url.startsWith(page))
      if (!target) {
        return false
      }
      const ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
      const value = await new Promise(resolve => {
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.id === 1) {
            resolve(m.result && m.result.result ? m.result.result.value : null)
          }
        }
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.cookie', returnByValue: true } }))
      })
      ws.close()
      cookie = value
      return typeof value === 'string'
    }, 10000)
    return cleared && !/e2e=kept/.test(cookie || '')
  })
}

async function main () {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brave-e2e-'))
  const realProfile = path.join(os.homedir(), '.config', 'brave')
  for (const name of ['adblock-engine.dat', 'trackingProtection-engine.dat', 'phishing-engine.dat']) {
    const src = path.join(realProfile, name)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(profile, name))
      hasEngines = true
    }
  }

  const servers = serveFixtures()
  const child = launch(profile)

  let exitCode = 1
  try {
    const up = await waitFor(async () =>
      (await targets()).some(t => t.type === 'webview' && t.url.startsWith(page)), 30000)
    if (!up) {
      throw new Error('the browser did not come up\n' + log.slice(-2000))
    }
    await sleep(1500)
    await run()

    await clearOnExitCheck(child, profile)

    const crashes = (log.match(/render process gone/g) || []).length
    const uncaught = (log.match(/Uncaught|preload error|Warning: /g) || []).length +
      Math.max(0, crashes - expectedCrashes)
    results.push({ name: 'no uncaught errors, React warnings or crashed renderers', status: uncaught ? 'FAIL' : 'pass' })
    if (uncaught) {
      log.split('\n').filter(l => /Uncaught|preload error|Warning: |render process gone|could not send/.test(l))
        .slice(0, 10).forEach(l => console.log('    > ' + l.slice(0, 220)))
    }

    for (const r of results) {
      console.log(`  ${r.status.padEnd(4)}  ${r.name}${r.why ? '  (' + r.why + ')' : ''}`)
    }
    const failed = results.filter(r => r.status === 'FAIL').length
    const skipped = results.filter(r => r.status === 'skip').length
    console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`)
    exitCode = failed ? 1 : 0
  } catch (e) {
    console.error(e.message)
  } finally {
    (current || child).kill('SIGKILL')
    servers.forEach(s => s.close())
    fs.rmSync(profile, { recursive: true, force: true })
  }
  process.exit(exitCode)
}

// a bug in this script must not leave a browser behind either
process.on('uncaughtException', (e) => {
  console.error(e)
  if (current) {
    current.kill('SIGKILL')
  }
  process.exit(1)
})

// Ctrl+C or a timeout: take the browser down too
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (current) {
      current.kill('SIGKILL')
    }
    process.exit(130)
  })
}

main()
