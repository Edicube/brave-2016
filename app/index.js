/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// The window renderer is sandboxed, context isolated, and has no node
// integration; its entire surface onto the main process is the allowlisted
// preload bridge in app/content/windowPreload.js. Electron's dev-mode warning
// logger cannot know about that custom scheme and complains anyway on every
// window load, which surfaces as a bogus unhandled rejection in the renderer,
// so its warnings stay off.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

// The product is called Brave 2016, but the profile directory keeps the name
// it has always had, so a rename does not orphan anyone's session, cookies
// and filter engines. Has to run before anything reads userData.
// BRAVE_PROFILE_DIR points it elsewhere, which is how tools/e2e.js runs a
// throwaway profile alongside a browser that is already open.
require('electron').app.setPath('userData', process.env.BRAVE_PROFILE_DIR ||
  require('path').join(require('electron').app.getPath('appData'), 'brave'))

const Immutable = require('immutable')
const electron = require('electron')
const BrowserWindow = electron.BrowserWindow
const ipcMain = electron.ipcMain
const app = electron.app
const Menu = require('./menu')
const Updater = require('./updater')
const messages = require('../js/constants/messages')
const AppActions = require('../js/actions/appActions')
const SessionStore = require('./sessionStore')
const AppStore = require('../js/stores/appStore')
const PackageLoader = require('./package-loader')
const Filtering = require('./filtering')
const TrackingProtection = require('./trackingProtection')
const AdBlock = require('./adBlock')
const HttpsEverywhere = require('./httpsEverywhere')
const SiteHacks = require('./siteHacks')
const Phishing = require('./phishing')
const HttpsUpgrade = require('./httpsUpgrade')
const Staleness = require('./staleness')
const UpdateCheck = require('./updateCheck')
const ClearOnExit = require('./clearOnExit')
const CmdLine = require('./cmdLine')
const WindowOpen = require('./windowOpen')
const Security = require('./security')
const WindowBridge = require('./windowBridge')

// Two processes sharing one profile corrupt each other's databases and split
// the session state. Hand any arguments to the instance that already has it.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', (event, argv) => {
  const url = CmdLine.urlFromArgs(argv)
  const wnd = BrowserWindow.getAllWindows()[0]
  if (wnd) {
    wnd.show()
    wnd.focus()
    if (url) {
      wnd.webContents.send(messages.SHORTCUT_NEW_FRAME, url)
    }
  } else if (url) {
    AppActions.newWindow(Immutable.fromJS({ location: url }))
  }
})

// Must precede 'ready'
Security.initEarly()

// A browser started by a test harness (tools/e2e.js) goes away with it, even
// if the harness itself is killed outright and cannot clean up after itself.
if (process.env.BRAVE_PARENT_PID) {
  const parent = Number(process.env.BRAVE_PARENT_PID)
  setInterval(() => {
    try {
      process.kill(parent, 0)
    } catch (e) {
      app.exit(0)
    }
  }, 1000).unref()
}

