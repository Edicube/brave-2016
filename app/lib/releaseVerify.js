/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// The checks an update must pass before anything from it runs, kept free of
// Electron so they can be tested on their own (test/unit/releaseVerify.test.js).
//
// Order matters: the signature proves the checksum list came from the release
// workflow; the checksum ties the archive to that list; the listing check makes
// sure extracting the archive cannot write anywhere but its own directory.

const crypto = require('crypto')

/**
 * @param {Buffer|string} sums contents of SHA256SUMS.txt
 * @param {string} signature base64 Ed25519 signature over those exact bytes
 * @param {string} publicKeyPem
 * @return {boolean}
 */
module.exports.verifySignature = (sums, signature, publicKeyPem) => {
  try {
    const sig = Buffer.from(String(signature).trim(), 'base64')
    if (sig.length !== 64) {
      return false
    }
    return crypto.verify(null, Buffer.from(sums), crypto.createPublicKey(publicKeyPem), sig)
  } catch (e) {
    return false
  }
}

/**
 * The expected SHA-256 of one file, from a sha256sum-format list. Exactly one
 * well-formed line must name the file.
 * @param {string} sums
 * @param {string} fileName a bare file name
 * @return {string|null} lowercase hex, or null
 */
module.exports.expectedHash = (sums, fileName) => {
  if (typeof sums !== 'string' || typeof fileName !== 'string' ||
      !fileName || /[/\\\n]/.test(fileName)) {
    return null
  }
  const matches = sums.split('\n').map(line => line.match(/^([0-9a-f]{64}) [ *](.+)$/))
    .filter(m => m && m[2] === fileName)
  return matches.length === 1 ? matches[0][1] : null
}

/**
 * Checks a `tar -tvzf` listing before extraction: only regular files and
 * directories, all inside `root/`, no absolute paths and no `..`. Links of any
 * kind are refused - the packaged build contains none, and a link is the
 * usual way to make an extraction write outside its directory.
 *
 * @param {string} listing output of `tar -tvzf`
 * @param {string} root the one top-level directory the archive may contain
 * @return {{ok: boolean, why: string, files: number}}
 */
module.exports.checkListing = (listing, root) => {
  const lines = String(listing).split('\n').filter(l => l.trim())
  if (!lines.length) {
    return { ok: false, why: 'empty archive', files: 0 }
  }
  let files = 0
  for (const line of lines) {
    // GNU tar: perms owner/group size date time name
    const m = line.match(/^([-dlhcbps])\S{9}\S*\s+\S+\s+\d+\s+\S+\s+\S+\s(.+)$/)
    if (!m) {
      return { ok: false, why: `unreadable entry: ${line}`, files }
    }
    const type = m[1]
    const name = m[2]
    if (type !== '-' && type !== 'd') {
      return { ok: false, why: `not a plain file or directory: ${name}`, files }
    }
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) {
      return { ok: false, why: `path escapes the archive: ${name}`, files }
    }
    if (name !== root + '/' && !name.startsWith(root + '/')) {
      return { ok: false, why: `outside ${root}/: ${name}`, files }
    }
    if (type === '-') {
      files++
    }
  }
  return { ok: true, why: '', files }
}

/**
 * Release asset URLs must come from this repository's releases, over https.
 * @param {string} target
 * @param {string} repo e.g. 'Edicube/brave-2016'
 * @param {string} tag
 * @return {boolean}
 */
module.exports.isReleaseAssetUrl = (target, repo, tag) => {
  const prefix = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/`
  return typeof target === 'string' && target.startsWith(prefix) &&
    !target.slice(prefix.length).includes('/')
}
