/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'strict mode'

const path = require('path')
const fs = require('fs')

// Read and parse package.json
exports.load = (done) => {
  const packagePath = path.join(__dirname, '..', 'package.json')
  fs.readFile(packagePath, 'utf-8', (err, contents) => {
    if (err) {
      done(err)
      return
    }
    // throwing from inside an fs callback escapes every try/catch around the
    // caller and takes the main process with it
    try {
      done(null, JSON.parse(contents))
    } catch (e) {
      done(e)
    }
  })
}
