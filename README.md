# Brave 2016

[![CI](https://github.com/Edicube/brave-2016/actions/workflows/ci.yml/badge.svg)](https://github.com/Edicube/brave-2016/actions/workflows/ci.yml)

> **⚠️ This browser is not safe for everyday use.**
>
> It is a hobby revival of the January 2016 Brave codebase, not a maintained
> browser. There is no auto-updater, so it only receives Chromium security
> fixes when someone rebuilds it by hand; no security team reviews it; and
> parts of it are 2016 code that was never written with today's threats in
> mind. Do not use it for banking, email, work accounts or anything else you
> cannot afford to lose. Use a maintained browser for those.

A desktop browser built on the 2016 Brave codebase (MPL-2.0), updated to run on
Electron 44. Original UI, modern security posture - as far as a project like
this can have one. See [What "not safe" means](#what-not-safe-means).

## Installing a release

Download the latest archive from
[Releases](https://github.com/Edicube/brave-2016/releases), then check it and
install it root-owned, so nothing running as your user can modify it:

```bash
sha256sum -c SHA256SUMS.txt
gh attestation verify brave-2016-*-linux-x64.tar.gz -R Edicube/brave-2016
tar xzf brave-2016-*-linux-x64.tar.gz
sudo sh "Brave 2016-linux-x64/install.sh"
```

`gh attestation verify` proves the archive was built by this repository's
release workflow from a tagged commit, not by someone's laptop.

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
- **Drops third-party cookies** and trims cross-site referrers to the origin.
- **Refuses bad certificates** with an explanation, and asks before every
  download.
- **Asks before a site gets the camera, microphone or notifications**, for this
  session only; everything else (location, USB, MIDI, screen capture...) is
  refused outright.
- **Shows download progress** on the taskbar, notifies when a download finishes,
  and can cancel them from File > Cancel downloads.
- **Tells you when a newer release exists** - one request to GitHub, at most
  daily. It does not download or install anything by itself.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | build and launch the browser |
| `npm test` | unit tests |
| `npm run e2e` | launch the real browser and check its security properties (`-- --network` for the online checks) |
| `npm run doctor` | is Electron still supported, are the fuses set, any npm advisories |
| `npm run lint` | style checks |
| `npm run harden` / `verify-fuses` | flip / check the Electron fuses |
| `npm run package` | packaged build in `dist/` |
| `sudo sh tools/install-linux.sh` | install the packaged build to `/opt/brave-2016`, root-owned |
| `npm run verify-install` | check the installed files against their checksums |

## What "not safe" means

Concretely, and in order of how much it matters:

1. **No automatic updates.** Nothing installs itself. Dependabot opens a pull
   request when Electron (and with it Chromium) has a new release, CI tests it,
   and a tagged release is built from it - but you still have to download and
   install that release. Until you do, every Chromium vulnerability published
   since your build stays open. The browser tells you when a newer release
   exists, and warns once a build is 45 days old.
2. **Small project, no review.** The security work here was done and tested by
   one person with an AI assistant. It has found and fixed several real holes
   along the way (see [docs/security.md](docs/security.md)); there are almost
   certainly more.
3. **Stricter than a real browser in some places, weaker in others.** No
   "proceed anyway" for bad certificates, and corporate TLS inspection will not
   work at all. On the other hand there is no Safe Browsing service, no site
   isolation tuning, no sandboxed PDF viewer, and no fingerprinting protection.
4. **File integrity on Linux depends on how you install it.** Run from a
   checkout, anything running as your user can modify the browser. Installed to
   `/opt` with the script above, it cannot.

What it does get right, and how each part was checked, is in
[docs/security.md](docs/security.md).

## License

The original 2016 code is MPL-2.0. See `LICENSE.txt`.
