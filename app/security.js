/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Guards that Electron did not need in 2016, because the defaults were
// different and because this UI was written against a browser engine that has
// since grown a great many capabilities.

const electron = require('electron')
const app = electron.app
const session = electron.session
const dialog = electron.dialog
const path = require('path')
const Partitions = require('../js/constants/partitions')
const url = require('url')
const UiProtocol = require('./uiProtocol')

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[security]', ...args)
  }
}

// Electron approves every permission request when no handler is installed.
// This version of Brave has no permission prompt to show, so anything that
// reaches for hardware, location or the user's attention is refused. The few
// exceptions are needed to play video and cannot read anything back.
const allowedPermissions = new Set([
  // full screen video
  'fullscreen',
  // Widevine and friends, for sites that will not play video without it
  'mediaKeySystem',
  // write-only, and Chromium sanitises what goes on the clipboard
  'clipboard-sanitized-write'
])

function registerPermissionHandlers (ses) {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = allowedPermissions.has(permission)
    debug(`${allowed ? 'allowing' : 'denying'} ${permission} for`,
      (details && details.requestingUrl) || (webContents && webContents.getURL()))
    callback(allowed)
  })

  // navigator.permissions.query and other synchronous checks
  ses.setPermissionCheckHandler((webContents, permission) =>
    allowedPermissions.has(permission))

  // WebUSB, WebHID and Web Serial: never hand over a physical device
  ses.setDevicePermissionHandler(() => false)

  // Web Bluetooth: no prompt infrastructure exists, so pairing is refused
  // outright rather than falling back to platform defaults.
  if (typeof ses.setBluetoothPairingHandler === 'function') {
    // eslint-disable-next-line n/no-callback-literal
    ses.setBluetoothPairingHandler((webContents, details, callback) => {
      debug('denying bluetooth pairing from',
        (details && details.origin) || (webContents && webContents.getURL()))
      callback(false)
    })
  }

  // TLS verification is never overridable from inside the app: this build has
  // no interstitial "proceed anyway" flow, so a failed verification can only
  // ever mean refusal. Certificates Chromium accepts pass through untouched;
  // everything else is rejected with -2, and there is no code path that can
  // turn an error into an accept.
  ses.setCertificateVerifyProc((request, callback) => {
    // Electron reports a passing verification as 'net::OK' (the net error
    // code string), not plain 'OK'.
    if (request.verificationResult !== 'net::OK' || !request.isIssuedByKnownRoot) {
      debug(`refusing certificate for ${request.hostname}:`,
        request.verificationResult || `errorCode ${request.errorCode}`)
      callback(-2)
      return
    }
    callback(0)
  })

  // No client certificate is ever offered to a server asking for mTLS.
  ses.on('select-client-certificate', (event) => {
    debug('refusing a client-certificate request')
    event.preventDefault()
  })
}

/**
 * Absolute paths the window renderer is allowed to load. It runs with node
 * integration, so it must never be pointed at anything remote.
 */
const appDir = path.join(__dirname, '..')

// Schemes a web page may be navigated to. file: would expose local files and
// the internal schemes expose Chromium's own pages, so a page cannot reach
// either one through its own webview.
const webviewSchemes = new Set([
  'http:', 'https:', 'about:', 'blob:', 'data:', UiProtocol.scheme + ':'])

/**
 * Everything that has to happen before the app is ready. Called at require
 * time: app.enableSandbox() throws once the app is ready, and throwing from
 * inside the ready handler silently abandons the rest of startup.
 */
