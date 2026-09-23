/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// There is no working auto-updater, so the thing most likely to make this
// browser unsafe is simply time passing. This turns "remember to check" into
// one command: is the Electron major still receiving security fixes, are the
// fuses still set, and does npm know about any advisories.

const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const binary = path.join(root, 'node_modules', 'electron', 'dist', 'electron')

let problems = 0
const ok = (msg) => console.log(`  ok      ${msg}`)
const warn = (msg) => { problems++; console.log(`  ATTENTION  ${msg}`) }

function installedElectronMajor () {
  const version = fs.readFileSync(
    path.join(root, 'node_modules', 'electron', 'dist', 'version'), 'utf8').trim()
  return { version, major: parseInt(version.split('.')[0], 10) }
}

async function checkElectron () {
  const { version, major } = installedElectronMajor()
  let latest
  try {
    const res = await fetch('https://registry.npmjs.org/electron')
    const meta = await res.json()
    latest = parseInt(meta['dist-tags'].latest.split('.')[0], 10)
  } catch (e) {
    warn(`Electron ${version} installed; could not reach npm to check whether it is still supported`)
    return
  }

  // Electron supports the latest three stable majors
  const oldestSupported = latest - 2
  if (major >= oldestSupported) {
    ok(`Electron ${version} is a supported major (${oldestSupported}-${latest})`)
  } else {
    warn(`Electron ${version} is end of life. Supported majors are ` +
      `${oldestSupported}-${latest}, so no Chromium security fixes are reaching ` +
      `this build. Fix with: npm install --save-dev electron@^${latest}, ` +
      'then npm run harden and npm test')
  }
}

async function checkFuses () {
  if (!fs.existsSync(binary)) {
    warn('no Electron binary installed')
    return
  }
  const { getCurrentFuseWire, FuseV1Options } = await import('@electron/fuses')
  const wire = await getCurrentFuseWire(binary)
  const expected = {
    RunAsNode: false,
    EnableNodeOptionsEnvironmentVariable: false,
    EnableNodeCliInspectArguments: false,
    EnableCookieEncryption: true,
    GrantFileProtocolExtraPrivileges: false
  }
  const wrong = Object.keys(expected).filter((name) => {
    // the wire stores '0' and '1' as character codes
    const set = wire[FuseV1Options[name]] === 49
    return set !== expected[name]
  })
  if (wrong.length) {
    warn(`fuses were reset, probably by npm install: ${wrong.join(', ')}. Run \`npm run harden\`.`)
  } else {
    ok('binary fuses are set')
  }
}

function checkAudit () {
  try {
    execFileSync('npm', ['audit', '--audit-level=high'], { cwd: root, stdio: 'pipe' })
    ok('npm audit reports nothing at high or above')
  } catch (e) {
    const out = (e.stdout || '').toString()
    warn('npm audit found advisories:\n' + out.split('\n').slice(0, 20).map(l => '    ' + l).join('\n'))
  }
}

async function main () {
  console.log('Checking the things that decay:\n')
  await checkElectron()
  await checkFuses()
  checkAudit()
  console.log(`\n${problems ? problems + ' thing(s) need attention' : 'nothing needs attention'}`)
  process.exit(problems ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