// Last-ditch containment: an unexpected throw must neither kill the browser
// nor pop Electron's crash dialog over something recoverable. Logged and kept
// running - the navigation guards are event driven and stay armed regardless.
process.on('uncaughtException', (err) => {
  console.error('[brave] uncaught exception:', (err && err.stack) || err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[brave] unhandled rejection:', (reason && reason.stack) || reason)
})

// HTTP basic auth is refused outright: this build has no credential prompt,
// so an auth challenge can only ever fail. Stating that explicitly keeps the
// fail-closed behaviour from depending on Electron defaults.
app.on('login', (event, webContents, details, authInfo, callback) => {
  event.preventDefault()
  callback()
  if (process.env.BRAVE_DEBUG) {
    console.log(`[brave] refused an auth challenge for ${details.url}`)
  }
})

const loadAppStatePromise = SessionStore.loadAppState().catch(() => {
  return SessionStore.defaultAppState()
})

// Used to collect the per window state when shutting down the application
const perWindowState = []
let sessionStateStoreAttempted = false

const saveIfAllCollected = () => {
  if (perWindowState.length === BrowserWindow.getAllWindows().length) {
    const appState = AppStore.getState().toJS()
    appState.perWindowState = perWindowState
    const ignoreCatch = () => {}

    if (process.env.NODE_ENV !== 'test') {
      SessionStore.saveAppState(appState).catch(ignoreCatch).then(() => {
        sessionStateStoreAttempted = true
        app.quit()
      })
    } else {
      sessionStateStoreAttempted = true
      app.quit()
    }
  }
}

// Renderer-side errors are invisible from the terminal otherwise. Run with
// BRAVE_DEBUG=1 to mirror every window's console into stdout.
if (process.env.BRAVE_DEBUG) {
  app.on('child-process-gone', (e, details) => {
    console.log(`[brave] child process gone: ${details.type} ${details.reason}`)
  })
  app.on('web-contents-created', (event, contents) => {
    contents.on('console-message', (e) => {
      console.log(`[${contents.getType()}:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`)
    })
    contents.on('render-process-gone', (e, details) => {
      console.log(`[${contents.getType()}] render process gone:`, details)
    })
    contents.on('preload-error', (e, preloadPath, error) => {
      console.log(`[${contents.getType()}] preload error in ${preloadPath}:`, error)
    })
  })
}

// Sender validation for the raw ipcMain handlers below. Webviews carry an
// isolated preload of their own that can speak IPC, so channel names alone
// prove nothing: quitting, menu updates and session state must come from one
// of the app's own windows, while page-originated events must come from a
// webview - never the other way round.
const UiProtocolForIndex = require('./uiProtocol')
const senderIsAppWindow = (e) => {
  const s = e.sender
  return !!s && !s.isDestroyed() &&
    s.getType() === 'window' && UiProtocolForIndex.isUiUrl(s.getURL())
}
const senderIsWebView = (e) => {
  const s = e.sender
  return !!s && !s.isDestroyed() && s.getType() === 'webview'
}

app.on('ready', function () {
  // Before anything creates a window: the webview and navigation guards hook
  // 'web-contents-created', which only sees contents created after it, and the
  // window preload asks the bridge for the app path as it loads.
  Security.init()
  WindowBridge.init()

  app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      setTimeout(app.quit, 0)
    }
  })

  app.on('activate', function () {
    // (OS X) open a new window when the user clicks on the app icon if there aren't any open
    if (BrowserWindow.getAllWindows().length === 0) {
      AppActions.newWindow()
    }
  })

  app.on('before-quit', function (e) {
    if (sessionStateStoreAttempted || BrowserWindow.getAllWindows().length === 0) {
      saveIfAllCollected()
      return
    }

    e.preventDefault()
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send(messages.REQUEST_WINDOW_STATE))
  })

  ipcMain.on(messages.RESPONSE_WINDOW_STATE, (wnd, data) => {
    if (!senderIsAppWindow(wnd)) {
      return
    }
    // This lands in the session file on disk and is replayed into app state
    // at startup, so only a bounded plain object of known keys may pass.
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const keys = Object.keys(data)
      if (keys.length <= 50 &&
          JSON.stringify(data).length <= 512 * 1024) {
        perWindowState.push(data)
      } else if (process.env.BRAVE_DEBUG) {
        console.log('[brave] refused an oversized window state')
      }
    }
    saveIfAllCollected()
  })

  loadAppStatePromise.then(initialState => {
    // For tests we always want to load default app state
    if (process.env.NODE_ENV === 'test') {
      initialState = SessionStore.defaultAppState()
    }

    const perWindowState = initialState.perWindowState

    delete initialState.perWindowState
    AppActions.setState(Immutable.fromJS(initialState))
    return perWindowState
  }).then(perWindowState => {
    if (!perWindowState || perWindowState.length === 0) {
      if (!CmdLine.newWindowURL) {
        AppActions.newWindow()
      }
    } else {
      perWindowState.forEach(wndState => {
        AppActions.newWindow(undefined, undefined, wndState)
      })
    }
    process.emit(messages.APP_INITIALIZED)

    if (CmdLine.newWindowURL) {
      AppActions.newWindow(Immutable.fromJS({
        location: CmdLine.newWindowURL
      }))
    }

    ipcMain.on(messages.QUIT_APPLICATION, (e) => {
      if (senderIsAppWindow(e)) {
        app.quit()
      }
    })

    ipcMain.on(messages.UPDATE_APP_MENU, (e, args) => {
      if (senderIsAppWindow(e)) {
        // the menu reads a single boolean off this; nothing else may pass
        Menu.init(
          args && typeof args === 'object' && !Array.isArray(args)
            ? { bookmarked: !!args.bookmarked }
            : undefined)
      }
    })

    ipcMain.on(messages.CONTEXT_MENU_OPENED, (e, nodeName) => {
      if (!senderIsWebView(e)) {
        return
      }
      const focused = BrowserWindow.getFocusedWindow()
      if (focused) {
        focused.webContents.send(messages.CONTEXT_MENU_OPENED, nodeName)
      }
    })
    ipcMain.on(messages.STOP_LOAD, (e) => {
      if (!senderIsWebView(e)) {
        return
      }
      const focused = BrowserWindow.getFocusedWindow()
      if (focused) {
        focused.webContents.send(messages.STOP_LOAD)
      }
    })

    Menu.init()

    // Load HTTPS Everywhere browser "extension"
    HttpsEverywhere.init()

    Filtering.init()
    TrackingProtection.init()
    AdBlock.init()
    SiteHacks.init()
    Phishing.init()
    HttpsUpgrade.init()
    Staleness.init()
    UpdateCheck.init()
    ClearOnExit.init()
    WindowOpen.init()

    ipcMain.on(messages.UPDATE_REQUESTED, (e) => {
      if (senderIsAppWindow(e)) {
        Updater.update()
      }
    })

    // This loads package.json into an object
    PackageLoader.load((err, pack) => {
      if (err) throw new Error('package.json could not be accessed')

      // Setup the auto updater
      Updater.init(process.platform, pack.version)

      // This is fired by a menu entry (for now - will be scheduled)
      process.on(messages.CHECK_FOR_UPDATE, () => Updater.checkForUpdate(true))

      // This is fired from a auto-update metadata call
      process.on(messages.UPDATE_META_DATA_RETRIEVED, (metadata) => {
        console.log(metadata)
      })
    })
  })
})
