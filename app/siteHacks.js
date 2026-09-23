/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const Filtering = require('./filtering')
const siteHacks = require('../js/data/siteHacks')
const AppConfig = require('../js/constants/appConfig')

const resourceName = 'siteHacks'

module.exports.init = () => {
  if (!AppConfig[resourceName].enabled) {
    return
  }
  Filtering.registerFilteringCB(details => {
    if (details.resourceType !== 'mainFrame') {
      return {
        shouldBlock: false,
        resourceName
      }
    }

    let hostname
    try {
      hostname = new URL(details.url).hostname
    } catch (e) {
      return { shouldBlock: false, resourceName }
    }
    const domain = hostname.split('.').slice(-2).join('.')
    const hack = siteHacks[domain]
    let cbArgs = {}
    if (hack) {
      cbArgs = { requestHeaders: hack.call(this, details) }
    }
    return {
      shouldBlock: false,
      resourceName,
      cbArgs
    }
  })
}
