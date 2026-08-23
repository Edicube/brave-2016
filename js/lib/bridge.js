/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Renderer side of the window bridge. Presents the shapes the 2016 components
// were written against - an ipc object, and something that looks enough like a
// BrowserWindow for the context menu handlers - on top of the allowlisted
// surface exposed by app/content/windowPreload.js.
//
// Everything here reads window.braveBridge lazily, because this module is also
// pulled in by main process code through the dispatcher, where there is no
// window at all.

const bridge = () => {
  const b = typeof window !== 'undefined' && window.braveBridge
  if (!b) {
    throw new Error('the window bridge is not available in this process')
  }
  return b
}

// Stands in for require('electron').ipcRenderer
module.exports.ipc = {
  send: (channel, ...args) => bridge().send(channel, ...args),
  on: (channel, listener) => bridge().on(channel, listener),
  removeListener: (channel, listener) => bridge().removeListener(channel, listener)
}

module.exports.getWindowId = () => bridge().windowId
module.exports.getAppPath = () => bridge().appPath
module.exports.sendToSelf = (channel, ...args) => bridge().sendToSelf(channel, ...args)
module.exports.downloadURL = (url) => bridge().downloadURL(url)
module.exports.openUpdateLog = () => bridge().openUpdateLog()

/**
 * Enough of a BrowserWindow for the menu click handlers in js/contextMenus.js,
 * which only ever send a message to this window or start a download.
 */
module.exports.currentWindow = {
  get id () {
    return bridge().windowId
  },
  webContents: {
    send: (channel, ...args) => bridge().sendToSelf(channel, ...args),
    downloadURL: (url) => bridge().downloadURL(url)
  }
}

/**
 * Shows a context menu built from a template that still has click functions in
 * it. The functions stay here; only labels and ids cross to the main process.
 *
 * @param {Array} template a menu template as the 2016 code writes them
 */
module.exports.popupMenu = (template) => {
  const handlers = new Map()
  let nextId = 0

  const strip = (items) => items.map((item) => {
    if (!item || typeof item !== 'object') {
      return item
    }
    const stripped = {}
    Object.keys(item).forEach((key) => {
      if (key === 'click' || key === 'submenu') {
        return
      }
      stripped[key] = item[key]
    })
    if (typeof item.click === 'function') {
      stripped.menuItemId = ++nextId
      handlers.set(stripped.menuItemId, item.click)
    }
    if (Array.isArray(item.submenu)) {
      stripped.submenu = strip(item.submenu)
    }
    return stripped
  })

  const stripped = strip(template)
  bridge().popupMenu(stripped, (itemId) => {
    const handler = handlers.get(itemId)
    if (handler) {
      // the 2016 handlers take (menuItem, focusedWindow)
      handler(null, module.exports.currentWindow)
    }
  })
}
