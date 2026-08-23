/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const AppConfig = require('../js/constants/appConfig')
const crashReporter = require('electron').crashReporter

// Crash reports would be auto-submitted to a 2016 endpoint that no longer
// expects them, and minidumps carry machine state. The module stays wired for
// anyone who wants it back, but silent telemetry is off unless it is asked
// for explicitly at launch.
exports.init = () => {
  if (!process.env.BRAVE_CRASH_REPORTS) {
    return
  }
  const options = {
    productName: 'Brave Developers',
    companyName: 'Brave.com',
    submitURL: AppConfig.crashes.crashSubmitUrl,
    autoSubmit: true,
    ignoreSystemCrashHandler: true
  }
  crashReporter.start(options)
}
