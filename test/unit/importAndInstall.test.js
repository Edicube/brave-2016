/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reading exported bookmark files, and which install files count as critical.

const test = require('node:test')
const assert = require('node:assert')
const Module = require('node:module')
const path = require('node:path')

const BookmarksHtml = require('../../app/lib/bookmarksHtml')

test('reads a Netscape bookmark file from Chrome or Firefox', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
    <DL><p>
      <DT><H3>Folder</H3>
      <DL><p>
        <DT><A HREF="https://example.com/a?x=1&amp;y=2" ADD_DATE="1">Example &amp; Co</A>
        <DT><A href="http://example.org/" ICON="data:image/png;base64,AAA">  Spaced
          title </A>
      </DL><p>
      <DT><A HREF="https://example.com/a?x=1&amp;y=2">Duplicate</A>
      <DT><A HREF="https://nameless.example/"></A>
      <DT><A HREF="https://tag.example/"><b>Bold</b> &#233;t&#xE9;</A>
    </DL>`
  assert.deepStrictEqual(BookmarksHtml.parse(html), [
    { location: 'https://example.com/a?x=1&y=2', title: 'Example & Co' },
    { location: 'http://example.org/', title: 'Spaced title' },
    { location: 'https://nameless.example/', title: 'https://nameless.example/' },
    { location: 'https://tag.example/', title: 'Bold été' }
  ])
})

test('only web addresses are imported', () => {
  const html = ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:text/html,x',
    'file:///etc/passwd', 'brave://ui/', 'place:sort=8', 'https://ok.example/',
    'https://bad host/', ' https://trimmed.example/ ']
    .map(u => `<A HREF="${u}">x</A>`).join('\n')
  assert.deepStrictEqual(BookmarksHtml.parse(html).map(b => b.location),
    ['https://ok.example/', 'https://trimmed.example/'])
})

test('a huge file is capped', () => {
  let html = ''
  for (let i = 0; i < BookmarksHtml.maxBookmarks + 50; i++) {
    html += `<A HREF="https://e${i}.example/">${i}</A>\n`
  }
  assert.strictEqual(BookmarksHtml.parse(html).length, BookmarksHtml.maxBookmarks)
  assert.deepStrictEqual(BookmarksHtml.parse(null), [])
  assert.deepStrictEqual(BookmarksHtml.parse('<a href="https://x.example/'), [])
})

test('install check looks at the binary, its folder and the app archive', () => {
  const original = Module._load
  Module._load = function (request, ...rest) {
    return request === 'electron' ? { app: {} } : original.call(this, request, ...rest)
  }
  try {
    const InstallCheck = require('../../app/installCheck')
    const exe = path.join('/opt', 'brave-2016', 'brave-2016')
    const paths = InstallCheck.criticalPaths(exe)
    assert.ok(paths.includes(exe))
    assert.ok(paths.includes(path.join('/opt', 'brave-2016', 'resources', 'app.asar')))
    const writable = InstallCheck.writable(paths, p => {
      if (p.endsWith('resources')) throw new Error('EACCES')
      return p.endsWith('app.asar')
    })
    assert.deepStrictEqual(writable, [path.join('/opt', 'brave-2016', 'resources', 'app.asar')])
  } finally {
    Module._load = original
  }
})

test('closed windows are kept without private tabs, newest first, at most ten', () => {
  const original = Module._load
  Module._load = function (request, ...rest) {
    return request === 'electron'
      ? { app: { getPath: () => '/nonexistent' } }
      : original.call(this, request, ...rest)
  }
  try {
    const ClosedWindows = require('../../app/closedWindows')
    ClosedWindows.push({ frames: [{ key: 1, location: 'https://p.example/', isPrivate: true }], activeFrameKey: 1 })
    assert.strictEqual(ClosedWindows.size(), 0, 'a window of only private tabs is not kept')
    ClosedWindows.push(null)
    ClosedWindows.push({ frames: 'nope' })
    assert.strictEqual(ClosedWindows.size(), 0)

    for (let i = 0; i < 12; i++) {
      ClosedWindows.push({
        frames: [
          { key: 7, location: `https://w${i}.example/` },
          { key: 8, location: 'https://secret.example/', isPrivate: true }
        ],
        activeFrameKey: 8,
        closedFrames: [{ location: 'https://old.example/' }]
      })
    }
    assert.strictEqual(ClosedWindows.size(), 10)
    const last = ClosedWindows.pop()
    assert.deepStrictEqual(last.frames.map(f => f.location), ['https://w11.example/'])
    assert.strictEqual(last.activeFrameKey, last.frames[0].key)
    assert.strictEqual(last.closedFrames, undefined)
  } finally {
    Module._load = original
  }
})
