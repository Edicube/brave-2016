/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// History limits and removal, and the DNS provider choice.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Immutable = require('immutable')

const siteUtil = require('../../js/state/siteUtil')
const dnsProvider = require('../../app/dnsProvider')

const site = (location, t, tags) => Immutable.fromJS({
  location, title: location, lastAccessed: new Date(t), tags: tags || []
})

test('history is capped to the newest entries, bookmarks are kept', () => {
  let sites = Immutable.List([site('https://old.example/', 1, ['bookmark'])])
  for (let i = 0; i < 20; i++) {
    sites = sites.push(site(`https://h${i}.example/`, 1000 + i))
  }
  const capped = siteUtil.capHistory(sites, 5)
  const locations = capped.map(s => s.get('location')).toArray()
  assert.strictEqual(capped.size, 6)
  assert.ok(locations.includes('https://old.example/'))
  assert.ok(locations.includes('https://h19.example/'))
  assert.ok(!locations.includes('https://h14.example/'))
})

test('removing history keeps a bookmark at the same address', () => {
  const sites = Immutable.List([
    site('https://a.example/', 1),
    site('https://b.example/', 2),
    site('https://b.example/', 3, ['bookmark'])
  ])
  const left = siteUtil.removeHistoryEntry(sites, 'https://b.example/')
  assert.strictEqual(left.size, 2)
  assert.strictEqual(siteUtil.clearHistory(sites).size, 1)
})

test('private tabs add nothing to history', () => {
  const frame = Immutable.fromJS({ location: 'https://p.example/', isPrivate: true })
  assert.strictEqual(siteUtil.addSite(Immutable.List(), frame).size, 0)
})

test('DNS provider: only known names are saved, bad files fall back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brave-dns-'))
  try {
    assert.strictEqual(dnsProvider.current(dir), 'quad9')
    assert.strictEqual(dnsProvider.choose(dir, 'cloudflare'), true)
    assert.strictEqual(dnsProvider.current(dir), 'cloudflare')
    assert.match(dnsProvider.template(dir), /^https:\/\//)
    assert.strictEqual(dnsProvider.choose(dir, '__proto__'), false)
    assert.strictEqual(dnsProvider.choose(dir, 'https://evil.example/dns-query'), false)
    fs.writeFileSync(path.join(dir, 'dns.json'), '{"provider":"constructor"}')
    assert.strictEqual(dnsProvider.current(dir), 'quad9')
    fs.writeFileSync(path.join(dir, 'dns.json'), 'not json')
    assert.strictEqual(dnsProvider.current(dir), 'quad9')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('every DNS provider uses an https template', () => {
  for (const [name, p] of Object.entries(dnsProvider.providers)) {
    assert.match(p.template, /^https:\/\/[^\s]+$/, name)
  }
})
