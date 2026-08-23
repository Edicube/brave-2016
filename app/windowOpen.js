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

module.exports.init = () => {
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') {
      return
    }

    contents.setWindowOpenHandler((details) => {
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
