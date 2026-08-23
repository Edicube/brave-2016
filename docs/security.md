# Security posture

This is a 2016 browser UI on a current Electron. Its renderer was written
against Electron's original trust model, which is the opposite of today's
default. It no longer runs that way.

## The trust boundary

Neither renderer is privileged:

| | Loads | node integration | context isolation | sandbox |
| --- | --- | --- | --- | --- |
| **Window** (the Brave UI) | only `file://` inside the app directory | no | yes | yes |
| **Webview** (every web page) | anything | no | yes | yes |

The window used to need node integration, because the 2016 components called
`require()` and the remote module straight from the renderer. That turned out to
be a small, enumerable surface rather than a rewrite: three node builtins
(`url`, `path`, `events`, now bundled as browser polyfills) and six distinct
operations on the remote module. All of it now goes through a fixed allowlisted
bridge, so the UI runs with the same privileges as a web page.

## Measured, not assumed

`test/unit/` covers the URL validator. The rest was checked by evaluating in
each renderer over the DevTools protocol, with
`electron . --remote-debugging-port=9333`.

In a web page:

    typeof require = undefined    typeof module = undefined
    typeof process = undefined    window.braveBridge = undefined

In the Brave UI window:

    typeof require = undefined    typeof global = undefined
    typeof module  = undefined    typeof Buffer = undefined
    window.braveBridge = object   (the allowlisted surface, nothing more)

The channel allowlist was probed directly, and refuses both unknown channels and
the bridge's own internal ones:

    braveBridge.send('evil-channel')                 -> channel not allowed
    braveBridge.sendToSelf('bridge-download-url')    -> channel not allowed

## What was found and fixed

**Every permission was granted, silently.** Electron approves all permission
requests when no handler is installed. A probe page was given the microphone and
notification permission with no prompt. This version of Brave has no permission
UI to show, so [app/security.js](../app/security.js) denies everything except
`fullscreen`, `mediaKeySystem` and `clipboard-sanitized-write`, none of which can
read anything back. `setDevicePermissionHandler` refuses WebUSB, WebHID and Web
Serial outright.

*Trade-off: sites that legitimately want the camera, microphone, location or
notifications will silently fail. Fixing that properly means building the
permission prompt this version never had.*

**Electron 38 was end of life.** Electron supports the latest three stable
majors. Running an EOL major on a browser means known, published Chromium
vulnerabilities go unpatched. Now on 43.

**The window could in principle be navigated anywhere.** It runs with node
integration, so a remote URL loaded there would get node. `will-navigate` and
`will-frame-navigate` now reject anything that is not a `file://` URL inside the
app directory, and `setWindowOpenHandler` denies native window opens from it.
The validator is in [app/lib/localUrl.js](../app/lib/localUrl.js) with tests
covering remote schemes, `javascript:`, `data:`, absolute paths, path traversal,
percent-encoded traversal and sibling-directory prefix matches.

**Webviews were attached with whatever attributes the renderer asked for.**
`will-attach-webview` now overrides them from the main process: node integration
off, context isolation on, sandbox on, no nested webviews, no insecure content,
and the preload path forced to ours. A bug in the window renderer cannot mint a
privileged webview.

**Webviews ran without context isolation.** They were given
`contextIsolation=no` so the preload could reach the page's main world. The only
thing that actually needed it was `window.print()`, which now goes through the
webview's own `print()` method, so isolation is back on.

**No CSP on the window.** `app/index.html` now carries `default-src 'none'` with
an explicit allowlist. `script-src 'self'` with no `unsafe-inline` or
`unsafe-eval` means injected inline script cannot run in the privileged
renderer.

**`allowRunningInsecureContent` was on.** Added defensively during the port and
not actually needed; removed.

## The bridge

[app/content/windowPreload.js](../app/content/windowPreload.js) exposes exactly
nine members, and [app/windowBridge.js](../app/windowBridge.js) validates every
request in the main process. `@electron/remote` is gone from the dependency
list.

| Bridge member | Replaces |
| --- | --- |
| `send`, `on`, `removeListener` | `ipcRenderer` |
| `windowId` | `remote.getCurrentWindow().id` |
| `appPath` | `remote.app.getAppPath()` |
| `sendToSelf` | `remote.getCurrentWebContents().send()` |
| `downloadURL` | `remote.getCurrentWebContents().downloadURL()` |
| `openUpdateLog` | `remote.shell.openItem(...)` |
| `popupMenu` | `remote.Menu.buildFromTemplate(...).popup()` |

Three things make it narrow rather than just indirect:

- **The channel vocabulary is the app's own.** The allowlist is derived from
  `js/constants/messages.js` at load, so the renderer can only speak channels
  the application itself defines, and cannot reach the bridge's own channels.
- **Every request is checked against its sender.** `app/windowBridge.js` serves
  only a WebContents whose type is `window` and whose URL passes the same
  local-path validator the navigation guard uses. A webview that learned a
  channel name gets nothing.
- **Menu templates are rebuilt, not trusted.** The renderer keeps its click
  functions; only labels, types and item ids cross. Main copies a fixed set of
  keys onto a fresh template and attaches its own click handlers that send the
  item id back. `downloadURL` is additionally restricted to `http` and `https`.

## What is still weak

- **No phishing or malware blocklist.** There is no Safe Browsing equivalent, so
  a page that Chrome would put behind a red warning loads normally here. The
  `Filtering` pipeline is the natural place to add one.
- **No cosmetic filtering, no HTTPS upgrading.** Requests are blocked but
  elements are not hidden, and HTTPS Everywhere stays disabled, so `http://`
  links stay on `http://`.
- **The updater is inert.** There is no patch delivery mechanism: keeping this
  safe means running `npm update` and rebuilding by hand. This is now the
  largest single risk, because it is the one that grows over time.
- **`app/gen/` is loaded from disk without verification.** Anything that can
  write to the app directory owns the browser. That is true of most unpackaged
  Electron apps.

## Re-running the checks

    npm test

The privilege probe is not checked in; it is a page that reports
`typeof require` and friends and calls `getUserMedia`, loaded over
`python3 -m http.server`. To probe the UI window itself, start with
`--remote-debugging-port=9333` and evaluate against the `page` target.

Run the browser with `BRAVE_DEBUG=1` to see the `[security]` and `[bridge]`
decisions as they are made.
