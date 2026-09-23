/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Which DNS-over-HTTPS resolver the browser uses. Chromium only takes this as
// a command line switch before the app is ready, so the choice lives in its
// own small file that can be read synchronously at startup, and a change
// takes effect on the next start.

const fs = require('fs')
const path = require('path')

const providers = require('../js/constants/dnsProviders')

const fallback = 'quad9'

const file = (userData) => path.join(userData, 'dns.json')

module.exports.providers = providers

/**
 * @param {string} userData the profile directory
 * @return {string} the chosen provider's name, or the default
 */
module.exports.current = (userData) => {
  try {
    const name = JSON.parse(fs.readFileSync(file(userData), 'utf8')).provider
    return Object.prototype.hasOwnProperty.call(providers, name) ? name : fallback
  } catch (e) {
    return fallback
  }
}

module.exports.template = (userData) => providers[module.exports.current(userData)].template

/**
 * @param {string} userData
 * @param {string} name one of the provider names
 * @return {boolean} whether it was saved
 */
module.exports.choose = (userData, name) => {
  if (!Object.prototype.hasOwnProperty.call(providers, name)) {
    return false
  }
  try {
    fs.writeFileSync(file(userData), JSON.stringify({ provider: name }))
    return true
  } catch (e) {
    return false
  }
}
