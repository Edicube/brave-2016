/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Recently closed windows, for History > Reopen Last Closed Window. Held in
// memory for this session only, without private tabs.

const SessionStore = require('./sessionStore')

const maxClosed = 10
const closed = []

/**
 * @param {object} windowState a window's state as it was closed
 */
module.exports.push = (windowState) => {
  if (!windowState || !Array.isArray(windowState.frames)) {
    return
  }
  windowState.frames = windowState.frames.filter(frame => frame && !frame.isPrivate)
  if (windowState.frames.length === 0) {
    return
  }
  if (!windowState.frames.some(frame => frame.key === windowState.activeFrameKey)) {
    windowState.activeFrameKey = windowState.frames[windowState.frames.length - 1].key
  }
  delete windowState.closedFrames
  closed.push(SessionStore.cleanSessionData(windowState) || windowState)
  if (closed.length > maxClosed) {
    closed.shift()
  }
}

/**
 * @return {object|undefined} the last closed window's state
 */
module.exports.pop = () => closed.pop()

module.exports.size = () => closed.length
