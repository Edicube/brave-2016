/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const electron = require('electron')
const FilterEngine = require('./lib/filterEngine')
const parseDomain = require('tldts-experimental').parse
const Filtering = require('./filtering')
const AppConfig = require('../js/constants/appConfig')

module.exports.resourceName = 'adblock'

let adblock

// Cosmetic filters hide ad-shaped DOM nodes that network blocking cannot
// reach: the request never happens because the page builds it locally. The
// engine compiles CSS from the same filter lists; injecting it as user CSS
// keeps page stylesheets from overriding it.
// Registered at startup, before the engine has loaded, so that the first tab -
// created while the engine is still being read from disk - is covered too.
// Until the engine is ready the handler simply does nothing.
const watchForCosmetics = () => {
  electron.app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') {
      return
    }
    // dom-ready rather than did-finish-load: the document is parsed, but
    // images and frames are still loading, so ads never get a moment on screen
    contents.on('dom-ready', () => {
      if (!adblock || !Filtering.isResourceEnabled(module.exports.resourceName) ||
          Filtering.shieldsDownFor(module.exports.resourceName, contents.getURL())) {
        return
      }
      try {
        const url = contents.getURL()
        if (!/^https?:/.test(url)) {
          return
        }
        const parsed = parseDomain(url)
        const cosmetics = adblock.getCosmeticsFilters({
          url,
          hostname: parsed.hostname,
          // the registrable domain, so rules written for example.com also
          // apply on www.example.com
          domain: parsed.domain || parsed.hostname,
          // no DOM scan: that means a round trip through the page per load
          getRulesFromDOM: false
        })
        // Styles only. The engine also returns scriptlets, which would mean
        // running code inside every page; hiding elements does not need it.
        if (cosmetics && cosmetics.styles) {
          contents.insertCSS(cosmetics.styles, { cssOrigin: 'user' }).catch(() => {})
        }
      } catch (e) {
        // a page that will not parse is a page we simply do not decorate
      }
    })
  })
}

const startAdBlocking = () => {
  Filtering.registerFilteringCB(details => {
    // never cancel a top level navigation, only what a page pulls in
    const shouldBlock = details.resourceType !== 'mainFrame' &&
      adblock.match(FilterEngine.Request.fromRawDetails({
        url: details.url,
        sourceUrl: details.firstPartyUrl,
        type: FilterEngine.requestType(details)
      })).match

    return {
      shouldBlock,
      resourceName: module.exports.resourceName
    }
  })
}

module.exports.init = () => {
  if (!AppConfig[module.exports.resourceName].enabled) {
    return
  }

  watchForCosmetics()

  // Filtering only starts once an engine is ready, the way the original waited
  // for its .dat file to download. The callback can fire again after a
  // background list refresh, which just swaps the engine under the callback
  // that is already registered.
  FilterEngine.load(module.exports.resourceName, FilterEngine.adsLists, engine => {
    const isFirst = !adblock
    adblock = engine
    if (isFirst) {
      startAdBlocking()
    }
  }).catch(err => {
    console.log('could not init adblock:', (err && err.message) || err)
  })
}
