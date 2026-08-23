/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The blocked address arrives in the fragment, so it never becomes part of the
// path this page is checked against. Written with textContent, never as markup.
(function () {
  var raw = window.location.hash.replace(/^#/, '')
  if (!raw) {
    return
  }
  var target = document.getElementById('url')
  try {
    target.textContent = decodeURIComponent(raw)
  } catch (e) {
    target.textContent = raw
  }
})()
