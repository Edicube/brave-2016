/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Throws random, hostile input at every function that takes something a page
// or a compromised renderer controls, and checks the properties that must hold
// whatever arrives: nothing throws, and nothing escapes its bounds.
//
// Seeded, so a failure reproduces. FUZZ_SEED and FUZZ_RUNS change the run;
// CI uses the defaults, and a weekly job could raise FUZZ_RUNS.

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    const noop = () => {}
    return {
      app: { getPath: () => require('node:os').tmpdir(), on: noop, getVersion: () => '0.0.0' },
      ipcMain: { on: noop, handle: noop },
      protocol: {},
      net: {},
      shell: {},
      dialog: {},
      Menu: {},
      BrowserWindow: { getAllWindows: () => [] }
    }
  }
  return originalLoad.apply(this, arguments)
}
const UiProtocol = require('../../app/uiProtocol')
const { isOpenable } = require('../../app/windowOpen')
const buildTemplate = require('../../app/windowBridge').buildTemplateForTest
const classify = require('../../app/permissions').classifyForTest
const compareVersions = require('../../app/updateCheck').compareVersionsForTest
const restorable = require('../../app/sessionStore').restorableLocationForTest
Module._load = originalLoad

const RUNS = Number(process.env.FUZZ_RUNS) || 3000
let seed = Number(process.env.FUZZ_SEED) || 20160122

// mulberry32: small, fast, deterministic
function rand () {
  seed |= 0
  seed = seed + 0x6D2B79F5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rand() * list.length)]
const int = (n) => Math.floor(rand() * n)

const pieces = ['http:', 'https:', 'file:', 'javascript:', 'data:', 'brave:', 'blob:', 'chrome:',
  '//', '/', '..', '.', '%2e', '%2f', '%2F', '%00', '%zz', '\\', '#', '?', '@', ':', 'ui', 'evil.com',
  '127.0.0.1', 'localhost', 'index.html', 'blocked.html', 'gen', 'etc', 'passwd', ' ', '\n', '\t',
  '\u0000', '‮', 'é', '💥', 'a'.repeat(300), '<script>', '"', "'", '{', '}', 'constructor',
  '__proto__', 'prototype']
const randomString = () => Array.from({ length: int(8) }, () => pick(pieces)).join('')

function randomValue (depth = 0) {
  const kinds = depth > 3 ? 6 : 9
  switch (int(kinds)) {
    case 0: return randomString()
    case 1: return int(2) ? int(1e6) - 5e5 : pick([NaN, Infinity, -Infinity, 1.5, -0])
    case 2: return pick([true, false])
    case 3: return pick([null, undefined])
    case 4: return 'http' + pick(['', 's']) + '://' + randomString()
    case 5: return 'brave://ui/' + randomString()
    case 6: return Array.from({ length: int(6) }, () => randomValue(depth + 1))
    case 7: {
      const o = {}
      for (let i = 0; i < int(6); i++) {
        o[pick(['label', 'type', 'enabled', 'checked', 'accelerator', 'submenu', 'menuItemId',
          'click', 'role', '__proto__', 'constructor', randomString()])] = randomValue(depth + 1)
      }
      return o
    }
    default: return JSON.parse('{"__proto__": {"polluted": true}, "label": "x"}')
  }
}

const root = UiProtocol.rootForTest

test(`brave://ui resolver never leaves the UI root (${RUNS} inputs)`, () => {
  for (let i = 0; i < RUNS; i++) {
    const target = int(3) ? 'brave://ui/' + randomString() : randomString()
    const got = UiProtocol.resolveForTest(target)
    assert.ok(got === null || got === root || got.startsWith(root + path.sep), `${JSON.stringify(target)} -> ${got}`)
    assert.strictEqual(typeof UiProtocol.isUiUrl(target), 'boolean')
  }
})

test(`window.open only ever allows http and https (${RUNS} inputs)`, () => {
  for (let i = 0; i < RUNS; i++) {
    const target = randomValue()
    if (isOpenable(target)) {
      assert.ok(/^https?:$/.test(new URL(target).protocol), JSON.stringify(target))
    }
  }
})

test(`menu templates stay bounded and typed (${RUNS} inputs)`, () => {
  const sender = { isDestroyed: () => false, send () {} }
  const count = (items) => items.reduce((n, i) => n + 1 + (i.submenu ? count(i.submenu) : 0), 0)
  const check = (items, depth) => {
    for (const item of items) {
      for (const key of Object.keys(item)) {
        assert.ok(['label', 'type', 'enabled', 'checked', 'accelerator', 'submenu', 'click'].includes(key), key)
      }
      if (item.label !== undefined) assert.strictEqual(typeof item.label, 'string')
      if (item.click !== undefined) assert.strictEqual(typeof item.click, 'function')
      if (item.submenu) {
        assert.ok(depth < 4)
        check(item.submenu, depth + 1)
      }
    }
  }
  for (let i = 0; i < RUNS; i++) {
    const built = buildTemplate(randomValue(), sender, 1)
    assert.ok(Array.isArray(built))
    assert.ok(count(built) <= 100)
    check(built, 0)
  }
  assert.strictEqual({}.polluted, undefined, 'prototype pollution')
})

test(`permission decisions are always one of three answers (${RUNS} inputs)`, () => {
  const askable = new Set(['media', 'notifications'])
  for (let i = 0; i < RUNS; i++) {
    const permission = pick(['media', 'notifications', 'geolocation', 'usb', 'fullscreen', randomString()])
    const verdict = classify(permission, randomValue(), randomValue())
    assert.ok(['allow', 'deny', 'ask'].includes(verdict))
    if (verdict === 'ask') assert.ok(askable.has(permission))
  }
})

test(`restored tabs never reopen on a non-web scheme (${RUNS} inputs)`, () => {
  for (let i = 0; i < RUNS; i++) {
    const saved = int(2)
      ? 'brave://ui/blocked.html#' + encodeURIComponent(JSON.stringify({ url: randomValue() }))
      : randomValue()
    const got = restorable(saved)
    if (typeof saved === 'string' && saved.startsWith('brave://')) {
      assert.ok(got === 'about:blank' || /^https?:\/\//.test(got), JSON.stringify(got))
    }
  }
})

test(`version comparison never throws and is antisymmetric (${RUNS} inputs)`, () => {
  for (let i = 0; i < RUNS; i++) {
    const a = int(2) ? `v${int(3)}.${int(20)}.${int(20)}` : randomValue()
    const b = int(2) ? `${int(3)}.${int(20)}.${int(20)}` : randomValue()
    const ab = compareVersions(a, b)
    assert.ok(Number.isFinite(ab))
    assert.strictEqual(Math.sign(ab), -Math.sign(compareVersions(b, a)) || 0)
  }
})
