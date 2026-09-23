/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stylesheets are included here for webpack live reloading
require('../less/window.less')
require('../less/button.less')
require('../less/main.less')
require('../less/navigationBar.less')
require('../less/tabs.less')
require('../less/findbar.less')
require('../less/dialogs.less')
require('../less/updateBar.less')
require('../node_modules/font-awesome/css/font-awesome.css')

const React = require('react')
const { createRoot } = require('react-dom/client')
const Window = require('./components/window')
const ipc = require('./lib/bridge').ipc
const WindowStore = require('./stores/windowStore')
const messages = require('./constants/messages')

if (process.env.BRAVE_DEBUG) {
  window.addEventListener('unhandledrejection', (e) => {
    console.error('unhandled rejection:', (e.reason && e.reason.stack) || e.reason)
  })
}

// get appStore from url
// handed over by the main process through the window preload
// Values that cross contextBridge arrive frozen, and the 2016 stores mutate
// what they are given, so work on a copy.
const initial = JSON.parse(JSON.stringify(window.braveBridge.initialState || {}))
const appState = initial.appState || { windows: [], sites: [], visits: [] }
const frames = initial.frames || []

ipc.on(messages.REQUEST_WINDOW_STATE, () => {
  ipc.send(messages.RESPONSE_WINDOW_STATE, WindowStore.getState().toJS())
})

createRoot(document.getElementById('windowContainer')).render(
  <Window appState={appState} frames={frames} />)
