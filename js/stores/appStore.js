/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-disable no-case-declarations -- the 2016 stores declare per-case locals throughout; a switch in braces per case is a larger rewrite */

'use strict'
const AppConstants = require('../constants/appConstants')
const SiteUtil = require('../state/siteUtil')
const electron = require('electron')
const ipcMain = electron.ipcMain
const messages = require('../constants/messages')
const BrowserWindow = electron.BrowserWindow
const LocalShortcuts = require('../../app/localShortcuts')
const AppActions = require('../actions/appActions')
const firstDefinedValue = require('../lib/functional').firstDefinedValue
const Serializer = require('../dispatcher/serializer')
const path = require('path')
const UiProtocol = require('../../app/uiProtocol')
const InitialState = require('../../app/initialState')

let appState

// TODO cleanup all this createWindow crap
function isModal (browserOpts) {
  // this needs some better checks
  return browserOpts.scrollbars === false
}

function navbarHeight () {
  // TODO there has to be a better way to get this or at least add a test
  return 75
}

const createWindow = (browserOpts, defaults) => {
  const parentWindowKey = browserOpts.parentWindowKey

  browserOpts.width = firstDefinedValue(browserOpts.width, browserOpts.innerWidth, defaults.width)
  // height and innerHeight are the frame webview size
  browserOpts.height = firstDefinedValue(browserOpts.height, browserOpts.innerHeight)
  if (isNaN(browserOpts.height)) {
    // no inner height so check outer height or use default
    browserOpts.height = firstDefinedValue(browserOpts.outerHeight, defaults.height)
  } else {
    // BrowserWindow height is window height so add navbar height
    browserOpts.height = browserOpts.height + navbarHeight()
  }

  browserOpts.x = firstDefinedValue(browserOpts.x, browserOpts.left, browserOpts.screenX)
  browserOpts.y = firstDefinedValue(browserOpts.y, browserOpts.top, browserOpts.screenY)
  delete browserOpts.left
  delete browserOpts.top

  const screen = electron.screen
  const primaryDisplay = screen.getPrimaryDisplay()
  const parentWindow = parentWindowKey ? BrowserWindow.fromId(parentWindowKey) : BrowserWindow.getFocusedWindow()
  const bounds = parentWindow ? parentWindow.getBounds() : primaryDisplay.bounds

  // position on screen should be relative to focused window
  // or the primary display if there is no focused window
  const display = screen.getDisplayNearestPoint(bounds)

  // if no parentWindow, x, y or center is defined then go ahead
  // and center it if it's smaller than the display width
  // typeof and isNaN are used because 0 is falsy
  if (!(parentWindow ||
      browserOpts.center === false ||
      browserOpts.x > 0 ||
      browserOpts.y > 0) &&
      browserOpts.width < display.bounds.width) {
    browserOpts.center = true
  } else {
    browserOpts.center = false
    // don't offset if focused window is at least as big as the screen it's on
    if (bounds.width >= display.bounds.width && bounds.height >= display.bounds.height) {
      browserOpts.x = firstDefinedValue(browserOpts.x, display.bounds.x)
      browserOpts.y = firstDefinedValue(browserOpts.y, display.bounds.y)
    } else {
      browserOpts.x = firstDefinedValue(browserOpts.x, bounds.x + defaults.windowOffset)
      browserOpts.y = firstDefinedValue(browserOpts.y, bounds.y + defaults.windowOffset)
    }

    // make sure the browser won't be outside the viewable area of any display
    // negative numbers aren't allowed so we don't need to worry about that
    const displays = screen.getAllDisplays()
    const maxX = Math.max(...displays.map((display) => { return display.bounds.x + display.bounds.width }))
    const maxY = Math.max(...displays.map((display) => { return display.bounds.y + display.bounds.height }))

    browserOpts.x = Math.min(browserOpts.x, maxX - defaults.windowOffset)
    browserOpts.y = Math.min(browserOpts.y, maxY - defaults.windowOffset)
  }

  const minWidth = isModal(browserOpts) ? defaults.minModalWidth : defaults.minWidth
  const minHeight = isModal(browserOpts) ? defaults.minModalHeight : defaults.minHeight

  // min width and height don't seem to work when the window is first created
  browserOpts.width = browserOpts.width < minWidth ? minWidth : browserOpts.width
  browserOpts.height = browserOpts.height < minHeight ? minHeight : browserOpts.height

  // Window options come from action paths that have carried renderer-supplied
  // state in the past. Geometry may be overridden; the security posture of the
  // window may not. Whatever webPreferences an option bag brings are dropped
  // in favour of the hardened defaults.
  delete browserOpts.webPreferences
  delete browserOpts.nodeIntegration
  delete browserOpts.contextIsolation
  delete browserOpts.sandbox
  delete browserOpts.preload
  delete browserOpts.webviewTag

  let mainWindow = new BrowserWindow(Object.assign({
    // smaller min size for "modal" windows
    minWidth,
    minHeight,
    // Neither a frame nor a titlebar
    // frame: false,
    // A frame but no title bar and windows buttons in titlebar 10.10 OSX and up only?
    // In 2016 this option was macOS-only, so every other platform got a normal
    // frame. Electron honours it on Linux/Windows now, and this UI has no
    // window controls of its own, so keep the native frame off darwin.
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    autoHideMenuBar: true,
    // this build's own colour: the lion in green, the way nightly wears purple
    icon: path.join(__dirname, '..', '..', 'res', 'app-icon-green.png'),
    webPreferences: defaults.webPreferences
  }, browserOpts))

  mainWindow.on('resize', function () {
    // the default window size is whatever the last window resize was.
    // Modern Electron passes no argument to this event, so the window itself
    // is the only way to reach its size.
    if (mainWindow && !mainWindow.isDestroyed()) {
      AppActions.setDefaultWindowSize(mainWindow.getSize())
    }
  })

  mainWindow.on('close', function () {
    LocalShortcuts.unregister(mainWindow)
  })

  mainWindow.on('closed', function () {
    mainWindow = null
  })

  LocalShortcuts.register(mainWindow)
  return mainWindow
}

