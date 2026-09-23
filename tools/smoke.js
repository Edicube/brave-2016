/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Starts a packaged build and checks that it gets as far as showing its UI
// and a page, then shuts it down. Run in CI on Linux, macOS and Windows: on
// the last two Electron also verifies the ASAR archive's integrity at startup,
// and a build that gets that wrong refuses to start at all.
//
//   node tools/smoke.js            the build in dist/ for this platform
//   node tools/smoke.js <binary>

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { binaryIn } = require('./package')

const root = path.join(__dirname, '..')
const arch = process.arch
const dist = path.join(root, 'dist', `Brave 2016-${process.platform}-${arch}`)
let binary = process.argv[2] || binaryIn(dist)
if (process.platform === 'darwin' && binary.endsWith('.app')) {
  binary = path.join(binary, 'Contents', 'MacOS', 'Brave 2016')
}

const port = 9700 + Math.floor(Math.random() * 200)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function main () {
  if (!fs.existsSync(binary)) {
    console.error('no packaged build at', binary)
    process.exit(1)
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brave-smoke-'))
  const child = spawn(binary, [`--remote-debugging-port=${port}`, 'https://example.com'], {
    env: Object.assign({}, process.env, {
      BRAVE_PROFILE_DIR: profile,
      BRAVE_HIDDEN: '1',
      // so a failure says why
      BRAVE_DEBUG: '1',
      BRAVE_PARENT_PID: String(process.pid)
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  const state = { exited: null }
  child.on('exit', (code) => { state.exited = code })

  let ok = false
  const until = Date.now() + 90000
  while (Date.now() < until && state.exited === null) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const ui = targets.some(t => t.type === 'page' && t.url.startsWith('brave://ui/'))
      const tab = targets.some(t => t.type === 'webview')
      if (ui && tab) {
        ok = true
        break
      }
    } catch (e) {}
    await sleep(500)
  }

  child.kill()
  await sleep(1000)
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch (e) {}

  if (ok) {
    console.log(`ok: ${path.basename(binary)} started and showed its UI and a tab`)
    process.exit(0)
  }
  console.error(state.exited !== null
    ? `the build exited early (code ${state.exited})`
    : 'the build did not show its UI within 90s')
  console.error(log.slice(-3000))
  process.exit(1)
}

main()
