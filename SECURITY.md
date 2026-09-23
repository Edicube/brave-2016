# Security policy

Brave 2016 is a hobby project and **not safe for everyday use** - see the
[README](README.md#what-not-safe-means). Reports are still very welcome, and
the security work so far is described in [docs/security.md](docs/security.md).

## Reporting a vulnerability

Please report privately, not in a public issue:

**[Report a vulnerability](https://github.com/Edicube/brave-2016/security/advisories/new)**
(GitHub private vulnerability reporting)

Useful to include: what an attacker can do, the steps or a page that shows
it, and the version (File > Check for updates shows it; for a source checkout,
the commit).

## What is in scope

- Anything that lets a web page reach the browser's UI (`brave://ui`), the
  window bridge, node, or the file system
- Getting around a protection this browser claims: the `file:` refusal,
  permission prompts, certificate checks, HTTPS upgrading, phishing blocking,
  third-party cookie stripping, the `window.open` allowlist
- The self-updater accepting something it should not (see
  `app/selfUpdate.js`), and the release signing
- The build and release workflows

Chromium bugs themselves belong to [the Chromium project](https://www.chromium.org/Home/chromium-security/reporting-security-bugs/).
If one is already fixed upstream, the fix here is an Electron update - a report
saying "this build is on an Electron with known issues" is still useful.

## Supported versions

Only the latest release and `master`. There are no backports.
