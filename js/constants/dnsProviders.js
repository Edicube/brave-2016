/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// DNS-over-HTTPS resolvers the user can pick in Settings. Plain data, so both
// the main process (app/dnsProvider.js) and the UI can use it.

module.exports = {
  quad9: {
    label: 'Quad9',
    note: 'blocks known malicious domains',
    template: 'https://dns.quad9.net/dns-query'
  },
  cloudflare: {
    label: 'Cloudflare',
    note: 'fast, minimal logging',
    template: 'https://cloudflare-dns.com/dns-query'
  },
  mullvad: {
    label: 'Mullvad',
    note: 'no logging, blocks ads and trackers',
    template: 'https://base.dns.mullvad.net/dns-query'
  }
}
