/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// A page can put any string into window.open. Only ordinary web addresses may
// become a tab: a fresh frame loading javascript:, file: or data: is a way of
// running somewhere the page should not reach.

const test = require('node:test')
const assert = require('node:assert')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    return { app: { on () {} } }
  }
  return originalLoad.apply(this, arguments)
}
const { isOpenable } = require('../../app/windowOpen')
Module._load = originalLoad

test('allows ordinary web addresses', () => {
  assert.strictEqual(isOpenable('https://example.com/'), true)
  assert.strictEqual(isOpenable('http://example.com/path?q=1'), true)
})

test('refuses schemes that run or read something local', () => {
  for (const target of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://example.com/abc',
    'brave://ui/index.html',
    'chrome://gpu',
    'devtools://devtools/bundled/inspector.html',
    'about:blank',
    'vbscript:msgbox(1)',
    'ws://example.com/'
  ]) {
    assert.strictEqual(isOpenable(target), false, `${target} should be refused`)
  }
})

test('refuses anything that is not a usable string', () => {
  assert.strictEqual(isOpenable(''), false)
  assert.strictEqual(isOpenable('not a url'), false)
  assert.strictEqual(isOpenable(undefined), false)
  assert.strictEqual(isOpenable(null), false)
  assert.strictEqual(isOpenable(42), false)
  assert.strictEqual(isOpenable({}), false)
})
