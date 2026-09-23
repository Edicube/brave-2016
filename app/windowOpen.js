/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// The <webview> 'new-window' event that js/components/frame.js listens for was
// removed in Electron 22. Window-open requests are now intercepted in the main
// process and forwarded to the owning renderer as a NEW_WINDOW_REQUESTED
// message, which frame.js turns back into the original event shape.

const electron = require('electron')
const app = electron.app
const messages = require('../js/constants/messages')

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[windowOpen]', ...args)
  }
}

// Only ordinary web addresses may become a tab
const openableSchemes = new Set(['http:', 'https:'])

/**
 * @param {string} target the URL a page asked to open
 * @return {boolean}
 */
const isOpenable = (target) => {
  if (typeof target !== 'string' || !target) {
    return false
  }
  try {
    return openableSchemes.has(new URL(target).protocol)
  } catch (e) {
    return false
  }
}

module.exports.isOpenable = isOpenable

module.exports.init = () => {
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') {
      return
    }

    contents.setWindowOpenHandler((details) => {
      // The native window is always denied. What is in question is only
      // whether this becomes a tab, and a page must not be able to choose the
      // scheme: javascript:, file: and data: in a fresh frame are all ways of
      // running somewhere the page should not reach. Validated here rather
      // than in the renderer, which is not trusted to filter for us.
      if (!isOpenable(details.url)) {
        debug('refused window.open for', String(details.url).slice(0, 120))
        return { action: 'deny' }
      }

      debug('opening a tab for', details.url)
      const host = contents.hostWebContents
      if (host) {
        host.send(messages.NEW_WINDOW_REQUESTED, {
          webContentsId: contents.id,
          url: details.url,
          frameName: details.frameName,
          disposition: details.disposition,
          features: details.features
        })
      }
      return { action: 'deny' }
    })
  })
}
