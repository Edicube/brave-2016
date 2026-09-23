/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Menu templates come from the renderer, so they are hostile input as far as
// the main process is concerned: rebuilt from a fixed set of typed keys, and
// bounded as a whole tree, not just per level.

const test = require('node:test')
const assert = require('node:assert')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    return { app: {}, ipcMain: {}, shell: {}, Menu: {}, BrowserWindow: {}, protocol: {}, net: {} }
  }
  return originalLoad.apply(this, arguments)
}
const build = require('../../app/windowBridge').buildTemplateForTest
Module._load = originalLoad

const sender = { isDestroyed: () => false, send () {} }
const count = (items) => items.reduce((n, i) => n + 1 + (i.submenu ? count(i.submenu) : 0), 0)

test('keeps only known keys, with the right types', () => {
  const [item] = build([{
    label: 'Reload',
    type: 'normal',
    enabled: true,
    role: 'quit',
    click: 'x',
    icon: '/etc/passwd',
    accelerator: 'CmdOrCtrl+R',
    menuItemId: 3
  }], sender, 1)
  assert.deepStrictEqual(Object.keys(item).sort(), ['accelerator', 'click', 'enabled', 'label', 'type'])
  assert.strictEqual(typeof item.click, 'function')
})

test('refuses wrong types rather than coercing them', () => {
  const [item] = build([{ label: { toString: () => 'x' }, enabled: 'yes', type: 'evil', accelerator: 'a\nb' }], sender, 1)
  assert.deepStrictEqual(item, {})
})

test('does not carry prototype pollution through', () => {
  const hostile = JSON.parse('{"label":"x","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}')
  build([hostile], sender, 1)
  assert.strictEqual({}.polluted, undefined)
})

test('caps the whole tree, not just each level', () => {
  const wide = (n, depth) => Array.from({ length: n }, () =>
    depth ? { label: 'x', submenu: wide(n, depth - 1) } : { label: 'x' })
  // 30 per level is under the old per-level cap, but 27,930 items in total
  assert.ok(count(build(wide(30, 2), sender, 1)) <= 100)
})

test('stops at the depth limit instead of recursing forever', () => {
  let deep = [{ label: 'leaf' }]
  for (let i = 0; i < 5000; i++) {
    deep = [{ label: 'x', submenu: deep }]
  }
  const built = build(deep, sender, 1)
  let depth = 0
  let level = built
  while (level && level.length) {
    depth++
    level = level[0].submenu
  }
  assert.ok(depth <= 4)
})

test('ignores non-array and junk input', () => {
  for (const junk of [null, undefined, 'x', 42, {}, [null, 1, 'x', []]]) {
    assert.ok(Array.isArray(build(junk, sender, 1)))
  }
})

test('only safe integer item ids get a click handler', () => {
  const built = build([{ label: 'a', menuItemId: 1.5 }, { label: 'b', menuItemId: NaN }, { label: 'c', menuItemId: '1' }], sender, 1)
  assert.ok(built.every(i => i.click === undefined))
})
