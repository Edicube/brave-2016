/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Why the page was refused arrives in the fragment, so none of it becomes part
// of the path this page is checked against. Everything is written with
// textContent, never as markup.

(function () {
  var reasons = {
    phishing: {
      heading: 'This site was blocked',
      summary: 'It appears on a phishing or malware blocklist, so Brave did not load it.',
      why: 'Sites land on these lists for impersonating a login page, or for ' +
           'serving malware. If you are certain this one is safe, the blocklist ' +
           'can be turned off under "phishing" in js/constants/appConfig.js. ' +
           'There is deliberately no button here to continue.'
    },
    certificate: {
      heading: 'This connection is not private',
      summary: 'The site’s certificate could not be verified, so Brave did not load it.',
      why: 'This means the identity of the server could not be established: the ' +
           'certificate may be expired, issued for a different name, or issued by ' +
           'an authority this browser does not trust — which is also what a ' +
           'network attacker intercepting the connection looks like. Certificates ' +
           'from privately installed roots, as used by corporate TLS inspection, ' +
           'are refused too. There is no button here to continue, and reaching the ' +
           'site over http instead would send everything in the clear.'
    },
    unknown: {
      heading: 'This page was not loaded',
      summary: 'Brave refused to load it.',
      why: ''
    }
  }

  var detail = {}
  var raw = window.location.hash.replace(/^#/, '')
  if (raw) {
    try {
      detail = JSON.parse(decodeURIComponent(raw)) || {}
    } catch (e) {
      detail = { url: raw }
    }
  }

  var reason = reasons[detail.reason] || reasons.unknown
  document.getElementById('heading').textContent = reason.heading
  document.getElementById('summary').textContent = reason.summary
  document.getElementById('why').textContent =
    reason.why + (detail.detail ? ' (' + detail.detail + ')' : '')
  document.getElementById('url').textContent =
    detail.url || 'the address is not available'
  document.title = reason.heading
})()
