/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const Immutable = require('immutable')
const electron = require('electron')
const app = electron.app
const messages = require('../js/constants/messages')
const BrowserWindow = electron.BrowserWindow
const AppActions = require('../js/actions/appActions')
let appInitialized = false

/**
 * Picks a URL to open out of the process arguments. In 2016 this was only
 * wired up for OS X's 'open-url' event, so `brave <url>` did nothing on Linux
 * or Windows.
 *
 * Only http(s) is accepted: argv URLs can come from other applications on the
 * machine (xdg-open and friends), and web content sessions refuse file: anyway,
 * so a file argument would only ever render as an error page.
 * @param {Array.<string>} argv
 * @return {string|undefined}
 */
const getUrlFromArgs = (argv) => {
  return argv.slice(1).find(arg =>
    arg.startsWith('http://') || arg.startsWith('https://'))
}

module.exports.urlFromArgs = getUrlFromArgs
module.exports.newWindowURL = getUrlFromArgs(process.argv)

app.on('will-finish-launching', function () {
  // User clicked a link when we were the default or via command line like:
  // open -a Brave http://www.brave.com
  app.on('open-url', function (event, path) {
    event.preventDefault()

    if (appInitialized) {
      let wnd = BrowserWindow.getFocusedWindow()
      if (!wnd) {
        const wnds = BrowserWindow.getAllWindows()
        if (wnds.length > 0) {
          wnd = wnds[0]
        }
      }
      if (getUrlFromArgs(['x', path])) {
        if (wnd) {
          wnd.webContents.send(messages.SHORTCUT_NEW_FRAME, path)
        } else {
          AppActions.newWindow(Immutable.fromJS({
            location: path
          }))
        }
      }
    } else {
      module.exports.newWindowURL = getUrlFromArgs(['x', path])
    }
  })
})

process.on(messages.APP_INITIALIZED, () => { appInitialized = true })
