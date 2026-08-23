/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const messages = require('../js/constants/messages')
const electron = require('electron')
const session = electron.session
const BrowserWindow = electron.BrowserWindow
const webContents = electron.webContents
const AppStore = require('../js/stores/appStore')
const AppConfig = require('../js/constants/appConfig')
const Partitions = require('../js/constants/partitions')

// Electron allows exactly one listener per webRequest event per session: a
// second registration silently replaces the first. So this module owns both
// hooks and everything else registers a callback here.
const filteringFns = []
const beforeRequestFns = []

/**
 * Runs during onBeforeSendHeaders. The callback may block a request, and may
 * return cbArgs with requestHeaders to rewrite.
 * @param {function(object): object} filteringFn
 */
module.exports.registerFilteringCB = filteringFn => {
  filteringFns.push(filteringFn)
}

/**
 * Runs during onBeforeRequest, the only hook that can cancel a top level
 * navigation or redirect one. The callback returns {cancel} or {redirectURL},
 * or nothing to stay out of the way. The first callback to answer wins.
 * @param {function(object): object|undefined} beforeRequestFn
 */
module.exports.registerBeforeRequestCB = beforeRequestFn => {
  beforeRequestFns.push(beforeRequestFn)
}

/**
 * The URL of the page a request belongs to. Brave's Electron fork put this on
 * the details object as firstPartyUrl; upstream Electron does not, so it is
 * derived from the WebContents that issued the request. Every filtering
 * callback depends on it.
 * @param {object} details a webRequest details object
 * @return {string} the first party URL, falling back to the request's own URL
 */
function firstPartyUrl (details) {
  if (details.firstPartyUrl) {
    return details.firstPartyUrl
  }
  if (details.resourceType === 'mainFrame') {
    return details.url
  }
  if (details.webContentsId) {
    const wnd = webContents.fromId(details.webContentsId)
    if (wnd && !wnd.isDestroyed()) {
      const url = wnd.getURL()
      if (url) {
        return url
      }
    }
  }
  return details.url
}

/**
 * Runs a registered callback, converting anything it throws into a plain
 * non-answer. A poisoned or buggy filter list must cost itself its verdict,
 * not stall every request the page makes - the webRequest callback has to be
 * invoked exactly once or Chromium waits forever.
 * @param {function} fn
 * @param {object} details
 * @return {object|undefined} whatever the callback answered
 */
function safely (fn, details) {
  try {
    return fn(details)
  } catch (err) {
    if (process.env.BRAVE_DEBUG) {
      console.log('[filtering] a filter callback threw:', err.message)
    }
    return undefined
  }
}

/**
 * Register for notifications for webRequest notifications for
 * a particular session.
 * @param {object} The session to add webRequest filtering on
 */
function registerForSession (session) {
  session.webRequest.onBeforeRequest(function (details, cb) {
    details.firstPartyUrl = firstPartyUrl(details)

    for (let i = 0; i < beforeRequestFns.length; i++) {
      const response = safely(beforeRequestFns[i], details)
      if (response) {
        cb(response)
        return
      }
    }
    cb({})
  })

  session.webRequest.onBeforeSendHeaders(function (details, cb) {
    details.firstPartyUrl = firstPartyUrl(details)

    let results
    let requestHeaders
    for (let i = 0; i < filteringFns.length; i++) {
      let currentResults = safely(filteringFns[i], details)
      if (!currentResults) {
        continue
      }
      if (!module.exports.isResourceEnabled(currentResults.resourceName)) {
        continue
      }
      results = currentResults
      // Header rewrites from every callback are merged, so that site hacks and
      // the privacy rewrites do not cancel each other out.
      if (results.cbArgs && results.cbArgs.requestHeaders) {
        requestHeaders = Object.assign(requestHeaders || {}, results.cbArgs.requestHeaders)
      }
      if (results.shouldBlock) {
        break
      }
    }

    if (!results) {
      cb({})
    } else if (results.shouldBlock) {
      // We have no good way of knowing which BrowserWindow the blocking is for
      // yet so send it everywhere and let listeners decide how to respond.
      if (process.env.BRAVE_DEBUG) {
        console.log(`[${results.resourceName}] blocked ${details.resourceType} ${details.url}`)
      }
      // Only the plain fields: a webRequest details object also carries
      // WebFrameMain and WebContents references, which cannot cross IPC.
      const blocked = {
        url: details.url,
        resourceType: details.resourceType,
        firstPartyUrl: details.firstPartyUrl
      }
      BrowserWindow.getAllWindows().forEach(wnd =>
        wnd.webContents.send(messages.BLOCKED_RESOURCE, results.resourceName, blocked))
      cb({
        cancel: results.shouldBlock
      })
    } else if (requestHeaders) {
      cb({ requestHeaders })
    } else {
      cb({})
    }
  })
}

module.exports.isThirdPartyHost = (baseContextHost, testHost) => {
  if (!testHost.endsWith(baseContextHost)) {
    return true
  }

  let c = testHost[testHost.length - baseContextHost.length - 1]
  return c !== '.' && c !== undefined
}

module.exports.init = () => {
  registerForSession(session.fromPartition(Partitions.web))
  registerForSession(session.fromPartition(Partitions.private))
}

module.exports.isResourceEnabled = (resourceName) => {
  const enabledFromState = AppStore.getState().getIn([resourceName, 'enabled'])
  if (enabledFromState === undefined) {
    return AppConfig[resourceName].enabled
  }
  return enabledFromState
}
