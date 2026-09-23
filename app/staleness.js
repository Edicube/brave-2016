/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// The auto-updater points at infrastructure that no longer exists, so this
// browser is only as safe as the last time somebody rebuilt it. That risk is
// invisible: nothing about an old build looks different from a new one.
//
// So the build stamps its own date, and once it is past its shelf life the
// person using the browser is told, rather than only the person maintaining it.
// No network call is involved: how old the build is does not need asking.

const electron = require('electron')
const app = electron.app
const dialog = electron.dialog
const BrowserWindow = electron.BrowserWindow
const fs = require('fs')
const path = require('path')
const AppConfig = require('../js/constants/appConfig')

module.exports.resourceName = 'staleness'

const infoPath = path.join(__dirname, 'gen', 'buildinfo.json')
const acknowledgedPath = () =>
  path.join(app.getPath('userData'), 'staleness-acknowledged')

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[staleness]', ...args)
  }
}

function readBuildInfo () {
  try {
    return JSON.parse(fs.readFileSync(infoPath, 'utf8'))
  } catch (e) {
    return null
  }
}

/**
 * @return {number|null} whole days since this build was made
 */
module.exports.ageInDays = () => {
  const info = readBuildInfo()
  if (!info || !info.builtAt) {
    return null
  }
  const built = Date.parse(info.builtAt)
  if (isNaN(built)) {
    return null
  }
  return Math.floor((Date.now() - built) / (1000 * 60 * 60 * 24))
}

// Shown at most once per day, so it is a reminder rather than a nag
function alreadyToldToday () {
  try {
    const last = Date.parse(fs.readFileSync(acknowledgedPath(), 'utf8').trim())
    return !isNaN(last) && (Date.now() - last) < 1000 * 60 * 60 * 24
  } catch (e) {
    return false
  }
}

function rememberTold () {
  try {
    fs.writeFileSync(acknowledgedPath(), new Date().toISOString())
  } catch (e) {
    debug('could not record the reminder:', e.message)
  }
}

module.exports.init = () => {
  const config = AppConfig[module.exports.resourceName]
  if (!config || !config.enabled) {
    return
  }

  const age = module.exports.ageInDays()
  if (age === null) {
    debug('no build stamp; run npm run build')
    return
  }

  debug(`build is ${age} day(s) old`)
  if (age < config.maxAgeInDays) {
    return
  }

  const info = readBuildInfo() || {}
  console.log(`\nThis build is ${age} days old (Electron ${info.electron || 'unknown'}). ` +
    'It is not receiving Chromium security fixes. Run: npm run doctor\n')

  if (alreadyToldToday()) {
    return
  }
  rememberTold()

  const options = {
    type: 'warning',
    buttons: ['Continue anyway'],
    title: 'This browser is out of date',
    message: `This build is ${age} days old.`,
    detail: 'It has no working auto-updater, so it is not receiving Chromium ' +
      'security fixes. Rebuild it with:\n\n' +
      '    npm install && npm run harden && npm run build\n\n' +
      'Check what needs attention with: npm run doctor'
  }

  // Attached to the browser window when there is one, so it appears over it as
  // a modal rather than as a stray parentless dialog.
  const show = () => {
    const parent = BrowserWindow.getAllWindows()[0]
    const shown = parent
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options)
    shown.then(() => debug('reminder acknowledged'))
      .catch((e) => debug('reminder could not be shown:', e.message))
  }

  const parent = BrowserWindow.getAllWindows()[0]
  if (parent && parent.webContents.isLoading()) {
    // wait for the window to be there to attach to
    parent.webContents.once('did-finish-load', show)
  } else {
    show()
  }
}
