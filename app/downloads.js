/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// A minimal download UI, for a browser that never had one: progress on the
// window's taskbar/dock icon, a notification when a download finishes or
// fails, and File > Cancel downloads. Everything else about a download - the
// confirmation and choosing where it goes - happens in app/security.js.

const electron = require('electron')
const BrowserWindow = electron.BrowserWindow
const Menu = electron.Menu
const Notification = electron.Notification
const shell = electron.shell
const path = require('path')

const active = new Set()
let lastPaint = 0

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[downloads]', ...args)
  }
}

module.exports.menuItemId = 'cancel-downloads'
module.exports.activeCount = () => active.size

function refreshMenu () {
  const menu = Menu.getApplicationMenu()
  const item = menu && menu.getMenuItemById(module.exports.menuItemId)
  if (item) {
    item.enabled = active.size > 0
  }
}

// Combined progress of everything in flight, at most a few times a second
function paintProgress (force) {
  const now = Date.now()
  if (!force && now - lastPaint < 250) {
    return
  }
  lastPaint = now

  let received = 0
  let total = 0
  let unknown = false
  for (const item of active) {
    received += item.getReceivedBytes()
    const size = item.getTotalBytes()
    if (size > 0) {
      total += size
    } else {
      unknown = true
    }
  }
  const progress = active.size === 0
    ? -1
    // no Content-Length: show activity rather than a made-up fraction
    : (unknown || !total) ? 2 : Math.min(received / total, 1)
  BrowserWindow.getAllWindows().forEach(w => w.setProgressBar(progress))
}

function notify (title, body, file) {
  if (!Notification.isSupported()) {
    return
  }
  const n = new Notification({ title, body, silent: true })
  if (file) {
    n.on('click', () => shell.showItemInFolder(file))
  }
  n.show()
}

/**
 * Follows a download the user has already agreed to.
 * @param {DownloadItem} item
 */
module.exports.track = (item) => {
  active.add(item)
  refreshMenu()
  paintProgress(true)

  item.on('updated', () => paintProgress(false))
  item.once('done', (event, state) => {
    active.delete(item)
    refreshMenu()
    paintProgress(true)
    const file = item.getSavePath()
    const name = path.basename(file || item.getFilename())
    debug(state, name)
    if (state === 'completed') {
      notify('Download complete', `${name} - click to show it in its folder`, file)
    } else if (state === 'interrupted') {
      notify('Download failed', name)
    }
  })
}

module.exports.cancelAll = () => {
  for (const item of active) {
    item.cancel()
  }
}
