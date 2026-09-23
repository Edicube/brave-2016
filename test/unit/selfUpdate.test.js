/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The self-updater, against fake releases signed with a throwaway key: it must
// accept a correct release and refuse every way of tampering with one. The
// last step, pkexec, is not run here.

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    return { app: {}, net: {} }
  }
  return originalLoad.apply(this, arguments)
}
const SelfUpdate = require('../../app/selfUpdate')
const Verify = require('../../app/lib/releaseVerify')
Module._load = originalLoad

const repo = 'Edicube/brave-2016'
const tag = 'v9.9.9'
const archiveName = `brave-2016-${tag}-linux-x64.tar.gz`
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const pub = publicKey.export({ type: 'spki', format: 'pem' })
const other = crypto.generateKeyPairSync('ed25519').privateKey

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'selfupdate-test-'))
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }))

// builds an archive; `extra` can add hostile entries
function buildArchive (name, extra) {
  const dir = fs.mkdtempSync(path.join(scratch, 'src-'))
  const root = path.join(dir, 'Brave 2016-linux-x64')
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Brave 2016'), '#!/bin/sh\n', { mode: 0o755 })
  fs.writeFileSync(path.join(root, 'install.sh'), '#!/bin/sh\n')
  fs.writeFileSync(path.join(root, 'resources', 'app.asar'), 'asar')
  const entries = ['Brave 2016-linux-x64']
  if (extra) {
    entries.push(...extra(dir, root))
  }
  const file = path.join(scratch, name)
  execFileSync('tar', ['-C', dir, '-czf', file, ...entries])
  return fs.readFileSync(file)
}

function release (files, options) {
  options = options || {}
  const archive = files.archive
  const sums = options.sums ||
    `${crypto.createHash('sha256').update(options.sumOf || archive).digest('hex')}  ${archiveName}\n`
  const sig = options.sig || crypto.sign(null, Buffer.from(sums), options.key || privateKey).toString('base64')
  const base = `https://github.com/${repo}/releases/download/${options.tag || tag}/`
  const served = {
    [base + archiveName]: archive,
    [base + 'SHA256SUMS.txt']: Buffer.from(sums),
    [base + 'SHA256SUMS.txt.sig']: Buffer.from(sig)
  }
  const fetch = async (url) => {
    const body = served[url]
    return body
      ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })
      : new Response('', { status: 404 })
  }
  const assets = Object.keys(served).map(url => ({ name: url.slice(base.length), browser_download_url: options.assetUrl || url }))
  return { rel: { tag_name: options.tag || tag, assets }, fetch }
}

const prepare = (r) => SelfUpdate.prepare(r.rel, { repo, fetch: r.fetch, publicKey: pub })

test('a correctly signed release is downloaded, checked and extracted', async () => {
  const dir = await prepare(release({ archive: buildArchive('good.tgz') }))
  assert.ok(fs.existsSync(path.join(dir, 'install.sh')))
  assert.ok(fs.existsSync(path.join(dir, 'Brave 2016')))
  fs.rmSync(path.dirname(dir), { recursive: true, force: true })
})

test('refuses a checksum list signed with another key', async () => {
  await assert.rejects(prepare(release({ archive: buildArchive('k.tgz') }, { key: other })), /not signed/)
})

test('refuses a garbage signature', async () => {
  await assert.rejects(prepare(release({ archive: buildArchive('g.tgz') }, { sig: 'AAAA' })), /not signed/)
})

test('refuses an archive that does not match its signed checksum', async () => {
  const archive = buildArchive('t.tgz')
  await assert.rejects(prepare(release({ archive }, { sumOf: Buffer.from('something else') })), /does not match/)
})

test('refuses a signed list that does not name the archive', async () => {
  const archive = buildArchive('n.tgz')
  const sums = `${crypto.createHash('sha256').update(archive).digest('hex')}  brave-2016-v0.1.0-linux-x64.tar.gz\n`
  await assert.rejects(prepare(release({ archive }, { sums })), /does not cover/)
})

test('refuses assets hosted anywhere but this repository', async () => {
  const r = release({ archive: buildArchive('h.tgz') })
  r.rel.assets.forEach(a => { a.browser_download_url = a.browser_download_url.replace('Edicube/brave-2016', 'evil/brave-2016') })
  await assert.rejects(prepare(r), /no SHA256SUMS\.txt/)
})

test('refuses a tag that is not a plain version', async () => {
  const r = release({ archive: buildArchive('v.tgz') })
  r.rel.tag_name = 'v1.0.0/../../x'
  await assert.rejects(prepare(r), /usable tag/)
})

test('refuses an archive containing a symlink', async () => {
  const archive = buildArchive('sym.tgz', (dir, root) => {
    fs.symlinkSync('/etc/passwd', path.join(root, 'link'))
    return []
  })
  await assert.rejects(prepare(release({ archive })), /not a plain file/)
})

test('refuses an archive with a second top-level directory', async () => {
  const archive = buildArchive('extra.tgz', (dir) => {
    fs.mkdirSync(path.join(dir, 'elsewhere'))
    fs.writeFileSync(path.join(dir, 'elsewhere', 'x'), 'x')
    return ['elsewhere']
  })
  await assert.rejects(prepare(release({ archive })), /outside/)
})

test('listing check refuses traversal, absolute paths and links', () => {
  const root = 'Brave 2016-linux-x64'
  const line = (t, name) => `${t}rw-r--r-- u/g 1 2026-01-01 00:00 ${name}`
  assert.ok(Verify.checkListing(line('d', root + '/') + '\n' + line('-', root + '/a'), root).ok)
  for (const bad of [
    line('-', root + '/../x'),
    line('-', '/etc/cron.d/x'),
    line('l', root + '/l -> /etc/passwd'),
    line('h', root + '/h link to /etc/passwd'),
    line('-', 'other/x'),
    line('c', root + '/dev'),
    'nonsense'
  ]) {
    assert.strictEqual(Verify.checkListing(bad, root).ok, false, bad)
  }
})

test('expected hash needs exactly one well-formed line for the file', () => {
  const h = 'a'.repeat(64)
  assert.strictEqual(Verify.expectedHash(`${h}  f.tgz\n`, 'f.tgz'), h)
  assert.strictEqual(Verify.expectedHash(`${h}  f.tgz\n${h}  f.tgz\n`, 'f.tgz'), null)
  assert.strictEqual(Verify.expectedHash(`${h.slice(1)}  f.tgz\n`, 'f.tgz'), null)
  assert.strictEqual(Verify.expectedHash(`${h}  f.tgz\n`, '../f.tgz'), null)
})
