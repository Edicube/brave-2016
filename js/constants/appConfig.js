/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

module.exports = {
  adblock: {
    // The filter lists now come from @ghostery/adblocker, which replaced both
    // the dead s3.amazonaws.com/adblock-data bucket and abp-filter-parser-cpp.
    msBetweenRechecks: 1000 * 60 * 60 * 24, // 1 day
    enabled: true
  },
  trackingProtection: {
    // EasyPrivacy and uBlock Origin's privacy list, in place of the dead
    // s3.amazonaws.com/tracking-protection-data bucket
    msBetweenRechecks: 1000 * 60 * 60 * 24, // 1 day
    enabled: true
  },
  phishing: {
    // Phishing and malware URL blocklists, in place of the Safe Browsing
    // service Electron does not have. Blocked navigations get the warning page
    // in app/blocked.html, with no way to continue - set this to false to turn
    // the blocklist off entirely.
    msBetweenRechecks: 1000 * 60 * 60 * 6, // 6 hours; upstream updates twice a day
    enabled: true
  },
  httpsUpgrade: {
    // Try https for top level http navigations, in place of the retired
    // HTTPS Everywhere. Hosts that cannot do TLS are remembered in
    // no-tls-hosts.json in the profile directory; delete it to retry them.
    enabled: true
  },
  httpsOnly: {
    // With httpsUpgrade: never fall back to plain HTTP, show a warning page
    // instead. Off by default; Bravery menu.
    enabled: false
  },
  clearOnExit: {
    // Clear cookies, site storage and cache for normal tabs when Brave closes.
    // Bookmarks and open tabs are kept. Off by default; Bravery menu.
    enabled: false
  },
  gpc: {
    // Send Sec-GPC: 1 (Global Privacy Control) with every request
    enabled: true
  },
  privacyHeaders: {
    // Trim cross-site referrers to the origin and drop third-party cookies,
    // which is what Brave itself does. This breaks sign-in flows that federate
    // through a third party.
    enabled: true
  },
  updateCheck: {
    // One request to the GitHub releases API, delayed and at most daily, to
    // say when a newer release exists. Nothing is downloaded or installed.
    repo: 'Edicube/brave-2016',
    url: 'https://api.github.com/repos/Edicube/brave-2016/releases/latest',
    releasesPage: 'https://github.com/Edicube/brave-2016/releases',
    delayMs: 30 * 1000,
    msBetweenChecks: 1000 * 60 * 60 * 24,
    enabled: true
  },
  staleness: {
    // How old a build may get before the person using it is warned. The
    // auto-updater is inert, so nothing else would ever say so.
    maxAgeInDays: 45,
    enabled: true
  },
  siteHacks: {
    enabled: true
  }
}
