/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The UI is served over brave://ui, and two checks in app/uiProtocol.js are
// security critical: which URLs count as the browser's own pages, and which
// files the protocol handler will serve. Runs on plain node: `npm test`.

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

// uiProtocol pulls in electron for protocol and net, which are not available
// outside an Electron process, so stub the require.
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { protocol: {}, net: {} }
  }
  return originalLoad.apply(this, arguments)
}
const UiProtocol = require('../../app/uiProtocol')
Module._load = originalLoad

const root = UiProtocol.rootForTest
const resolve = UiProtocol.resolveForTest

test('recognises the browser\'s own pages', () => {
  assert.strictEqual(UiProtocol.isUiUrl('brave://ui/index.html'), true)
  assert.strictEqual(UiProtocol.isUiUrl('brave://ui/index.html?appState=%7B%7D'), true)
  assert.strictEqual(UiProtocol.isUiUrl('brave://ui/blocked.html#https://x'), true)
})

test('rejects anything that is not the UI origin', () => {
  assert.strictEqual(UiProtocol.isUiUrl('https://evil.example/'), false)
  assert.strictEqual(UiProtocol.isUiUrl('file:///etc/passwd'), false)
  assert.strictEqual(UiProtocol.isUiUrl('brave://evil/index.html'), false)
  assert.strictEqual(UiProtocol.isUiUrl('brave://ui.evil.com/index.html'), false)
  assert.strictEqual(UiProtocol.isUiUrl('javascript:alert(1)'), false)
  assert.strictEqual(UiProtocol.isUiUrl('not a url'), false)
  assert.strictEqual(UiProtocol.isUiUrl(''), false)
})

test('serves files inside the UI root', () => {
  assert.strictEqual(resolve('brave://ui/index.html'), path.join(root, 'index.html'))
  assert.strictEqual(resolve('brave://ui/gen/bundle.js'), path.join(root, 'gen', 'bundle.js'))
  assert.strictEqual(resolve('brave://ui/blocked.html'), path.join(root, 'blocked.html'))
})

test('never resolves outside the UI root', () => {
  // The URL parser normalises most traversal away before it reaches the
  // resolver, so the property worth asserting is the outcome, not the form:
  // whatever is thrown at it, the answer is either a refusal or a path inside
  // the root. Percent-encoded separators survive normalisation and are the one
  // form the guard itself has to catch.
  const hostile = [
    'brave://ui/../package.json',
    'brave://ui/../../etc/passwd',
    'brave://ui/gen/../../../etc/passwd',
    'brave://ui/%2e%2e/%2e%2e/etc/passwd',
    'brave://ui/..%2f..%2fetc%2fpasswd',
    'brave://ui/..%2F..%2Fetc%2Fpasswd',
    'brave://ui/gen%2f..%2f..%2f..%2fetc%2fpasswd',
    'brave://ui/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    'brave://ui//etc/passwd',
    'brave://ui/....//....//etc/passwd'
  ]
  for (const target of hostile) {
    const got = resolve(target)
    if (got !== null) {
      assert.ok(got === root || got.startsWith(root + path.sep),
        `${target} resolved outside the UI root: ${got}`)
    }
  }
})

test('the encoded separator form is refused outright', () => {
  assert.strictEqual(resolve('brave://ui/..%2f..%2fetc%2fpasswd'), null)
  assert.strictEqual(resolve('brave://ui/..%2F..%2Fpackage.json'), null)
})

test('refuses a different host even on the right scheme', () => {
  assert.strictEqual(resolve('brave://elsewhere/index.html'), null)
})

test('serves only known content types', () => {
  // no handing out sources, keys or anything else that happens to be there
  assert.strictEqual(resolve('brave://ui/index.sh'), null)
  assert.strictEqual(resolve('brave://ui/gen/bundle.js.map'), null)
  assert.strictEqual(resolve('brave://ui/noextension'), null)
})
