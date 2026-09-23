/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Bravery > Clear cookies and site data when Brave closes.
//
// Clears the normal-browsing session - cookies, local storage, IndexedDB,
// service workers, cache storage and the HTTP cache - on the way out. Private
// tabs never touch disk in the first place. Bookmarks, open tabs and the
// filter lists are kept.

const electron = require('electron')
const app = electron.app
const session = electron.session
const Filtering = require('./filtering')
const Partitions = require('../js/constants/partitions')

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[clearOnExit]', ...args)
  }
}

let cleared = false

module.exports.init = () => {
  app.on('will-quit', (event) => {
    if (cleared || !Filtering.isResourceEnabled('clearOnExit')) {
      return
    }
    event.preventDefault()

    const ses = session.fromPartition(Partitions.web)
    const clearing = Promise.all([
      ses.clearStorageData(),
      ses.clearCache(),
      ses.clearAuthCache()
    ])
    // never let a stuck clear keep the browser from closing
    const timeout = new Promise(resolve => setTimeout(resolve, 5000))

    Promise.race([clearing, timeout]).catch((e) => {
      debug('could not clear everything:', e.message)
    }).then(() => {
      debug('site data cleared')
      cleared = true
      app.quit()
    })
  })
}
