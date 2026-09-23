/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Which permission requests are granted, refused, or put in front of the user.

const test = require('node:test')
const assert = require('node:assert')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    return { dialog: {}, BrowserWindow: {} }
  }
  return originalLoad.apply(this, arguments)
}
const perms = require('../../app/permissions')
Module._load = originalLoad
const classify = perms.classifyForTest

const page = 'https://meet.example.com/room'

test('harmless permissions are granted without asking', () => {
  for (const p of ['fullscreen', 'mediaKeySystem', 'clipboard-sanitized-write']) {
    assert.strictEqual(classify(p, {}, page), 'allow')
  }
})

test('camera, microphone and notifications are asked about', () => {
  assert.strictEqual(classify('media', { mediaTypes: ['audio'], requestingUrl: page }, page), 'ask')
  assert.strictEqual(classify('media', { mediaTypes: ['video', 'audio'], requestingUrl: page }, page), 'ask')
  assert.strictEqual(classify('notifications', { requestingUrl: page }, page), 'ask')
})

test('everything else is refused outright', () => {
  for (const p of ['geolocation', 'midi', 'midiSysex', 'clipboard-read', 'openExternal',
    'pointerLock', 'display-capture', 'idle-detection', 'window-management', 'unknown', 'hid', 'usb', 'serial']) {
    assert.strictEqual(classify(p, { requestingUrl: page }, page), 'deny', p)
  }
})

test('an embedded frame from another origin cannot ask', () => {
  assert.strictEqual(classify('media',
    { mediaTypes: ['audio'], requestingUrl: 'https://ads.example.net/frame' }, page), 'deny')
})

test('media requests for anything but audio and video are refused', () => {
  assert.strictEqual(classify('media', { mediaTypes: [], requestingUrl: page }, page), 'deny')
  assert.strictEqual(classify('media', { mediaTypes: ['screen'], requestingUrl: page }, page), 'deny')
})

test('non-web origins cannot ask', () => {
  assert.strictEqual(classify('notifications', {}, 'brave://ui/index.html'), 'deny')
  assert.strictEqual(classify('notifications', {}, 'file:///x'), 'deny')
  assert.strictEqual(classify('notifications', {}, ''), 'deny')
})

test('BRAVE_DENY_PERMISSIONS refuses without asking', () => {
  process.env.BRAVE_DENY_PERMISSIONS = '1'
  try {
    assert.strictEqual(classify('media', { mediaTypes: ['audio'], requestingUrl: page }, page), 'deny')
  } finally {
    delete process.env.BRAVE_DENY_PERMISSIONS
  }
})

test('the prompt text says what is being asked for', () => {
  assert.strictEqual(perms.describeForTest('media', { mediaTypes: ['video', 'audio'] }).label,
    'use your camera and microphone')
  assert.strictEqual(perms.describeForTest('media', { mediaTypes: ['audio'] }).label, 'use your microphone')
})