class AppStore {
  getState () {
    return appState
  }

  emitChange () {
    const stateJS = this.getState().toJS()
    BrowserWindow.getAllWindows().forEach(wnd =>
      wnd.webContents.send(messages.APP_STATE_CHANGE, stateJS))
  }
}

function windowDefaults () {
  setDefaultWindowSize()

  return {
    show: false,
    width: appState.get('defaultWindowWidth'),
    height: appState.get('defaultWindowHeight'),
    minWidth: 500,
    minHeight: 300,
    minModalHeight: 100,
    minModalWidth: 100,
    windowOffset: 20,
    webPreferences: {
      // The renderer reaches the main process only through the allowlisted
      // surface in app/content/windowPreload.js, so it needs none of the
      // privileges the 2016 code was written against.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '..', '..', 'app', 'gen', 'windowPreload.js'),
      // <webview> is opt-in since Electron 5
      webviewTag: true,
      // stated explicitly so the secure posture does not depend on defaults
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableBlinkFeatures: '',
      // BRAVE_HIDDEN keeps windows off screen (tools/e2e.js); a hidden window
      // would otherwise be throttled like a background tab
      backgroundThrottling: !process.env.BRAVE_HIDDEN
    }
  }
}

/**
 * set the default width and height if they
 * haven't been initialized yet
 */
function setDefaultWindowSize () {
  const screen = electron.screen
  const primaryDisplay = screen.getPrimaryDisplay()
  if (!appState.get('defaultWindowWidth') && !appState.get('defaultWindowHeight')) {
    appState = appState.set('defaultWindowWidth', Math.floor(primaryDisplay.bounds.width / 2))
    appState = appState.set('defaultWindowHeight', Math.floor(primaryDisplay.bounds.height / 2))
  }
}

const appStore = new AppStore()

