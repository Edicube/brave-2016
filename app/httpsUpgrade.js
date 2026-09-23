/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// HTTPS Everywhere shipped a ruleset of hosts known to support TLS. Browsers
// stopped needing that and now simply try HTTPS first, falling back only when
// it does not work. This does the same thing, in place of the retired
// extension: top level http navigations are retried over https, and hosts that
// genuinely cannot do TLS are remembered so they are not upgraded again.

const electron = require('electron')
const app = electron.app
const fs = require('fs')
const path = require('path')
// Not url.parse: it and the WHATWG parser disagree about the host for inputs
// like http://evil.com\@good.com/, and every decision here keys off the host
const hostOf = (target) => {
  try {
    return new URL(target).host
  } catch (e) {
    return null
  }
}
const Filtering = require('./filtering')
const AppConfig = require('../js/constants/appConfig')

module.exports.resourceName = 'httpsUpgrade'

// hosts that failed over https, so the upgrade is not attempted again
const noTls = new Set()
// upgrades currently in flight, to tell a genuine failure from a redirect loop
const attempted = new Map()

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[https]', ...args)
  }
}

const storePath = () => path.join(app.getPath('userData'), 'no-tls-hosts.json')

function load () {
  try {
    JSON.parse(fs.readFileSync(storePath(), 'utf8')).forEach(host => noTls.add(host))
    debug(`${noTls.size} hosts known not to support TLS`)
  } catch (e) {
    // no list yet, which is the normal first run
  }
}

let saveTimer = null
function saveSoon () {
  if (saveTimer) {
    return
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    fs.writeFile(storePath(), JSON.stringify([...noTls]), () => {})
  }, 5000)
}

/**
 * Remembers that a host could not be reached over https, and stops upgrading
 * it. Called from the navigation failure path.
 * @param {string} host
 */
module.exports.markNoTls = (host) => {
  if (host && !noTls.has(host)) {
    noTls.add(host)
    debug('gave up upgrading', host)
    saveSoon()
  }
}

// Failures that mean there is nothing listening for TLS on the host, as
// opposed to a certificate problem. Certificate errors are deliberately not in
// this list: a site with a bad certificate does support TLS, and silently
// dropping to http on a certificate error is precisely the downgrade an
// attacker would want. Falling back on a connection level failure is safe
// because the navigation started as http anyway, so http is where it would
// have gone without this feature.
const noTlsFailures = new Set([
  -100, // ERR_CONNECTION_CLOSED
  -101, // ERR_CONNECTION_RESET
  -102, // ERR_CONNECTION_REFUSED
  -104, // ERR_CONNECTION_FAILED
  -107, // ERR_SSL_PROTOCOL_ERROR
  -118, // ERR_CONNECTION_TIMED_OUT
  -324 // ERR_EMPTY_RESPONSE
])

/**
 * Watches a web page for an upgrade that did not work out, and sends it back
 * to http once, remembering the host.
 * @param {WebContents} contents
 */
module.exports.watch = (contents) => {
  contents.on('did-fail-load', (event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || !validatedUrl || !validatedUrl.startsWith('https://')) {
      return
    }
    const host = hostOf(validatedUrl)
    if (!attempted.has(host) || !noTlsFailures.has(errorCode)) {
      return
    }
    attempted.delete(host)
    module.exports.markNoTls(host)
    const downgraded = 'http://' + validatedUrl.slice('https://'.length)

    if (httpsOnly()) {
      debug(`${errorDescription} on ${host}; HTTPS-only, not falling back`)
      const warning = require('./security').blockedPageUrl(downgraded, 'nohttps', errorDescription)
      if (!contents.isDestroyed()) {
        contents.loadURL(warning).catch(() => {})
      }
      return
    }

    debug(`${errorDescription} on ${host}, falling back to http`)
    if (!contents.isDestroyed()) {
      contents.loadURL(downgraded).catch(() => {})
    }
  })

  // a successful load means the upgrade held
  contents.on('did-finish-load', () => {
    if (contents.isDestroyed()) {
      return
    }
    const host = hostOf(contents.getURL())
    if (host) {
      attempted.delete(host)
    }
  })
}

// HTTPS-only: upgrade every host, never fall back to plain HTTP
const httpsOnly = () => Filtering.isResourceEnabled('httpsOnly')

function checkRequest (details) {
  if (details.resourceType !== 'mainFrame' || !details.url.startsWith('http://')) {
    return undefined
  }
  if (!httpsOnly() && !Filtering.isResourceEnabled(module.exports.resourceName)) {
    return undefined
  }

  let parsed
  try {
    parsed = new URL(details.url)
  } catch (e) {
    return undefined
  }
  const host = parsed.host
  if (!host || (noTls.has(host) && !httpsOnly())) {
    return undefined
  }
  // localhost and bare IPs are not going to have a certificate
  if (parsed.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) ||
      parsed.hostname.endsWith('.local')) {
    return undefined
  }

  const upgraded = 'https://' + details.url.slice('http://'.length)
  attempted.set(host, Date.now())
  debug('upgrading', details.url)
  return { redirectURL: upgraded }
}

module.exports.init = () => {
  if (!AppConfig[module.exports.resourceName].enabled) {
    return
  }
  load()
  Filtering.registerBeforeRequestCB(checkRequest)

  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
      module.exports.watch(contents)
    }
  })
}
