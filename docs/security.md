# Security posture

This is a 2016 browser UI on a current Electron. Its renderer was written
against Electron's original trust model, which is the opposite of today's
default. It no longer runs that way.

## The trust boundary

Neither renderer is privileged:

| | Loads | node integration | context isolation | sandbox |
| --- | --- | --- | --- | --- |
| **Window** (the Brave UI) | only `brave://ui/` | no | yes | yes |
| **Webview** (every web page) | http, https | no | yes | yes |

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
| `initialState` | the window's starting state, once (it used to travel in the URL) |
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

## Beyond the renderers

**The UI is not a `file://` document.** It is served over `brave://ui/`, a
scheme registered as standard and secure, from a handler that resolves only
inside `app/` and only for a fixed list of content types
([app/uiProtocol.js](../app/uiProtocol.js)). Two things follow. The
`GrantFileProtocolExtraPrivileges` fuse can be off, so script execution in the
UI cannot read the disk through `fetch` - measured, it is refused. And `file:`
can then be refused outright in every web content session, with no exception
carved out for the app's own pages.

**Web content has its own sessions.** Normal tabs use `persist:web`, private
tabs an in-memory partition, and the UI the default session
([js/constants/partitions.js](../js/constants/partitions.js)). The partition is
pinned in `will-attach-webview`, so a renderer cannot pick its own session and
step outside the filtering or the `file:` refusal.

**`file:` is refused at the session, not at navigation.** `will-navigate` does
not fire for navigations started by setting a webview's `src` or calling
`loadURL`, so a guard there can be walked straight past - it was, during this
work, and `/etc/passwd` loaded and was read. The scheme is now intercepted in
the session, which catches every route to it.

**Binary fuses are off** ([tools/fuses.js](../tools/fuses.js)). Without this the
shipped Electron binary is a general purpose Node interpreter anything on the
machine can call: `ELECTRON_RUN_AS_NODE=1 electron -e "..."`. Also closed:
`NODE_OPTIONS` injection, the Node CLI inspector, and file protocol privileges.
Cookie encryption is on. `npm install` rewrites the binary and resets these, so
it is wired to `postinstall`, and `npm run verify-fuses` reads the wire back.

**One process per profile.** `requestSingleInstanceLock` hands arguments to the
running instance. Two processes sharing a profile corrupt each other's
databases, which showed up as `Failed to initialize the DIPS SQLite database`.

**Network layer.** TLS floored at 1.2, DNS over HTTPS in `secure` mode with no
plaintext fallback, WebRTC restricted to the default public interface,
cross-site referrers trimmed to the origin, third-party cookies dropped. The
last two are what Brave itself does, and they break sign-in flows that federate
through a third party.

**Phishing and malware.** Electron has no Safe Browsing. Top level navigations
are matched against the malware-filter phishing and URLhaus lists and replaced
with a warning page ([app/phishing.js](../app/phishing.js)). There is
deliberately no button to continue.

**HTTPS first.** Top level `http` navigations are retried over `https`, with the
hosts that genuinely cannot do TLS remembered. The fallback fires only on
connection level failures, never on certificate errors: a site with a bad
certificate does support TLS, and dropping to `http` there is exactly the
downgrade an attacker would want.

**Downloads are confirmed.** This version has no download UI, so a download used
to complete silently. Executable extensions get a blunter warning.

**One webRequest owner.** Electron allows a single listener per event per
session and a second registration silently replaces the first. Everything
registers through [app/filtering.js](../app/filtering.js) instead, which is the
only module that touches `onBeforeRequest` and `onBeforeSendHeaders`. This was a
real bug during the work: adding the HTTPS upgrade silently disabled phishing
protection, and the privacy headers would have silently disabled ad blocking.

**TLS verification cannot be overridden from inside the app.** There is no
"proceed anyway" flow, so a failed verification only ever means refusal.
`expired.badssl.com` is refused with `net::ERR_CERT_DATE_INVALID` and the tab
stays where it was.

Two details in that handler are worth knowing. The accept path returns `-3`, not
`0`: in this API `0` means "success, and skip Certificate Transparency", which
would switch off the check that catches mis-issuance by an otherwise trusted CA.
And the handler additionally requires `isIssuedByKnownRoot`, which rejects
certificates chaining to a privately installed root - so a corporate network
doing TLS inspection, or a self-signed development certificate, will fail
outright rather than prompt.

**A page cannot choose what becomes a tab.** `window.open` is denied as a native
window in every case; whether it becomes a tab is decided in
[app/windowOpen.js](../app/windowOpen.js) against an http/https allowlist. This
mattered: before the check, a page could open `brave://ui/index.html` - the
browser's own privileged page - in a tab. Popups have to stay enabled for the
handler to be consulted at all, since Chromium otherwise drops `window.open`
before any handler runs, which also silently broke every `target="_blank"` link.

