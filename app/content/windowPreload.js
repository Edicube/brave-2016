/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// The preload for the Brave UI window. It replaces the node integration and
// the remote module the 2016 renderer was written against with a fixed,
// allowlisted surface, so the window can run sandboxed and context isolated.

const electron = require('electron')
const contextBridge = electron.contextBridge
const ipcRenderer = electron.ipcRenderer
const messages = require('../../js/constants/messages')

// The app's own message constants are the entire vocabulary the renderer is
// allowed to speak, plus the one channel used to restore a window's state.
const allowedChannels = new Set(
  Object.keys(messages).map(key => messages[key]).concat(['restore-state']))

const checkChannel = (channel) => {
  if (!allowedChannels.has(channel)) {
    throw new Error(`channel not allowed: ${channel}`)
  }
}

// Listeners are wrapped so removeListener can find them again by identity
const wrapped = new Map()

let menuSequence = 0

contextBridge.exposeInMainWorld('braveBridge', {
  // resolved once, at load, so the renderer never needs the app module
  appPath: ipcRenderer.sendSync('bridge-app-path'),
  windowId: ipcRenderer.sendSync('bridge-window-id'),

  send (channel, ...args) {
    checkChannel(channel)
    ipcRenderer.send(channel, ...args)
  },

  on (channel, listener) {
    checkChannel(channel)
    // The real IpcRendererEvent cannot cross the bridge, but every handler in
    // this codebase takes it as a positional first argument and ignores it.
    const wrapper = (event, ...args) => listener({}, ...args)
    if (!wrapped.has(listener)) {
      wrapped.set(listener, new Map())
    }
    wrapped.get(listener).set(channel, wrapper)
    ipcRenderer.on(channel, wrapper)
  },

  removeListener (channel, listener) {
    const byChannel = wrapped.get(listener)
    const wrapper = byChannel && byChannel.get(channel)
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper)
      byChannel.delete(channel)
    }
  },

  // stands in for remote.getCurrentWebContents().send()
  sendToSelf (channel, ...args) {
    checkChannel(channel)
    ipcRenderer.send('bridge-send-to-self', channel, args)
  },

  // stands in for remote.getCurrentWebContents().downloadURL()
  downloadURL (url) {
    ipcRenderer.send('bridge-download-url', url)
  },

  // stands in for remote.shell.openItem(userData/updateLog.log)
  openUpdateLog () {
    ipcRenderer.send('bridge-open-update-log')
  },

  /**
   * Shows a context menu. The template must already be free of functions: the
   * renderer keeps its click handlers and is called back by item id.
   * @param {Array} template a serializable menu template, items carrying menuId
   * @param {function(number)} onClick called with the id of the clicked item
   */
  popupMenu (template, onClick) {
    const menuId = ++menuSequence
    const handler = (event, clickedMenuId, itemId) => {
      if (clickedMenuId === menuId) {
        onClick(itemId)
      }
    }
    ipcRenderer.on('bridge-menu-click', handler)
    ipcRenderer.invoke('bridge-popup-menu', menuId, template)
      .catch(() => {})
      .then(() => ipcRenderer.removeListener('bridge-menu-click', handler))
  }
})
