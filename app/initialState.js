/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Hands a new window its starting state. This used to travel in the window's
// URL query string, which put the whole app state - browsing history included
// - into a URL, and made the renderer parse it back out. Now the main process
// keeps it here until the window's preload asks for it, once.

const pending = new Map()

module.exports.set = (webContentsId, state) => {
  pending.set(webContentsId, state)
}

/**
 * @param {number} webContentsId
 * @return {object|null} the state, which is then forgotten
 */
module.exports.take = (webContentsId) => {
  const state = pending.get(webContentsId) || null
  pending.delete(webContentsId)
  return state
}
