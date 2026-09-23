/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Refuses navigations to known phishing and malware URLs, and shows a warning
// page instead. Electron has no Safe Browsing equivalent, so without this a
// page that Chrome would put behind a red interstitial loads normally.
//
// This runs in Filtering's onBeforeRequest registry rather than the header
// hook, because unlike ad blocking it has to cancel a top level navigation.

const crypto = require('crypto')
const electron = require('electron')
const webContents = electron.webContents
const FilterEngine = require('./lib/filterEngine')
const Filtering = require('./filtering')
const Security = require('./security')
const UiProtocol = require('./uiProtocol')
const AppConfig = require('../js/constants/appConfig')

module.exports.resourceName = 'phishing'

let engine

// Hosts the user chose to visit despite the warning, until Brave closes
const bypassed = new Set()
// token -> { id: the tab's webContents id, url }: the one way past the
// warning. Only the warning page shown in that very tab knows the token.
const offers = new Map()
const listening = new WeakSet()

const hostOf = (target) => {
  try {
    return new URL(target).hostname
  } catch (e) {
    return ''
  }
}

// The warning page answers by changing its own fragment - it has no bridge
// and cannot navigate to anything privileged. The token must match an offer
// made to this same tab, so neither another page nor another tab can use it.
function listenForProceed (target) {
  if (listening.has(target)) {
    return
  }
  listening.add(target)
  target.on('did-navigate-in-page', (event, url, isMainFrame) => {
    if (!isMainFrame || !url.startsWith(UiProtocol.url('blocked.html') + '#')) {
      return
    }
    let answer
    try {
      answer = JSON.parse(decodeURIComponent(url.slice(url.indexOf('#') + 1)))
    } catch (e) {
      return
    }
    const offer = answer && typeof answer.go === 'string' && offers.get(answer.go)
    if (!offer || offer.id !== target.id) {
      return
    }
    offers.delete(answer.go)
    bypassed.add(hostOf(offer.url))
    debug(`the user chose to continue to ${hostOf(offer.url)}`)
    target.loadURL(offer.url).catch(() => {})
  })
}

function offerProceed (target, url) {
  const token = crypto.randomBytes(16).toString('hex')
  offers.set(token, { id: target.id, url })
  if (offers.size > 100) {
    offers.delete(offers.keys().next().value)
  }
  listenForProceed(target)
  return token
}

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[phishing]', ...args)
  }
}

// Only documents are checked: top level pages and frames. That is where
// phishing happens - the fake login page itself - and where a malware
// download starts. Matching these lists is also far slower than the ad lists
// (about 1.8ms a request against 20us), so running it on every image and
// script would cost a busy page a noticeable fraction of a second.
const documentTypes = new Set(['mainFrame', 'subFrame'])

function checkRequest (details) {
  if (!engine || !documentTypes.has(details.resourceType) ||
      !Filtering.isResourceEnabled(module.exports.resourceName) ||
      bypassed.has(hostOf(details.url))) {
    return undefined
  }

  const isTopLevel = details.resourceType === 'mainFrame'
  const result = engine.match(FilterEngine.Request.fromRawDetails({
    url: details.url,
    sourceUrl: isTopLevel ? details.url : details.firstPartyUrl || details.url,
    type: FilterEngine.requestType(details)
  }))

  if (!result.match) {
    return undefined
  }

  // shown on the warning page, so a false positive can at least be judged
  let rule = ''
  try {
    rule = result.filter ? String(result.filter.toString()).slice(0, 160) : ''
  } catch (e) {}

  debug(`blocked ${details.resourceType} ${details.url}`)

  if (isTopLevel && details.webContentsId) {
    // Cancelling on its own leaves a blank page, so send the frame to the
    // warning instead. Deferred because the navigation is still unwinding.
    const target = webContents.fromId(details.webContentsId)
    if (target && !target.isDestroyed()) {
      const warning = Security.blockedPageUrl(details.url, 'phishing',
        rule ? 'matched rule: ' + rule : undefined,
        /^https?:\/\//.test(details.url) ? { proceed: offerProceed(target, details.url) } : undefined)
      setImmediate(() => {
        if (!target.isDestroyed()) {
          target.loadURL(warning).catch(() => {})
        }
      })
    }
  }

  return { cancel: true }
}

module.exports.init = () => {
  if (!AppConfig[module.exports.resourceName].enabled) {
    return
  }

  Filtering.registerBeforeRequestCB(checkRequest)

  FilterEngine.load(module.exports.resourceName, FilterEngine.phishingLists, (loaded) => {
    engine = loaded
    debug('blocklist ready')
  }).catch((err) => {
    console.log('could not init phishing protection:', (err && err.message) || err)
  })
}
