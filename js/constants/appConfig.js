/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// UPDATE_HOST should be set to the host name for the auto-updater server
var updateHost = process.env.UPDATE_HOST || 'https://brave-laptop-updates.global.ssl.fastly.net'
var winUpdateHost = process.env.WIN_UPDATE_HOST || 'https://brave-download.global.ssl.fastly.net'
var crashURL = process.env.CRASH_URL || 'https://laptop-updates.brave.com/1/crashes'

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
  httpsEverywhere: {
    url: 'https://s3.amazonaws.com/https-everywhere-data/{version}/rulesets.sqlite',
    targetsUrl: 'https://s3.amazonaws.com/https-everywhere-data/{version}/httpse-targets.json',
    version: '5.1.2', // latest stable release from https://eff.org/https-everywhere
    msBetweenRechecks: 1000 * 60 * 60 * 24, // 1 day
    // HTTPS Everywhere was retired in 2022 (browsers do HTTPS-first now) and
    // this needed a native sqlite3 build to read its ruleset
    enabled: false
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
  privacyHeaders: {
    // Trim cross-site referrers to the origin and drop third-party cookies,
    // which is what Brave itself does. This breaks sign-in flows that federate
    // through a third party.
    enabled: true
  },
  siteHacks: {
    enabled: true
  },
  crashes: {
    crashSubmitUrl: crashURL
  },
  updates: {
    // Check for front end updates every hour
    appUpdateCheckFrequency: 1000 * 60 * 60,
    // Check after 2 minutes, near startup
    runtimeUpdateCheckDelay: 1000 * 60 * 2,
    // If true user will not be notified before updates are reloaded
    autoAppUpdate: false,
    autoRuntimeUpdate: false,
    // url to check for updates
    baseUrl: `${updateHost}/1/releases`,
    winBaseUrl: `${winUpdateHost}/releases/winx64`
  }
}
