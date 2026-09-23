/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const test = require('node:test')
const assert = require('node:assert')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    return { app: {}, net: {}, dialog: {}, shell: {}, BrowserWindow: {} }
  }
  return originalLoad.apply(this, arguments)
}
const compare = require('../../app/updateCheck').compareVersionsForTest
Module._load = originalLoad

test('orders release versions numerically, not as strings', () => {
  assert.ok(compare('v0.10.0', '0.9.0') > 0)
  assert.ok(compare('v0.8.0', '0.8.0') === 0)
  assert.ok(compare('0.7.7', 'v0.8.0') < 0)
  assert.ok(compare('1.0', '1.0.0') === 0)
  assert.ok(compare('v1.0.0-beta.1', '1.0.0') === 0)
})

test('junk never looks newer', () => {
  assert.ok(compare('', '0.8.0') < 0)
  assert.ok(compare(undefined, '0.8.0') < 0)
  assert.ok(compare('latest', '0.8.0') < 0)
})
