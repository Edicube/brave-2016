/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Installs a newer release, for a copy installed root-owned in /opt by
// tools/install-linux.sh. A copy run from a source checkout is never touched:
// it is told about the release and nothing more.
//
// Nothing from a download runs until all of these hold:
//   1. SHA256SUMS.txt carries a valid Ed25519 signature from the key in
//      app/lib/releaseKey.js, whose private half only the release workflow has
//   2. the archive's SHA-256 matches its line in that signed list, and its
//      name matches the release tag, so an old signed release cannot be passed
//      off as a new one
//   3. the archive holds only plain files and directories, all inside its one
//      top-level directory
// Then its own installer runs under pkexec, which asks for the admin password,
// and replaces /opt/brave-2016. The running browser is restarted afterwards.
//
// What this cannot defend against: something already running as your user can
// tamper with the extracted files in the moment between verification and the
// password prompt - but such a thing could equally put up a password prompt of
// its own.

const electron = require('electron')
const app = electron.app
const net = electron.net
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { Readable } = require('stream')
const Verify = require('./lib/releaseVerify')
const releaseKey = require('./lib/releaseKey')

const installDir = '/opt/brave-2016'
const archiveRoot = 'brave-2016-linux-x64'
const executable = 'brave-2016'

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[selfUpdate]', ...args)
  }
}

/**
 * Whether this is the root-owned install that can update itself.
 */
module.exports.canInstall = () =>
  process.platform === 'linux' &&
  process.execPath === path.join(installDir, executable) &&
  fs.existsSync(path.join(installDir, 'SHA256SUMS'))

function run (cmd, args, options) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({ maxBuffer: 64 * 1024 * 1024 }, options),
      (err, stdout, stderr) => err
        ? reject(new Error(`${cmd} failed: ${(stderr || err.message).toString().trim()}`))
        : resolve(stdout))
  })
}

async function fetchText (fetchImpl, target) {
  const res = await fetchImpl(target)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${target}`)
  }
  return res.text()
}

// streams to disk, hashing as it goes; reports progress as a fraction
async function download (fetchImpl, target, file, onProgress) {
  const res = await fetchImpl(target)
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} for ${target}`)
  }
  const total = Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(file, { mode: 0o600 })
  let received = 0
  await new Promise((resolve, reject) => {
    const body = Readable.fromWeb(res.body)
    body.on('data', (chunk) => {
      received += chunk.length
      hash.update(chunk)
      if (total && onProgress) {
        onProgress(received / total)
      }
    })
    body.on('error', reject)
    out.on('error', reject)
    out.on('finish', resolve)
    body.pipe(out)
  })
  return hash.digest('hex')
}

/**
 * Downloads and verifies a release, and extracts it into a private temporary
 * directory. Throws, and cleans up, on any failed check.
 *
 * @param {object} release a GitHub releases API object
 * @param {object} options
 * @param {string} options.repo 'owner/name'
 * @param {function=} options.fetch defaults to Electron's net.fetch
 * @param {string=} options.publicKey defaults to the release key
 * @param {function=} options.onProgress
 * @return {Promise<string>} the extracted directory, containing install.sh
 */
module.exports.prepare = async (release, options) => {
  const fetchImpl = options.fetch || ((u) => net.fetch(u))
  const publicKey = options.publicKey || releaseKey
  const tag = release && release.tag_name
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error('release has no usable tag')
  }

  const archiveName = `brave-2016-${tag}-linux-x64.tar.gz`
  const asset = (name) => {
    const found = (release.assets || []).find(a => a && a.name === name)
    if (!found || !Verify.isReleaseAssetUrl(found.browser_download_url, options.repo, tag)) {
      throw new Error(`release ${tag} has no ${name} from ${options.repo}`)
    }
    return found.browser_download_url
  }

  const sums = await fetchText(fetchImpl, asset('SHA256SUMS.txt'))
  const signature = await fetchText(fetchImpl, asset('SHA256SUMS.txt.sig'))
  if (!Verify.verifySignature(sums, signature, publicKey)) {
    throw new Error('the checksum list is not signed by the release key')
  }
  const expected = Verify.expectedHash(sums, archiveName)
  if (!expected) {
    throw new Error(`the signed checksum list does not cover ${archiveName}`)
  }
  debug('signature valid for', tag)

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'brave-2016-update-'))
  try {
    const archive = path.join(work, archiveName)
    const actual = await download(fetchImpl, asset(archiveName), archive, options.onProgress)
    if (actual !== expected) {
      throw new Error(`${archiveName} does not match its signed checksum`)
    }
    debug('archive checksum matches')

    const listing = await run('/usr/bin/tar', ['-tvzf', archive])
    const checked = Verify.checkListing(listing, archiveRoot)
    if (!checked.ok) {
      throw new Error('refusing the archive: ' + checked.why)
    }
    await run('/usr/bin/tar', ['-xzf', archive, '-C', work, '--no-same-owner'])
    fs.unlinkSync(archive)

    const extracted = path.join(work, archiveRoot)
    if (!fs.existsSync(path.join(extracted, 'install.sh')) ||
        !fs.existsSync(path.join(extracted, executable))) {
      throw new Error('the archive is not a Brave 2016 build')
    }
    return extracted
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true })
    throw e
  }
}

/**
 * Runs the verified installer as root. pkexec asks for the password.
 * @param {string} extracted directory returned by prepare()
 */
module.exports.install = async (extracted) => {
  try {
    // absolute paths: pkexec would otherwise resolve them through this
    // process's PATH, before raising privileges
    await run('/usr/bin/pkexec', ['/bin/sh', path.join(extracted, 'install.sh')])
  } finally {
    fs.rmSync(path.dirname(extracted), { recursive: true, force: true })
  }
}

module.exports.restart = () => {
  app.relaunch({ execPath: path.join(installDir, executable) })
  app.exit(0)
}
