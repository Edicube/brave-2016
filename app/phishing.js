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

const electron = require('electron')
const webContents = electron.webContents
const FilterEngine = require('./lib/filterEngine')
const Filtering = require('./filtering')
const Security = require('./security')
const AppConfig = require('../js/constants/appConfig')

module.exports.resourceName = 'phishing'

let engine

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[phishing]', ...args)
  }
}

function checkRequest (details) {
  if (!engine) {
    return undefined
  }

  const isTopLevel = details.resourceType === 'mainFrame'
  const matched = engine.match(FilterEngine.Request.fromRawDetails({
    url: details.url,
    sourceUrl: isTopLevel ? details.url : details.firstPartyUrl || details.url,
    type: FilterEngine.requestType(details)
  })).match

  if (!matched) {
    return undefined
  }

  debug(`blocked ${details.resourceType} ${details.url}`)

  if (isTopLevel && details.webContentsId) {
    // Cancelling on its own leaves a blank page, so send the frame to the
    // warning instead. Deferred because the navigation is still unwinding.
    const target = webContents.fromId(details.webContentsId)
    if (target && !target.isDestroyed()) {
      const warning = Security.blockedPageUrl(details.url)
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
