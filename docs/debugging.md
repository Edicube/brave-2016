# Debugging

## Logging

    BRAVE_DEBUG=1 npm start

mirrors every window's and every page's console into the terminal, along with
preload errors, crashed renderers, and the decisions the main process makes:
`[security]`, `[bridge]`, `[phishing]`, `[https]`, `[windowOpen]`,
`[staleness]`, and each blocked request.

## Renderers

Developer tools stay closed unless `BRAVE_DEBUG=1` is set. With it set, open
them for a page with the usual shortcut, or connect from outside:

    ./node_modules/.bin/electron . --remote-debugging-port=9333

then open `http://127.0.0.1:9333/json/list`. The `page` target is the Brave UI
(`brave://ui/index.html`); each `webview` target is a tab. `tools/e2e.js` drives
the browser this way.

`npm run watch` rebuilds the renderer bundle on every change, in development
mode with source maps.

## Main process

The node inspector is switched off by an Electron fuse (`--inspect` is
ignored), because otherwise anything on the machine could attach to the main
process. To debug it, reset the fuses, debug, and flip them back:

    rm -rf node_modules/electron/dist && node node_modules/electron/install.js
    ./node_modules/.bin/electron --inspect=5858 .
    npm run harden          # put the fuses back afterwards

## A throwaway profile

    BRAVE_PROFILE_DIR=$(mktemp -d) npm start

runs on an empty profile, alongside a browser that is already open.
