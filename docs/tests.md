# Tests

    npm test                  # unit tests, plain node, a second or so
    npm run e2e               # the real browser, offline checks
    npm run e2e -- --network  # plus the checks that need the internet

Unit tests live in `test/unit/*.test.js` and run on node's built-in test runner.
They cover the security-critical pure logic: which URLs count as the browser's
own pages and which files the `brave://ui` handler will serve, which schemes a
page may open in a new tab, and how menu templates from the renderer are
rebuilt and bounded.

`tools/e2e.js` launches the browser on a throwaway profile (`BRAVE_PROFILE_DIR`)
and checks each security property over the DevTools protocol, so it can run
while the browser is open. Fixture pages are in `test/e2e/fixtures`. When the
filter engines exist in your profile they are copied in, so the blocking checks
do not need to download anything; otherwise those checks are skipped.

The 2016 Spectron/WebdriverIO suite was removed: Spectron was deprecated in
2022 and cannot drive a current Electron.
