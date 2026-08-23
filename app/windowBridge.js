/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Main process half of the window bridge. Everything the Brave UI used to do
// through the remote module now arrives here as a named, validated request.
// See app/content/windowPreload.js for the renderer half.

const electron = require('electron')
const app = electron.app
const ipcMain = electron.ipcMain
const shell = electron.shell
const Menu = electron.Menu
const BrowserWindow = electron.BrowserWindow
const path = require('path')
const messages = require('../js/constants/messages')
const UiProtocol = require('./uiProtocol')

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[bridge]', ...args)
  }
}

const allowedChannels = new Set(
  Object.keys(messages).map(key => messages[key]).concat(['restore-state']))

/**
 * Requests are only honoured from one of the app's own windows. A webview, or
 * anything else that got hold of the channel name, is ignored.
 * @param {WebContents} sender
 * @return {boolean}
 */
const isAppWindow = (sender) =>
  !!sender && !sender.isDestroyed() &&
  sender.getType() === 'window' &&
  UiProtocol.isUiUrl(sender.getURL())

// Only these keys survive from a template the renderer sent, and only with
// values of the right shape - a menu is built from whatever arrives here, so
// nothing is trusted past what a menu item can actually be.
const menuItemKeys = {
  label: value => typeof value === 'string' ? value.slice(0, 200) : undefined,
  type: value =>
    ['normal', 'separator', 'submenu', 'checkbox', 'radio'].includes(value)
      ? value
      : undefined,
  enabled: value => typeof value === 'boolean' ? value : undefined,
  checked: value => typeof value === 'boolean' ? value : undefined,
  // printable ASCII, no newlines; anything else is not an accelerator
  accelerator: value =>
    (typeof value === 'string' && /^[\x20-\x7e]{1,32}$/.test(value))
      ? value
      : undefined
}

// Menus are built from renderer-supplied data in the main process, so a
// template with absurd nesting or size has to be refused rather than walked.
const maxMenuDepth = 10
const maxMenuItems = 500

/**
 * Rebuilds a menu template from scratch, keeping only known keys with sane
 * values, and wires each item's click back to the requesting window.
 * @param {Array} template
 * @param {WebContents} sender
 * @param {number} menuId
 * @param {number} depth recursion level
 */
function buildTemplate (template, sender, menuId, depth) {
  if (!Array.isArray(template) ||
      depth > maxMenuDepth ||
      template.length > maxMenuItems) {
    return []
  }
  return template.map((item) => {
    if (!item || typeof item !== 'object') {
      return null
    }
    const built = {}
    Object.keys(menuItemKeys).forEach((key) => {
      const value = menuItemKeys[key](item[key])
      if (value !== undefined) {
        built[key] = value
      }
    })
    if (Array.isArray(item.submenu)) {
      built.submenu = buildTemplate(item.submenu, sender, menuId, depth + 1)
    }
    if (typeof item.menuItemId === 'number') {
      const itemId = item.menuItemId
      built.click = () => {
        if (!sender.isDestroyed()) {
          sender.send('bridge-menu-click', menuId, itemId)
        }
      }
    }
    return built
  }).filter(Boolean).slice(0, maxMenuItems)
}

module.exports.init = () => {
  ipcMain.on('bridge-app-path', (event) => {
    event.returnValue = isAppWindow(event.sender) ? app.getAppPath() : null
  })

  ipcMain.on('bridge-window-id', (event) => {
    if (!isAppWindow(event.sender)) {
      event.returnValue = null
      return
    }
    const wnd = BrowserWindow.fromWebContents(event.sender)
    event.returnValue = wnd ? wnd.id : null
  })

  ipcMain.on('bridge-send-to-self', (event, channel, args) => {
    if (!isAppWindow(event.sender) || !allowedChannels.has(channel)) {
      return
    }
    if (!Array.isArray(args) || args.length > 10) {
      return
    }
    debug('sendToSelf', channel)
    event.sender.send(channel, ...args)
  })

  ipcMain.on('bridge-download-url', (event, url) => {
    if (!isAppWindow(event.sender) || typeof url !== 'string') {
      return
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return
    }
    debug('downloadURL', url)
    event.sender.downloadURL(url)
  })

  ipcMain.on('bridge-open-update-log', (event) => {
    if (!isAppWindow(event.sender)) {
      return
    }
    shell.openPath(path.join(app.getPath('userData'), 'updateLog.log'))
  })

  // The hamburger button in the tabs toolbar. Pops the application menu at the
  // cursor, which is on the button the click came from.
  ipcMain.on(messages.SHOW_MAIN_MENU, (event) => {
    if (!isAppWindow(event.sender)) {
      return
    }
    const wnd = BrowserWindow.fromWebContents(event.sender)
    if (!wnd) {
      return
    }
    const menu = Menu.getApplicationMenu()
    if (menu) {
      debug('showing the main menu')
      menu.popup({ window: wnd })
    }
  })

  ipcMain.handle('bridge-popup-menu', (event, menuId, template) => {
    if (!isAppWindow(event.sender) || typeof menuId !== 'number') {
      return
    }
    const wnd = BrowserWindow.fromWebContents(event.sender)
    if (!wnd) {
      return
    }
    const built = buildTemplate(template, event.sender, menuId, 0)
    debug(`popup menu ${menuId} with ${built.length} items`)
    const menu = Menu.buildFromTemplate(built)
    return new Promise((resolve) => {
      menu.popup({ window: wnd, callback: resolve })
    })
  })
}
