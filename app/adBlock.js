/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const FilterEngine = require('./lib/filterEngine')
const Filtering = require('./filtering')
const AppConfig = require('../js/constants/appConfig')

module.exports.resourceName = 'adblock'

let adblock

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
