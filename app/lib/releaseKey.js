/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// The public half of the key that signs every release's SHA256SUMS.txt
// (.github/workflows/release.yml). The private half exists only as the
// UPDATE_SIGNING_KEY secret of the GitHub repository.
//
// An update is installed only if its checksums carry a valid signature from
// this key, so replacing it is the one change to this file that matters.
// Rotating it means one release installed by hand, carrying the new key.

module.exports = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJsY7KI6hJdgMCB2dg+ICQSuQJOpUCq7pS8unke/qsiY=
-----END PUBLIC KEY-----
`