**The UI is served with the headers a privileged origin should have.** Declared
content type, `nosniff`, `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`. Measured: `window.crossOriginIsolated` is true.

**A refused certificate says so.** It used to leave a blank tab, which reads as
a broken browser and pushes people to retry over `http`. The refusal now keeps
the real net error rather than collapsing to `ERR_FAILED`, and the tab shows
what went wrong - `expired.badssl.com` gives "This connection is not private"
with `ERR_CERT_DATE_INVALID`. Still no button to continue.

**The build tells you when it has gone stale.**
[app/staleness.js](../app/staleness.js) reads a date stamped in at build time
and warns past 45 days, in the terminal and with a dialog over the browser
window, at most once a day. Nothing else would: an old build looks exactly like
a new one. No network call is involved.

**Menu templates from the renderer are bounded as a whole tree.** 100 items
and 3 levels in total, not per level - the earlier per-level limits still let a
compromised renderer ask for millions of native menu items. Hostile input is
covered in `test/unit/windowBridge.test.js`, including prototype pollution and
a 5,000-level nesting.

**A window's starting state no longer travels in its URL.** It used to be put
into the query string, browsing history included. The main process now holds
it until the window's preload collects it, once.

**Phishing matching runs on documents only.** Top level pages and frames, which
is where a fake login page or a malware download is. Those lists cost about
1.3ms a match against 20us for the ad lists, so checking every image and script
too made pages measurably slower.

**Checked end to end, not just in unit tests.** `npm run e2e` launches the real
browser on a throwaway profile and verifies each property above over the
DevTools protocol. Several of the bugs recorded here were only found that way.

**Installable so the browsing user cannot modify it.**
`sudo sh tools/install-linux.sh` puts the packaged build in `/opt/brave-2016`
owned by root, with a checksum manifest; `npm run verify-install` checks it.
This is the integrity control that works on Linux, where Electron cannot verify
its ASAR archive.

**Permissions are asked about, narrowly.** Camera, microphone and
notifications prompt, naming the site; the answer lasts for the session, and a
"Block" is remembered as firmly as an "Allow", so a page cannot keep asking.
Only the page in the tab may ask, never a frame from another origin it embeds.
Everything else - location, USB, HID, serial, MIDI, screen capture, idle
detection, opening external apps - is refused without a prompt
([app/permissions.js](../app/permissions.js)).

**Updates are proposed by Dependabot, tested by CI, and on Linux installed
only when signed.** Dependabot opens pull requests for new Electron and
dependency versions; CI runs lint, unit tests, fuzzing and the end-to-end
checks on every one, builds and starts the packaged browser on Linux, macOS
and Windows, and a weekly `npm run doctor` fails when the Electron major falls
out of support. Tagged releases are built for all three platforms by
[.github/workflows/release.yml](../.github/workflows/release.yml), with a
provenance attestation.

The copy installed root-owned in `/opt` can update itself
([app/selfUpdate.js](../app/selfUpdate.js)). Nothing from a download runs
until all of these hold:

1. `SHA256SUMS.txt` carries a valid Ed25519 signature from the key in
   [app/lib/releaseKey.js](../app/lib/releaseKey.js). Its private half exists
   only as a secret of the GitHub repository, used by the release workflow;
   the workflow also checks the signature against the shipped public key, so
   a release signed with the wrong key fails there rather than in browsers.
2. The archive's SHA-256 matches its line in that signed list, and its name
   carries the release tag, so an old signed release cannot be replayed as a
   new one. Assets must come from this repository's release URLs.
3. The archive holds only plain files and directories, all inside its one
   top-level directory: no links, no `..`, no absolute paths.

