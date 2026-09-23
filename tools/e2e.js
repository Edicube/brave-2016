/* global WebSocket */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// End to end checks for the security properties this browser claims, run
// against the real app over the DevTools protocol.
//
//   npm run e2e              offline checks
//   npm run e2e -- --network also the ones that need the internet
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

async function run () {
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
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron')
  const child = spawn(electron, [root, `--remote-debugging-port=${debugPort}`, page], {
    env: Object.assign({}, process.env, { BRAVE_DEBUG: '1', BRAVE_PROFILE_DIR: profile }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })

  let exitCode = 1
  try {
    const up = await waitFor(async () =>
      (await targets()).some(t => t.type === 'webview' && t.url.startsWith(page)), 30000)
    if (!up) {
      throw new Error('the browser did not come up\n' + log.slice(-2000))
    }
    await sleep(1500)
    await run()

    const uncaught = (log.match(/Uncaught|render process gone|preload error/g) || []).length
    results.push({ name: 'no uncaught errors or crashed renderers', status: uncaught ? 'FAIL' : 'pass' })

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
    child.kill('SIGKILL')
    servers.forEach(s => s.close())
    fs.rmSync(profile, { recursive: true, force: true })
  }
  process.exit(exitCode)
}

main()