module.exports.initEarly = () => {
  // Has to precede any session: registers brave:// as standard and secure
  UiProtocol.registerScheme()

  // Whatever sessions exist today or appear tomorrow, they all get the same
  // guards. hardenSession() dedupes, so init()'s explicit calls below are the
  // belt to this braces.
  app.on('session-created', hardenSession)

  // No renderer can opt out of the sandbox, whatever its webPreferences say
  app.enableSandbox()

  // Resolve names over HTTPS so lookups cannot be read or spoofed on the wire.
  // 'secure' means no fallback to plaintext DNS.
  app.commandLine.appendSwitch('dns-over-https-mode', 'secure')
  app.commandLine.appendSwitch('dns-over-https-templates',
    'https://dns.quad9.net/dns-query')

  // Chromium features this browser has no use for. Each one is background
  // network chatter or another listening surface: server-side autofill
  // predictions, ML optimization hints that describe browsing to Google, and
  // the cast stack which announces itself over the local network.
  app.commandLine.appendSwitch('disable-features',
    'AutofillServerCommunication,OptimizationHints,MediaRouter,DialMediaRouteProvider')

  app.on('web-contents-created', (event, contents) => {
    // A compromised or buggy window renderer must not be able to attach a
    // webview with privileges of its own.
    contents.on('will-attach-webview', (e, webPreferences, params) => {
      delete webPreferences.preloadURL
      webPreferences.preload = path.join(appDir, 'app', 'gen', 'webviewPreload.js')
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      // no webviews inside webviews
      webPreferences.webviewTag = false
      webPreferences.allowRunningInsecureContent = false
      webPreferences.webSecurity = true
      webPreferences.experimentalFeatures = false
      webPreferences.plugins = false
      webPreferences.enableBlinkFeatures = ''
      delete params.nodeintegration
      delete params.nodeintegrationinsubframes
      delete params.disablewebsecurity
      delete params.allowpopups
      delete params.plugins
      // A renderer must not be able to choose its own session, which would
      // escape the filtering and the file: refusal registered above.
      if (params.partition !== Partitions.private) {
        params.partition = Partitions.web
      }
      debug('attaching webview for', params.src)
    })

    if (contents.getType() === 'webview') {
      // WebRTC otherwise reveals local network addresses to any page
      contents.setWebRTCIPHandlingPolicy('default_public_interface_only')

      // allowpopups is stripped at attach time; this denies the path anyway,
      // in case a future Electron changes when that attribute is read.
      contents.setWindowOpenHandler((details) => {
        debug('blocked window.open from a webview:', details.url)
        return { action: 'deny' }
      })

      const guardWebviewNavigation = (e, target) => {
        let scheme
        try {
          scheme = new url.URL(target).protocol
        } catch (err) {
          debug('blocked webview navigation to an unparseable URL', target)
          e.preventDefault()
          return
        }
        if (!webviewSchemes.has(scheme)) {
          debug('blocked webview navigation to', target)
          e.preventDefault()
        }
      }
      contents.on('will-navigate', guardWebviewNavigation)
      contents.on('will-frame-navigate', (e) => guardWebviewNavigation(e, e.url))
      return
    }

    // The window itself only ever loads its own HTML. Anything else would run
    // remote content with node integration.
    contents.on('will-navigate', (e, target) => {
      if (!UiProtocol.isUiUrl(target)) {
        debug('blocked window navigation to', target)
        e.preventDefault()
      }
    })
    contents.on('will-frame-navigate', (e) => {
      if (!UiProtocol.isUiUrl(e.url)) {
        debug('blocked window frame navigation to', e.url)
        e.preventDefault()
      }
    })
    // and it never opens native windows of its own
    contents.setWindowOpenHandler((details) => {
      debug('blocked window.open from the window renderer:', details.url)
      return { action: 'deny' }
    })

    // DevTools is a debugging surface with privileges no shipped browser
    // window needs, and a compromised renderer can try to open it to poke at
    // the main process through it. Closed unless someone asked for it by name.
    if (!process.env.BRAVE_DEBUG) {
      contents.on('devtools-opened', () => {
        debug('closing devtools opened from', contents.getType())
        contents.closeDevTools()
      })
      const devToolsWebContents = contents.devToolsWebContents
      if (devToolsWebContents) {
        devToolsWebContents.close()
      }
    }
  })
}

/**
 * Session scoped guards. Applied through 'session-created' so every session
 * this app ever creates gets them exactly once, including any partition added
 * by future code that forgets to ask.
 */
const hardenedSessions = new WeakSet()

function hardenSession (ses) {
  if (!ses || hardenedSessions.has(ses)) {
    return
  }
  hardenedSessions.add(ses)
  registerPermissionHandlers(ses)
  // A page must never reach the user's screen without asking. An empty grant
  // carries no streams, which Electron treats as a refusal.
  // eslint-disable-next-line n/no-callback-literal
  ses.setDisplayMediaRequestHandler((request, callback) => callback({}))
  refuseFileScheme(ses)
  confirmDownloads(ses)
  hardenNetwork(ses)
}

// Extensions Chromium treats as executable content. A download is confirmed
// either way, but these get a blunter warning.
const executableExtensions = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.dll', '.jar',
  '.app', '.dmg', '.pkg', '.deb', '.rpm', '.appimage', '.run', '.sh', '.bash',
  '.ps1', '.vbs', '.js', '.jse', '.wsf', '.hta', '.reg', '.lnk'
])

// Downloads the user has already approved, keyed by URL, waiting to be
// re-issued now that they have somewhere to go.
const savePathFor = new Map()

/**
 * This version of Brave has no download UI at all, so without this a download
 * starts, finishes and lands on disk with nothing shown. Ask first, and say
 * plainly when the file is something that runs.
 * @param {Session} ses
 */
