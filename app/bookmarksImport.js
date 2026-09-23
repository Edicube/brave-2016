/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Bookmarks > Import from a file exported by another browser. The file is
// picked in the main process's own dialog, so a window can ask for an import
// but never name the file.

const electron = require('electron')
const fs = require('fs')
const BookmarksHtml = require('./lib/bookmarksHtml')

const maxFileBytes = 20 * 1024 * 1024

module.exports.chooseAndImport = async () => {
  const parent = electron.BrowserWindow.getFocusedWindow()
  const options = {
    title: 'Import bookmarks',
    message: 'Choose a bookmarks file exported from another browser',
    properties: ['openFile'],
    filters: [{ name: 'Bookmarks file', extensions: ['html', 'htm'] }]
  }
  const picked = parent
    ? await electron.dialog.showOpenDialog(parent, options)
    : await electron.dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths.length) {
    return
  }
  let message
  try {
    const file = picked.filePaths[0]
    if (fs.statSync(file).size > maxFileBytes) {
      throw new Error('the file is larger than 20 MB')
    }
    const bookmarks = BookmarksHtml.parse(fs.readFileSync(file, 'utf8'))
    const added = require('../js/stores/appStore').addBookmarks(bookmarks)
    message = bookmarks.length === 0
      ? 'No web bookmarks were found in that file.'
      : `Imported ${added} new bookmark${added === 1 ? '' : 's'}` +
        (added < bookmarks.length ? ` (${bookmarks.length - added} were already bookmarked).` : '.')
  } catch (e) {
    message = 'Could not import that file: ' + e.message
  }
  const box = { type: 'info', title: 'Import bookmarks', message }
  if (parent && !parent.isDestroyed()) {
    electron.dialog.showMessageBox(parent, box)
  } else {
    electron.dialog.showMessageBox(box)
  }
}
