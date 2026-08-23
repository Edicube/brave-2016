# Reviving Brave 0.7.7

What the 22 January 2016 snapshot needed in order to run again, and why.

## Toolchain

| Was | Now | Why |
| --- | --- | --- |
| `electron-prebuilt: brave/electron-prebuilt` | `electron@38` | The forked prebuilt package is gone from GitHub. Chromium 47 binaries also no longer start on current Linux distributions - `libgconf-2.so.4` was dropped after Ubuntu 20.04. |
| webpack 1 + babel 6 | esbuild ([tools/build.js](../tools/build.js)) | webpack 1 does not run on Node 24. esbuild covers the same ground: JSX in `.js` files, ES2015, a LESS loader, and file loaders for the Font Awesome assets. |
| `webpack-dev-server` for dev | `npm run watch` | `app/index-dev.html` pulled the bundle from `localhost:8080`; both HTML files now load the same on-disk bundle. |
| React 0.14 | React 0.14 | Kept. It is plain JS and still works, so the component code is untouched. |

## Removed dependencies

- `abp-filter-parser-cpp`, `tracking-protection` - native addons built against
  Node 5, whose data files are no longer served. Replaced by
  `@ghostery/adblocker` behind the same `Filtering.registerFilteringCB`
  interface, with the compiled engine cached in the profile directory. See
  [app/lib/filterEngine.js](../app/lib/filterEngine.js).
- `sqlite3` - another Node 5 addon, needed only by HTTPS Everywhere, which stays
  disabled. Required lazily now, so a missing build cannot stop startup.
- `vibrant` (`jariz/vibrant.js#1.0`) - the GitHub tag no longer resolves. Favicon
  theme colours now come from [js/lib/swatch.js](../js/lib/swatch.js), which
  quantises the icon on a canvas.
- `request` - deprecated since 2020. [app/lib/request.js](../app/lib/request.js)
  covers the two call shapes this codebase used. It was also missing from
  `package.json` in the original snapshot.
- `spectron` - deprecated, no modern equivalent.

## Electron API changes

- **`require('app')`, `require('menu')`, `require('auto-updater')`** - the flat
  module names were removed in Electron 1.0. Now destructured from `electron`.
- **`remote`** - removed in Electron 14. Replaced with `@electron/remote`, which
  needs `initialize()` in the main process and `enable()` per WebContents.
- **`nodeIntegration` / `contextIsolation` / `webviewTag`** - all defaulted the
  other way in 2016. Set explicitly in `windowDefaults()`.
- **`<webview>` `new-window` event** - removed in Electron 22. Window-open
  requests are intercepted in the main process by
  [app/windowOpen.js](../app/windowOpen.js) and forwarded to the owning renderer
  as `NEW_WINDOW_REQUESTED`, which `frame.js` turns back into the original shape.
- **`page-title-set`** - renamed to `page-title-updated`.
- **Webview preloads** - must be absolute URLs, and run sandboxed, where
  `require()` only resolves Electron's own modules. The preload is bundled to
  `app/gen/webviewPreload.js` so its relative requires are inlined.
- **`crashReporter.start`** - no longer accepts `productName`, `companyName` or
  `autoSubmit`. Removed; the submit endpoint is gone anyway.
- **`titleBarStyle: 'hidden'`** - was macOS-only in 2016, so every other platform
  got a native frame. Electron honours it everywhere now, and this UI has no
  window controls of its own, so it is forced back to `'default'` off darwin.
- **`ELECTRON_DISABLE_SECURITY_WARNINGS`** - Electron's dev-mode warning logger
  throws on this app's window URL, which surfaced as an unhandled rejection in
  the renderer.

## Filtering

`filtering.js` bailed out on the first line of every request:

    if (!details.firstPartyUrl) { cb({}); return }

`firstPartyUrl` was an addition in Brave's Electron fork, so on upstream
Electron this disabled the entire filtering pipeline - ad blocking, tracking
protection and site hacks alike. It is now derived from the WebContents that
issued the request.

Two further problems surfaced once requests actually reached the callbacks:

- A webRequest `details` object carries `WebFrameMain` and `WebContents`
  references, so sending it over IPC failed with `Failed to serialize
  arguments`, and the renderer never learned what had been blocked. Only the
  plain fields are sent now.
- `mainFrame` requests are never cancelled, so a filter list cannot make a top
  level navigation fail.

## Node API changes

- `fs.appendFile` without a callback threw `ERR_INVALID_ARG_TYPE` on startup,
  from `debug()` in [app/updater.js](../app/updater.js). The callback was
  optional in Node 5.

## Crashes from dead infrastructure

Two minutes after every launch, `runtimeUpdateCheckDelay` fires an update check.
`brave-laptop-updates.global.ssl.fastly.net` no longer resolves and Fastly
answers with `HTTP 500 text/html`, so `JSON.parse(body)` threw - from inside the
request callback, which is past the `try/catch` in `checkForUpdate` - and took
the main process down with the "A JavaScript error occurred in the main process"
dialog. Every session died at the two minute mark.

The updater now checks the status code before parsing, treats an unparseable
body as "no update", and catches `autoUpdater.checkForUpdates()` throwing when
no feed is configured. It also returns early on platforms with no update
channel, which includes Linux: `platforms` never had an entry for it, and
Electron's `autoUpdater` is macOS and Windows only.

`app/package-loader.js` had the same shape - `JSON.parse` and `assert.equal`
inside an `fs` callback - and was given the same treatment. Throwing from an
async callback in the main process is unrecoverable, so these are worth hunting
as a class rather than one at a time.

## Additions

- `brave <url>` now works on Linux and Windows. The original only wired up
  macOS's `open-url` event, so a URL argument was ignored everywhere else.
- `BRAVE_DEBUG=1` mirrors renderer consoles, preload errors and renderer crashes
  into stdout.