function confirmDownloads (ses) {
  ses.on('will-download', (event, item, webContents) => {
    const from = item.getURL()

    // already approved, and re-issued with a destination
    const chosen = savePathFor.get(from)
    if (chosen) {
      savePathFor.delete(from)
      item.setSavePath(chosen)
      debug('saving to', chosen)
      return
    }

    event.preventDefault()
    debug('download requested:', from)

    // The name comes straight off Content-Disposition. Strip any directory
    // parts and control characters so a hostile server cannot pre-fill the
    // save dialog with somewhere outside the directory the user picks.
    const rawName = item.getFilename()
    // eslint-disable-next-line no-control-regex
    const name = path.basename(String(rawName)).replace(/[\x00-\x1f]/g, '') ||
      'download'
    const runnable = executableExtensions.has(path.extname(name).toLowerCase())
    const size = item.getTotalBytes()
    const detail = [
      `From: ${from.slice(0, 200)}`,
      size ? `Size: ${Math.round(size / 1024)} KB` : 'Size: unknown',
      runnable ? '\nThis is an executable file. Opening it runs code on your computer.' : ''
    ].filter(Boolean).join('\n')

    dialog.showMessageBox({
      type: runnable ? 'warning' : 'question',
      buttons: ['Cancel', 'Save\u2026'],
      defaultId: 0,
      cancelId: 0,
      title: 'Download',
      message: runnable ? `Download and save "${name}"?` : `Save "${name}"?`,
      detail
    }).then(({ response }) => {
      if (response !== 1) {
        debug('download declined:', name)
        return null
      }
      return dialog.showSaveDialog({ defaultPath: name })
    }).then((save) => {
      if (!save || save.canceled || !save.filePath) {
        return
      }
      savePathFor.set(from, save.filePath)
      if (webContents && !webContents.isDestroyed()) {
        webContents.downloadURL(from)
      }
    }).catch(() => {})
  })
}

/**
 * Network level hardening for a web content session.
 *
 * The referrer trimming and third-party cookie blocking are what Brave itself
 * does. Blocking third-party cookies breaks sign-in flows that federate
 * through a third party, which is the accepted cost of that default.
 *
 * @param {Session} ses
 */
function hardenNetwork (ses) {
  // Refuse anything below TLS 1.2, rather than negotiating down
  ses.setSSLConfig({ minVersion: 'tls1.2' })
}

/**
 * Strips cross-site referrer detail and third-party cookies. Registered as a
 * filtering callback so its header rewrites merge with the site hacks rather
 * than replacing them.
 * @param {object} details
 * @return {object}
 */
function privacyHeaders (details) {
  const headers = details.requestHeaders || {}
  const firstParty = details.firstPartyUrl || details.url
  let sameSite = true
  try {
    sameSite = new url.URL(details.url).host === new url.URL(firstParty).host
  } catch (e) {
    sameSite = true
  }

  if (sameSite) {
    return { shouldBlock: false, resourceName: 'privacyHeaders' }
  }

  const rewritten = Object.assign({}, headers)
  let changed = false

  // Send the origin only, never the full path, across sites
  if (rewritten.Referer) {
    try {
      rewritten.Referer = new url.URL(rewritten.Referer).origin + '/'
    } catch (e) {
      delete rewritten.Referer
    }
    changed = true
  }
  // No third-party cookies: drop the header rather than blanking it
  if (rewritten.Cookie) {
    delete rewritten.Cookie
    changed = true
  }

  return {
    shouldBlock: false,
    resourceName: 'privacyHeaders',
    cbArgs: changed ? { requestHeaders: rewritten } : undefined
  }
}

/**
 * Refuses the file: scheme.
 *
 * will-navigate is not enough on its own: it does not fire for navigations
 * started by setting a webview's src or calling loadURL, so a file: URL could
 * still be loaded and read. Intercepting the scheme in the session catches
 * every route to it. The UI no longer loads from disk through file:, it is
 * served over brave://, so nothing in this app has a reason to ask for file:
 * and every session refuses it outright.
 *
 * @param {Session} ses
 */
function refuseFileScheme (ses) {
  ses.protocol.handle('file', async (request) => {
    debug('refused a file: request:', request.url)
    return new Response('', { status: 403 })
  })
}

/**
 * Session scoped guards, which need the app to be ready. Sessions created
 * earlier are covered by the 'session-created' hook installed in initEarly().
 */
module.exports.blockedPageUrl = (blockedTarget) =>
  UiProtocol.url('blocked.html') + '#' + encodeURIComponent(blockedTarget)

module.exports.init = () => {
  ;[Partitions.web, Partitions.private].forEach((partition) =>
    hardenSession(session.fromPartition(partition)))
  hardenSession(session.defaultSession)

  // the UI's own pages, and the warning page shown in place of a blocked site
  UiProtocol.handle(session.defaultSession)
  ;[Partitions.web, Partitions.private].forEach((partition) =>
    UiProtocol.handle(session.fromPartition(partition)))

  // shares the single onBeforeSendHeaders hook that app/filtering.js owns
  require('./filtering').registerFilteringCB(privacyHeaders)
}
