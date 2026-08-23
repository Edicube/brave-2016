/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Serves the browser's own UI over brave://ui/ instead of file://.
//
// Two things follow from that. The GrantFileProtocolExtraPrivileges fuse can be
// turned off, so nothing in this app gets the extra powers Chromium hands to
// file:// documents - script execution in the UI can no longer read the disk
// through fetch. And the file: scheme can then be refused outright in every
// session, rather than kept open for the app's own pages.

const electron = require('electron')
const protocol = electron.protocol
const net = electron.net
const path = require('path')
const url = require('url')

const scheme = 'brave'
const host = 'ui'

// Only the UI's own directory is reachable, and only these types
const uiRoot = path.join(__dirname)

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.l20n': 'text/plain',
  '.xml': 'application/xml'
}

/**
 * @param {string} relative a path under the UI root
 * @return {string} a brave://ui URL
 */
module.exports.url = (relative) => `${scheme}://${host}/${relative}`

module.exports.origin = `${scheme}://${host}`

/**
 * Whether a URL is one of the browser's own pages.
 * @param {string} target
 * @return {boolean}
 */
module.exports.isUiUrl = (target) => {
  try {
    const parsed = new url.URL(target)
    return parsed.protocol === `${scheme}:` && parsed.host === host
  } catch (e) {
    return false
  }
}

/**
 * Must run before the app is ready: the scheme has to be registered as
 * standard and secure before any session exists, or the UI would be treated as
 * an opaque origin and its own CSP and storage would not work.
 */
module.exports.registerScheme = () => {
  protocol.registerSchemesAsPrivileged([{
    scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }])
}

/**
 * Resolves a request path to a file inside the UI root, or null.
 * @param {string} requestUrl
 * @return {string|null}
 */
function resolve (requestUrl) {
  let parsed
  try {
    parsed = new url.URL(requestUrl)
  } catch (e) {
    return null
  }
  if (parsed.host !== host) {
    return null
  }

  let decoded
  try {
    decoded = decodeURIComponent(parsed.pathname)
  } catch (e) {
    return null
  }

  const resolved = path.resolve(uiRoot, '.' + decoded)
  if (resolved !== uiRoot && !resolved.startsWith(uiRoot + path.sep)) {
    return null
  }
  if (!contentTypes[path.extname(resolved).toLowerCase()]) {
    return null
  }
  return resolved
}

// Sent with every response, mirroring the <meta> policies the pages carry
// themselves. Headers and meta CSPs intersect rather than add up, so these
// are written to be identical to what index.html declares - plus a nosniff
// and a framing refusal, which have no meta equivalent that matters.
const securityHeaders = {
  // style-src keeps 'unsafe-inline' on purpose: React 0.14 and Electron's own
  // webview internals both apply styles through the style attribute, and the
  // hashes they need change with every build of either. The boundary that
  // matters is script-src, which stays 'self' with no unsafe-eval anywhere.
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self'; img-src 'self' data: blob: https: http:; " +
    "connect-src 'self' https:; form-action 'none'; base-uri 'none'; frame-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  // The UI loads nothing cross-origin, so cross-origin isolation costs it
  // nothing while making the window an attacker-hostile target to any site
  // that ends up holding a reference to it.
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin'
}

/**
 * @param {Session} ses register the handler on this session
 */
module.exports.handle = (ses) => {
  ses.protocol.handle(scheme, async (request) => {
    const file = resolve(request.url)
    if (!file) {
      return new Response('', { status: 404 })
    }
    // net.fetch reads through the ASAR archive the same way require does
    const fetched = await net.fetch(url.pathToFileURL(file).toString(),
      { bypassCustomProtocolHandlers: true })
    const headers = new Headers(fetched.headers)
    Object.keys(securityHeaders).forEach((name) => headers.set(name, securityHeaders[name]))
    const body = await fetched.arrayBuffer()
    return new Response(body, { status: fetched.status, headers })
  })
}

module.exports.scheme = scheme

// exported for test/unit/uiProtocol.test.js: this is the path traversal guard
module.exports.resolveForTest = resolve
module.exports.rootForTest = uiRoot
