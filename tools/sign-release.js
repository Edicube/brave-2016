/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Signs a release's checksum list for the self-updater (app/selfUpdate.js).
// Run by .github/workflows/release.yml with the UPDATE_SIGNING_KEY secret.
//
//   UPDATE_SIGNING_KEY="$(cat key.pem)" node tools/sign-release.js SHA256SUMS.txt
//
// Writes SHA256SUMS.txt.sig (base64 Ed25519), then checks it against the
// public key the app ships with, so a release signed with the wrong key fails
// here rather than in every user's browser.

const crypto = require('crypto')
const fs = require('fs')
const Verify = require('../app/lib/releaseVerify')
const publicKey = require('../app/lib/releaseKey')

const file = process.argv[2]
const pem = process.env.UPDATE_SIGNING_KEY
if (!file || !pem) {
  console.error('usage: UPDATE_SIGNING_KEY=<pem> node tools/sign-release.js <SHA256SUMS.txt>')
  process.exit(1)
}

const data = fs.readFileSync(file)
const signature = crypto.sign(null, data, crypto.createPrivateKey(pem)).toString('base64')
fs.writeFileSync(file + '.sig', signature + '\n')

if (!Verify.verifySignature(data, signature, publicKey)) {
  console.error('the signing key does not match app/lib/releaseKey.js')
  process.exit(1)
}
console.log(`signed ${file}; verified against the shipped public key`)
