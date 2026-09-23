/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Warns when the browser's own files can be changed by the user running it.
//
// On macOS and Windows Electron checks app.asar against a hash embedded in the
// binary, but not on Linux. A hash check written in JavaScript would not
// help: it would live inside the very archive it checks. What does help is
// where the files are: a root-owned install (tools/install-linux.sh) cannot be
// changed by anything running as you, while an unpacked archive in your home
// folder can be rewritten by any program you run, and the browser would never
// notice. So that case is pointed out, once per install location.

const electron = require('electron')
const app = electron.app
const fs = require('fs')
const path = require('path')

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[installCheck]', ...args)
  }
}

/**
 * The files whose modification would change what the browser runs.
 * @param {string} exe the running binary
 * @return {string[]}
 */
module.exports.criticalPaths = (exe) => {
  const dir = path.dirname(exe)
  return [dir, exe, path.join(dir, 'resources'), path.join(dir, 'resources', 'app.asar')]
}

/**
 * @param {string[]} paths
 * @param {function(string): boolean} canWrite
 * @return {string[]} the ones the current user can change
 */
module.exports.writable = (paths, canWrite) => paths.filter(p => {
  try {
    return canWrite(p)
  } catch (e) {
    return false
  }
})

const canWrite = (p) => {
  if (!fs.existsSync(p)) {
    return false
  }
  fs.accessSync(p, fs.constants.W_OK)
  return true
}

module.exports.init = () => {
  // a checkout is writable by design; this is about installed builds
  if (process.platform !== 'linux' || !app.isPackaged || process.env.BRAVE_HIDDEN) {
    return
  }
  const exe = app.getPath('exe')
  const found = module.exports.writable(module.exports.criticalPaths(exe), canWrite)
  if (found.length === 0) {
    debug('install is not writable by this user')
    return
  }
  const marker = path.join(app.getPath('userData'), 'install-warning-shown')
  try {
    if (fs.readFileSync(marker, 'utf8') === exe) {
      return
    }
  } catch (e) {}
  debug('writable by this user:', found.join(', '))

  const show = () => electron.dialog.showMessageBox({
    type: 'warning',
    title: 'Brave 2016',
    message: 'This copy of Brave can be changed by any program you run',
    detail: `Its files in ${path.dirname(exe)} are writable by your user account, so ` +
      'malware running as you could quietly modify the browser. Install it with ' +
      '"sudo sh install.sh" from the release archive: that copy is owned by root ' +
      'and also updates itself.\n\nThis is shown once for this location.',
    buttons: ['OK']
  }).then(() => {
    try {
      fs.writeFileSync(marker, exe)
    } catch (e) {}
  })
  setTimeout(show, 3000)
}
