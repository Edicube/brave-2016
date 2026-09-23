# Brave 2016

[![CI](https://github.com/Edicube/brave-2016/actions/workflows/ci.yml/badge.svg)](https://github.com/Edicube/brave-2016/actions/workflows/ci.yml)

> **⚠️ This browser is not safe for everyday use.**
>
> It is a hobby revival of the January 2016 Brave codebase, not a maintained
> browser. It gets Chromium security fixes only as fast as one person ships
> them, no security team reviews it, and parts of it are 2016 code that was
> never written with today's threats in mind. Do not use it for banking, email, work accounts or anything else you
> cannot afford to lose. Use a maintained browser for those.

A desktop browser built on the 2016 Brave codebase (MPL-2.0), updated to run on
a current Electron. Original UI, modern security posture - as far as a project like
this can have one. See [What "not safe" means](#what-not-safe-means).

## Installing a release

Download from [Releases](https://github.com/Edicube/brave-2016/releases):

| Platform | File |
|---|---|
| Linux x64 | `brave-2016-<version>-linux-x64.tar.gz` |
| Windows x64 | `brave-2016-<version>-win32-x64.zip` |
| macOS (Apple Silicon) | `brave-2016-<version>-darwin-arm64.zip` |
| macOS (Intel) | `brave-2016-<version>-darwin-x64.zip` |

Check it before running it:

```bash
sha256sum -c --ignore-missing SHA256SUMS.txt
gh attestation verify brave-2016-<version>-linux-x64.tar.gz -R Edicube/brave-2016
```

`gh attestation verify` proves the archive was built by this repository's
release workflow from a tagged commit, not by someone's laptop.

**Linux**: install it root-owned, so nothing running as your user can modify
it. This is also the copy that can update itself:

```bash
tar xzf brave-2016-<version>-linux-x64.tar.gz
sudo sh brave-2016-linux-x64/install.sh
brave-2016
```

**macOS and Windows**: the builds are not code-signed, which needs paid Apple
and Microsoft certificates, so the OS warns on first launch. On macOS
right-click the app and choose Open; on Windows choose "More info", then "Run
anyway". They tell you about new releases but do not install them.

## Running it from source

You need Node.js (LTS) and npm.

```bash
git clone https://github.com/Edicube/brave-2016.git
cd brave-2016
npm ci
npm start
```

`npm ci` installs dependencies from the lockfile, downloads the Electron binary
if it is missing, and hardens that binary with Electron fuses.

To open a page directly: `npm start -- https://example.com`

## What it does

- **Blocks ads and trackers** (EasyList, EasyPrivacy, uBlock Origin lists), both
  the requests and the empty ad boxes left behind.
- **Blocks phishing and malware sites** with a warning page, in place of the Safe
  Browsing service Electron does not have.
- **HTTPS first**: `http://` addresses are tried over HTTPS, falling back only
  when a site genuinely has no TLS.
- **Drops third-party cookies** and trims cross-site referrers to the origin,
  and sends Global Privacy Control (`Sec-GPC: 1`), which sites in some places
  are legally bound to honour as an opt-out of sale and sharing.
- **Protections per site**: when a site breaks, turn protections off just for
  it from the lock icon in the address bar. Phishing blocking and HTTPS stay on.
- **Encrypted DNS** through Quad9 (default), Cloudflare or Mullvad.
- **Refuses bad certificates** with an explanation, and asks before every
  download.
- **Asks before a site gets the camera, microphone or notifications**, for this
  session only; everything else (location, USB, MIDI, screen capture...) is
  refused outright.
- **Shows download progress** on the taskbar, notifies when a download finishes,
  and can cancel them from File > Cancel downloads.
- **Updates itself on Linux** (the copy installed in `/opt`): when a newer
  release exists it offers to install it, checks the release's signature and
  checksum, and asks for your password. Elsewhere it tells you about it.
- **Shows a page with a Reload button when a tab crashes**, instead of a blank
  tab.
- **Looks like an ordinary Chrome** to sites, instead of announcing itself as
  "Brave2016 ... Electron", which singles you out and gets you refused by some
  sign-in pages.
- **History, bookmarks and settings**: History > Show All History (Ctrl+Y),
  Bookmarks > Manage Bookmarks (Ctrl+Alt+B), and Settings (Ctrl+, or the Brave
  button) for the protections, DNS provider and theme. History keeps the last
  1,000 pages and never records private tabs.
- **Dark theme**, following the system or set in Settings.
- **Optional, in Settings or the Bravery menu**: HTTPS-only (never fall back to
  plain HTTP), and clearing cookies and site data when Brave closes.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | build and launch the browser |
| `npm test` | unit tests |
| `npm run e2e` | launch the real browser and check its security properties (`-- --network` for the online checks) |
| `npm run update` | update a source checkout: pull, reinstall, re-harden, test, build |
| `npm run doctor` | is Electron still supported, are the fuses set, any npm advisories |
| `npm run lint` | style checks |
| `npm run harden` / `verify-fuses` | flip / check the Electron fuses |
| `npm run package` | packaged build in `dist/` |
| `node tools/smoke.js` | start the packaged build and check it shows its UI |
| `sudo sh tools/install-linux.sh` | install the packaged build to `/opt/brave-2016`, root-owned |
| `npm run verify-install` | check the installed files against their checksums |

## What "not safe" means

Concretely, and in order of how much it matters:

1. **Updates depend on one person.** Dependabot proposes each new Electron (and
   with it Chromium), CI tests it, and a release is built and signed from it -
   but someone has to merge it and tag it. On Linux the installed browser then
   updates itself once you agree; on macOS and Windows you download the new
   release yourself. Until then, every Chromium vulnerability published since
   your build stays open.
2. **Small project, no review.** The security work here was done and tested by
   one person with an AI assistant. It has found and fixed several real holes
   along the way (see [docs/security.md](docs/security.md)); there are almost
   certainly more.
3. **Stricter than a real browser in some places, weaker in others.** No
   "proceed anyway" for bad certificates, and corporate TLS inspection will not
   work at all. On the other hand there is no Safe Browsing service, no
   sandboxed PDF viewer, and only basic fingerprinting protection (an ordinary
   User-Agent, but no canvas or font randomisation).
4. **File integrity on Linux depends on how you install it.** Run from a
   checkout, anything running as your user can modify the browser. Installed to
   `/opt` with the script above, it cannot.

What it does get right, and how each part was checked, is in
[docs/security.md](docs/security.md).

## License

The original 2016 code is MPL-2.0. See `LICENSE.txt`.