Then the archive's own installer runs through `/usr/bin/pkexec /bin/sh`
(absolute paths, so the caller's `PATH` plays no part), which asks for the
admin password. `test/unit/selfUpdate.test.js` builds honest and tampered
releases with a throwaway key and checks each refusal. What it cannot defend
against: something already running as your user could swap the extracted
files between verification and the password prompt - but such a thing could
equally show a password prompt of its own. macOS and Windows builds are not
code-signed and do not update themselves.

**Workflow actions are pinned to commit SHAs**, not tags, so a compromised
action repository cannot change what runs in CI or signs releases.

**The browser looks like any Chrome.** Electron's default User-Agent names
the app and Electron - "Brave2016/0.8.0 ... Electron/44.4.5" - which picks this
browser out of millions and gets it refused by sites that block embedded
browsers. It now sends the reduced User-Agent of an ordinary Chrome of the
same version, on the wire and in `navigator.userAgent`. Canvas and font
fingerprinting are not randomised: that needs a script in the main world of
every page, which is a larger attack surface than the privacy is worth here.

**Web pages cannot reach brave://.** The warning page is loaded into a tab by
the main process; a page navigating itself or a frame to `brave://` is
refused, and in web sessions the `brave://ui` handler serves only the warning
page's two files, never the UI.

**Fuzzed, not just unit tested.** `test/unit/fuzz.test.js` throws seeded
random input at every function that takes something a page or a compromised
renderer controls - the `brave://ui` resolver, the `window.open` allowlist,
menu templates, permission decisions, session restore, version comparison -
and checks what must always hold. 3,000 inputs per property on every CI run,
200,000 weekly with a fresh seed. It found a crash in the version comparison.

**A later header rewrite could undo an earlier one.** Each header filter
returned a full header set and the results were merged with `Object.assign`,
so a filter running after the one that strips third-party cookies could hand
the `Cookie` header back. [app/filtering.js](../app/filtering.js) now applies
them in turn, each to the result of the one before.

**Protections off for one site stay narrow.** The per-site switch only lifts
ad blocking, tracker blocking and the cookie and referrer rules, keyed on the
hostname of the page in the tab. Phishing blocking, the HTTPS upgrade,
certificate checks and permission prompts are not affected by it. The main
process validates the hostname before storing it, and reloads the site's tabs
bypassing the cache, so an ad already in the cache cannot slip past the filters
when protections come back on.

**DNS choice is an allowlist.** Settings stores only a provider name; the
DNS-over-HTTPS template comes from a fixed list in
[js/constants/dnsProviders.js](../js/constants/dnsProviders.js), so a
compromised renderer cannot point name resolution at a server of its choosing.

**Continuing past a phishing warning takes a one-time token.** The warning
page has no bridge to the main process. When it is shown, the main process
hands it a random 128-bit token for that one tab; the button puts the token in
the page's own fragment, and the main process continues only if the token
matches an offer made to that same tab. A forged or reused token is ignored
(an e2e check tries one). The site is then allowed until Brave closes. There is
still no way past a certificate error.

**Bookmark import reads an untrusted file.** The file is chosen in the main
process's own dialog, so a window can ask for an import but never name a file.
Only `http:` and `https:` addresses are taken, at most 5,000, from a file of at
most 20 MB; titles are plain text.

**Downloads are never opened from the browser.** The downloads panel can show a
finished file in its folder, but not open it: opening a downloaded file would
run it.

**Permission decisions and downloads are never saved.** They live in app state
so the windows can show them, but the session file drops them, and a window
cannot set them: only the main process modules that own them can.

**A writable install is pointed out.** On Linux, Electron does not check
`app.asar` against the binary. A JavaScript hash check would live inside the
archive it checks, so instead the browser warns once when its own files are
writable by the user running it, which is the case that lets malware modify it.

## What is still weak

- **Updates depend on the pipeline staying green.** Electron patch and minor
  updates from Dependabot now merge themselves once every CI check passes on all
  four platforms, and a daily job releases them; installed Linux copies then
  update themselves. A new Electron major (a weekly job opens an issue for it),
  or a red CI, still waits for a person. This is the largest remaining risk,
  because it is the only one that grows on its own. `npm run doctor` reports
  whether the Electron major is still supported, whether the fuses survived, and
  what npm audit says.
- **ASAR integrity is not verified on Linux.** `npm run package` produces an
  ASAR build with `OnlyLoadAppFromAsar`, but Electron only verifies embedded
  ASAR integrity on macOS and Windows. Use the root-owned install above (the
  browser warns when it is not); run from a checkout, anything running as your
  user can modify the browser.
- **Cosmetic filtering is styles only.** The lists also carry scriptlets, which
  would mean running code in every page; they are not injected, so some ads
  that are built by script still show.
- **No "proceed anyway" on bad certificates.** The warning page explains what
  went wrong, but there is deliberately no way past it.
- **The blocklists are third-party.** Phishing and ad blocking are only as good
  as the lists. The warning page shows the rule that matched, and a false
  positive can be passed for the session - which a user can also be talked into.

## Re-running the checks

    npm test                  # unit tests: UI protocol, window.open, menu templates
    npm run e2e -- --network  # the real browser, over the DevTools protocol
    npm run doctor            # Electron support window, fuses, npm audit
    npm run verify-install    # checksums of a root-owned install

Run the browser with `BRAVE_DEBUG=1` to see the `[security]`, `[bridge]`,
`[phishing]` and `[https]` decisions as they are made.