const handleAppAction = (action) => {
  switch (action.actionType) {
    case AppConstants.APP_SET_STATE:
      appState = action.appState
      appStore.emitChange()
      break
    case AppConstants.APP_NEW_WINDOW:
      const frameOpts = action.frameOpts && action.frameOpts.toJS()
      const browserOpts = (action.browserOpts && action.browserOpts.toJS()) || {}

      const mainWindow = createWindow(browserOpts, windowDefaults())
      if (action.restoredState) {
        mainWindow.webContents.once('dom-ready', () => {
          mainWindow.webContents.send('restore-state', action.restoredState)
        })
      }

      const currentWindows = appState.get('windows')
      appState = appState.set('windows', currentWindows.push(mainWindow.id))

      // initialize frames state
      let frames = []
      if (frameOpts) {
        if (frameOpts.forEach) {
          frames = frameOpts
        } else {
          frames.push(frameOpts)
        }
      }

      // The window's preload collects this over IPC before the UI renders
      InitialState.set(mainWindow.webContents.id, {
        appState: appState.toJS(),
        frames
      })

      const page = process.env.NODE_ENV === 'development' ? 'index-dev.html' : 'index.html'
      mainWindow.loadURL(UiProtocol.url(page))
      appStore.emitChange()

      if (!process.env.BRAVE_HIDDEN) {
        mainWindow.show()
      }
      break
    case AppConstants.APP_CLOSE_WINDOW:
      const appWindow = BrowserWindow.fromId(action.appWindowId)
      appWindow.close()

      const windows = appState.get('windows')
      appState = appState.set('windows', windows.delete(action.appWindowId))
      appStore.emitChange()
      break
    case AppConstants.APP_ADD_SITE:
      appState = appState.set('sites', SiteUtil.addSite(appState.get('sites'), action.frameProps, action.tag))
      appStore.emitChange()
      break
    case AppConstants.APP_REMOVE_SITE:
      appState = appState.set('sites', SiteUtil.removeSite(appState.get('sites'), action.frameProps, action.tag))
      appStore.emitChange()
      break
    case AppConstants.APP_SET_DEFAULT_WINDOW_SIZE:
      appState = appState.set('defaultWindowWidth', action.size[0])
      appState = appState.set('defaultWindowHeight', action.size[1])
      appStore.emitChange()
      break
    case AppConstants.APP_SET_DATA_FILE_ETAG:
      appState = appState.setIn([action.resourceName, 'etag'], action.etag)
      appStore.emitChange()
      break
    case AppConstants.APP_SET_RESOURCE_ENABLED:
      appState = appState.setIn([action.resourceName, 'enabled'], action.enabled)
      appStore.emitChange()
      break
    case AppConstants.APP_SET_DATA_FILE_LAST_CHECK:
      appState = appState.mergeIn([action.resourceName], {
        lastCheckVersion: action.lastCheckVersion,
        lastCheckDate: action.lastCheckDate
      })
      appStore.emitChange()
      break
    default:
  }
}

// Register callback to handle all updates.
//
// This is the channel the UI's dispatcher uses for every action, so it cannot
// simply be removed - but it must only ever accept actions from one of the
// app's own windows. Webviews carry an isolated preload with an ipcRenderer,
// and without the sender check a page that escaped into that world could
// switch protections off or spawn windows at will.
ipcMain.on(messages.APP_ACTION, (event, action) => {
  const sender = event.sender
  if (!sender || sender.isDestroyed() ||
      sender.getType() !== 'window' || !UiProtocol.isUiUrl(sender.getURL())) {
    return
  }
  if (!action || typeof action !== 'object' || typeof action.actionType !== 'string') {
    return
  }
  // A flood of oversized payloads is just as good as a malicious one for
  // wedging the main process, so bound what a single dispatch may carry.
  let json
  try {
    json = JSON.stringify(action)
  } catch (e) {
    return
  }
  if (!json || json.length > 2 * 1024 * 1024) {
    console.error('[appStore] refused an oversized action:',
      json ? json.length : 'unserializable')
    return
  }
  try {
    handleAppAction(Serializer.deserialize(action))
  } catch (err) {
    console.error('[appStore] refused a malformed action:',
      (err && err.message) || err)
  }
})

process.on(messages.APP_ACTION, handleAppAction)

module.exports = appStore
