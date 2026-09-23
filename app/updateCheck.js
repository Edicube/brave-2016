/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Tells you when a newer release of this browser exists, and for the copy
// installed in /opt, offers to install it (app/selfUpdate.js).
//
// One request to the GitHub releases API, 30 seconds after startup, at most
// once a day. Nothing is downloaded unless you choose to install, and nothing
// is installed without a valid release signature and your password.
//
// Turn it off with updateCheck.enabled in js/constants/appConfig.js.

const electron = require('electron')
const app = electron.app
const net = electron.net
const dialog = electron.dialog
const shell = electron.shell
const BrowserWindow = electron.BrowserWindow
const fs = require('fs')
const path = require('path')
const AppConfig = require('../js/constants/appConfig')
const SelfUpdate = require('./selfUpdate')

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[updateCheck]', ...args)
  }
}

const stampPath = () => path.join(app.getPath('userData'), 'update-check')

/**
 * Compares dotted version numbers, ignoring a leading "v" and anything after
 * a "-". Pure, for tests.
 * @return {number} negative if a < b, positive if a > b, 0 if equal
 */
function compareVersions (a, b) {
  // anything but a string or number counts as no version at all
  const text = (v) => (typeof v === 'string' || typeof v === 'number') ? String(v) : ''
  const parts = (v) => text(v).replace(/^v/, '').split('-')[0]
    .split('.').map(n => parseInt(n, 10) || 0)
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) {
      return d
    }
  }
  return 0
}

function checkedRecently (interval) {
  try {
    const last = Date.parse(fs.readFileSync(stampPath(), 'utf8').trim())
    return !isNaN(last) && Date.now() - last < interval
  } catch (e) {
    return false
  }
}

async function check (config) {
  if (checkedRecently(config.msBetweenChecks)) {
    debug('checked recently, skipping')
    return
  }
  try {
    fs.writeFileSync(stampPath(), new Date().toISOString())
  } catch (e) {}

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  let release
  try {
    const res = await net.fetch(config.url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'brave-2016' },
      signal: controller.signal
    })
    if (!res.ok) {
      debug('release lookup got HTTP', res.status)
      return
    }
    release = await res.json()
  } catch (e) {
    debug('release lookup failed:', e.message)
    return
  } finally {
    clearTimeout(timer)
  }

  const current = app.getVersion()
  const latest = release && typeof release.tag_name === 'string' && release.tag_name
  if (!latest || compareVersions(latest, current) <= 0) {
    debug(`up to date (${current}, latest ${latest})`)
    return
  }

  // only ever open the project's own release pages
  const ownPage = typeof release.html_url === 'string' &&
    release.html_url.startsWith(config.releasesPage)
  const page = ownPage ? release.html_url : config.releasesPage
  debug(`newer release ${latest} available`)

  const installable = SelfUpdate.canInstall()
  const { response } = await ask({
    type: 'info',
    buttons: installable ? ['Later', 'Open release page', 'Install update'] : ['Later', 'Open release page'],
    defaultId: installable ? 2 : 1,
    cancelId: 0,
    title: 'Update available',
    message: `Brave 2016 ${latest} is available (you have ${current}).`,
    detail: installable
      ? 'Newer releases carry Chromium security fixes. Installing checks the ' +
        "release's signature and checksum first, then asks for your password."
      : 'Newer releases carry Chromium security fixes. This copy is not the ' +
        'one installed in /opt, so it will not update itself: download the new ' +
        'release, or pull and rebuild.'
  })
  if (response === 1) {
    shell.openExternal(page)
  } else if (response === 2 && installable) {
    await installRelease(release, latest, config)
  }
}

function ask (options) {
  const parent = BrowserWindow.getAllWindows()[0]
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

function setProgress (fraction) {
  BrowserWindow.getAllWindows().forEach(w => w.setProgressBar(fraction))
}

async function installRelease (release, latest, config) {
  let extracted
  try {
    setProgress(2)
    extracted = await SelfUpdate.prepare(release, {
      repo: config.repo,
      onProgress: (f) => setProgress(f)
    })
  } catch (e) {
    setProgress(-1)
    debug('update refused:', e.message)
    await ask({
      type: 'error',
      buttons: ['OK'],
      title: 'Update not installed',
      message: 'The update did not pass its checks, so nothing was installed.',
      detail: e.message
    })
    return
  }
  setProgress(-1)

  try {
    await SelfUpdate.install(extracted)
  } catch (e) {
    // cancelling the password prompt lands here too
    debug('install did not complete:', e.message)
    await ask({
      type: 'warning',
      buttons: ['OK'],
      title: 'Update not installed',
      message: `Brave 2016 ${latest} was verified but not installed.`,
      detail: e.message
    })
    return
  }

  // the files under this running process have just been replaced
  await ask({
    type: 'info',
    buttons: ['Restart'],
    title: 'Update installed',
    message: `Brave 2016 ${latest} is installed and will now restart.`
  })
  SelfUpdate.restart()
}

module.exports.init = () => {
  const config = AppConfig.updateCheck
  if (!config || !config.enabled || process.env.BRAVE_HIDDEN) {
    return
  }
  setTimeout(() => {
    check(config).catch((e) => debug('update check failed:', e.message))
  }, config.delayMs).unref()
}

module.exports.compareVersionsForTest = compareVersions
