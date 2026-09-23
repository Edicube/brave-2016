/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// A download UI, for a browser that never had one: progress on the window's
// taskbar/dock icon, a notification when a download finishes or fails, File >
// Cancel downloads, and the list behind Window > Downloads. Everything else
// about a download - the confirmation and choosing where it goes - happens in
// app/security.js.

const electron = require('electron')
const BrowserWindow = electron.BrowserWindow
const Menu = electron.Menu
const Notification = electron.Notification
const shell = electron.shell
const path = require('path')

const active = new Set()
let lastPaint = 0

// The list in the downloads panel: this session's downloads, newest last.
// Kept in app state for the windows to show, never saved.
const maxListed = 50
const listed = new Map() // id -> { item, record }
let nextId = 1
let publishTimer = null

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

function recordOf (item, state) {
  const file = item.getSavePath()
  return {
    filename: path.basename(file || item.getFilename()),
    url: item.getURL().slice(0, 2048),
    state: state || (item.isPaused() ? 'paused' : 'progressing'),
    received: item.getReceivedBytes(),
    total: item.getTotalBytes(),
    started: item.getStartTime() * 1000
  }
}

function publishNow () {
  clearTimeout(publishTimer)
  publishTimer = null
  const list = []
  for (const [id, entry] of listed) {
    if (active.has(entry.item)) {
      entry.record = recordOf(entry.item)
    }
    list.push(Object.assign({ id }, entry.record))
  }
  try {
    module.exports.publishTo(list)
  } catch (e) {
    debug('could not publish the list:', e.message)
  }
}

// replaced in tests
module.exports.publishTo = (list) =>
  require('../js/stores/appStore').setSessionOnly('downloads', list)

// Every state change goes to every window, so progress is sent at most
// twice a second
function publish (now) {
  if (now) {
    publishNow()
  } else if (!publishTimer) {
    publishTimer = setTimeout(publishNow, 500)
  }
}

/**
 * What the downloads panel can ask for. The id comes from a window, so it is
 * only ever looked up, and a file is only ever shown in its folder, never
 * opened: opening a downloaded file would run it.
 * @param {number} id
 * @param {string} action cancel, pause, resume, show or remove
 */
module.exports.act = (id, action) => {
  const entry = listed.get(id)
  if (!entry) {
    return
  }
  const item = entry.item
  const running = active.has(item)
  if (action === 'cancel' && running) {
    item.cancel()
  } else if (action === 'pause' && running && !item.isPaused()) {
    item.pause()
  } else if (action === 'resume' && running && item.canResume()) {
    item.resume()
  } else if (action === 'show' && entry.record.state === 'completed') {
    shell.showItemInFolder(item.getSavePath())
  } else if (action === 'remove' && !running) {
    listed.delete(id)
  } else {
    return
  }
  publish(true)
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
  const id = nextId++
  listed.set(id, { item, record: recordOf(item) })
  // oldest finished ones make room
  for (const [oldId, entry] of listed) {
    if (listed.size <= maxListed) {
      break
    }
    if (!active.has(entry.item)) {
      listed.delete(oldId)
    }
  }
  refreshMenu()
  paintProgress(true)
  publish(true)

  item.on('updated', () => {
    paintProgress(false)
    publish(false)
  })
  item.once('done', (event, state) => {
    active.delete(item)
    const entry = listed.get(id)
    if (entry) {
      entry.record = recordOf(item, state)
    }
    refreshMenu()
    paintProgress(true)
    publish(true)
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
