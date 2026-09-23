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

// Everything sent is reduced to plain JSON data first. Electron's IPC in 2016
// serialized through JSON, which silently dropped functions, and the 2016
// stores rely on that: URL bar suggestions carry onClick handlers inside the
// window state. Structured clone refuses functions instead, and a refused
// window state at quit left the main process waiting for an answer forever -
// the browser would not close.
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

// Listeners are wrapped so removeListener can find them again by identity
const wrapped = new Map()

let menuSequence = 0

contextBridge.exposeInMainWorld('braveBridge', {
  // resolved once, at load, so the renderer never needs the app module
  appPath: ipcRenderer.sendSync('bridge-app-path'),
  windowId: ipcRenderer.sendSync('bridge-window-id'),
  // the window's starting state, handed over once
  initialState: ipcRenderer.sendSync('bridge-initial-state'),

  send (channel, ...args) {
    checkChannel(channel)
    try {
      ipcRenderer.send(channel, ...args.map(plain))
    } catch (e) {
      // name the channel and the offending action, or a lost message is
      // untraceable
      const what = args[0] && args[0].actionType ? ` (${args[0].actionType})` : ''
      console.error(`could not send on ${channel}${what}: ${e.message}`)
      throw e
    }
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
    try {
      ipcRenderer.send('bridge-send-to-self', channel, args.map(plain))
    } catch (e) {
      console.error(`could not send to self on ${channel}: ${e.message}`)
      throw e
    }
  },

  // stands in for remote.getCurrentWebContents().downloadURL()
  downloadURL (url) {
    ipcRenderer.send('bridge-download-url', url)
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
