/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Why the page was refused arrives in the fragment, so none of it becomes part
// of the path this page is checked against. Everything is written with
// textContent, never as markup.

(function () {
  const reasons = {
    phishing: {
      heading: 'This site was blocked',
      summary: 'It appears on a phishing or malware blocklist, so Brave did not load it.',
      why: 'Sites land on these lists for impersonating a login page, or for ' +
           'serving malware. Never enter a password or payment details on a site ' +
           'you reached this way.',
      proceed: 'This is a mistake - continue to the site until Brave closes'
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
    nohttps: {
      heading: 'This site does not offer a secure connection',
      summary: 'HTTPS-only is on, and this site could not be reached over HTTPS.',
      why: 'Loading it over plain HTTP would send everything - including anything ' +
           'you type - in the clear, readable and changeable by anyone on the ' +
           'network. To reach it anyway, turn off "HTTPS-only" in the Bravery menu.'
    },
    crashed: {
      heading: 'This page crashed',
      summary: 'The process showing this tab stopped unexpectedly.',
      why: 'This is usually the page itself - running out of memory, or a bug in ' +
           'the browser engine. Reloading often works.',
      action: 'Reload'
    },
    unknown: {
      heading: 'This page was not loaded',
      summary: 'Brave refused to load it.',
      why: ''
    }
  }

  let detail = {}
  const raw = window.location.hash.replace(/^#/, '')
  if (raw) {
    try {
      detail = JSON.parse(decodeURIComponent(raw)) || {}
    } catch (e) {
      detail = { url: raw }
    }
  }

  const reason = reasons[detail.reason] || reasons.unknown
  document.getElementById('heading').textContent = reason.heading
  document.getElementById('summary').textContent = reason.summary
  document.getElementById('why').textContent =
    reason.why + (detail.detail ? ' (' + detail.detail + ')' : '')
  document.getElementById('url').textContent =
    detail.url || 'the address is not available'
  document.title = reason.heading

  // Past a phishing warning. The main process gave this page a one-time token
  // and waits for the page to put it in its own fragment; nothing else here
  // can reach the main process.
  var proceed = document.getElementById('proceed')
  if (reason.proceed && typeof detail.proceed === 'string' && /^[0-9a-f]{32}$/.test(detail.proceed)) {
    proceed.textContent = reason.proceed
    proceed.hidden = false
    proceed.addEventListener('click', function () {
      window.location.hash = encodeURIComponent(JSON.stringify({
        url: detail.url, reason: detail.reason, go: detail.proceed
      }))
    })
  }

  // The one action this page offers: reloading a crashed page. Only ever to a
  // web address, never to anything else that could arrive in the fragment.
  var button = document.getElementById('action')
  if (reason.action && /^https?:\/\//.test(detail.url || '')) {
    button.textContent = reason.action
    button.hidden = false
    button.addEventListener('click', function () {
      window.location.href = detail.url
    })
  }
})()
