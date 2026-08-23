/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const FilterEngine = require('./lib/filterEngine')
const Filtering = require('./filtering')
const AppConfig = require('../js/constants/appConfig')

module.exports.resourceName = 'trackingProtection'

let trackingProtection

const startTrackingProtection = () => {
  Filtering.registerFilteringCB(details => {
    const shouldBlock = details.resourceType !== 'mainFrame' &&
      trackingProtection.match(FilterEngine.Request.fromRawDetails({
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

  // The privacy lists know which hosts belong to the same entity, so the
  // first-party affiliation bookkeeping the Disconnect list needed is gone.
  FilterEngine.load(module.exports.resourceName, FilterEngine.trackingLists, engine => {
    const isFirst = !trackingProtection
    trackingProtection = engine
    if (isFirst) {
      startTrackingProtection()
    }
  }).catch(err => {
    console.log('could not init tracking protection:', (err && err.message) || err)
  })
}
