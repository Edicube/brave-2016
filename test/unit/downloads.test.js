/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Progress, completion and cancelling for downloads, against fake Electron
// objects: the real ones need a user clicking through the save dialog.

const test = require('node:test')
const assert = require('node:assert')
const EventEmitter = require('node:events')
const Module = require('node:module')

const progress = []
const notifications = []
const menuItem = { enabled: false }
const fakeElectron = {
  BrowserWindow: { getAllWindows: () => [{ setProgressBar: (p) => progress.push(p) }] },
  Menu: { getApplicationMenu: () => ({ getMenuItemById: () => menuItem }) },
  Notification: class {
    static isSupported () { return true }
    constructor (opts) { this.opts = opts }
    on () {}
    show () { notifications.push(this.opts.title) }
  },
  shell: {}
}
const originalLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    return fakeElectron
  }
  return originalLoad.apply(this, arguments)
}
const Downloads = require('../../app/downloads')
Module._load = originalLoad

function fakeItem (total) {
  const item = new EventEmitter()
  item.received = 0
  item.cancelled = false
  item.getReceivedBytes = () => item.received
  item.getTotalBytes = () => total
  item.getSavePath = () => '/tmp/file.zip'
  item.getFilename = () => 'file.zip'
  item.cancel = () => { item.cancelled = true; item.emit('done', {}, 'cancelled') }
  return item
}

test('tracks progress and enables the cancel menu item', () => {
  const a = fakeItem(100)
  Downloads.track(a)
  assert.strictEqual(Downloads.activeCount(), 1)
  assert.strictEqual(menuItem.enabled, true)
  a.received = 100
  a.emit('done', {}, 'completed')
  assert.strictEqual(Downloads.activeCount(), 0)
  assert.strictEqual(menuItem.enabled, false)
  assert.strictEqual(progress[progress.length - 1], -1, 'progress cleared when nothing is left')
  assert.strictEqual(notifications[notifications.length - 1], 'Download complete')
})

test('unknown sizes show activity instead of a fake fraction', () => {
  const a = fakeItem(0)
  Downloads.track(a)
  assert.strictEqual(progress[progress.length - 1], 2)
  a.emit('done', {}, 'interrupted')
  assert.strictEqual(notifications[notifications.length - 1], 'Download failed')
})

test('cancel downloads cancels everything in flight', () => {
  const a = fakeItem(10)
  const b = fakeItem(20)
  Downloads.track(a)
  Downloads.track(b)
  Downloads.cancelAll()
  assert.ok(a.cancelled && b.cancelled)
  assert.strictEqual(Downloads.activeCount(), 0)
})
