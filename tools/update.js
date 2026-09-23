/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Updates a source checkout in one step - the counterpart, for people who run
// Brave 2016 with `npm start`, of the self-updater the /opt install has.
//
//   npm run update
//
// Refuses to touch a working tree with uncommitted changes, pulls only if it
// can fast-forward, then reinstalls from the lockfile, re-flips the Electron
// fuses (npm replaces the binary), runs the unit tests and rebuilds. Stops at
// the first step that fails.

const { execFileSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const quiet = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function step (label, cmd, args) {
  console.log(`\n== ${label}`)
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

function main () {
  try {
    quiet('git', ['rev-parse', '--is-inside-work-tree'])
  } catch (e) {
    console.error('This is not a git checkout. Download a release instead.')
    process.exit(1)
  }

  const dirty = quiet('git', ['status', '--porcelain', '--untracked-files=no'])
  if (dirty) {
    console.error('You have uncommitted changes; commit or stash them first:\n' + dirty)
    process.exit(1)
  }

  const before = quiet('git', ['rev-parse', '--short', 'HEAD'])
  const version = () => require(path.join(root, 'package.json')).version
  const from = version()

  step('Pulling', 'git', ['pull', '--ff-only'])
  const after = quiet('git', ['rev-parse', '--short', 'HEAD'])
  if (before === after) {
    console.log('\nAlready up to date.')
    return
  }

  step('Installing dependencies from the lockfile', npm, ['ci'])
  step('Hardening the Electron binary', process.execPath, [path.join(__dirname, 'fuses.js')])
  step('Unit tests', npm, ['test'])
  step('Building', npm, ['run', 'build'])

  delete require.cache[require.resolve(path.join(root, 'package.json'))]
  console.log(`\nUpdated ${before} -> ${after} (${from} -> ${version()}). Start it with: npm start`)
}

try {
  main()
} catch (e) {
  console.error(`\nUpdate stopped: ${e.message.split('\n')[0]}`)
  process.exit(1)
}
