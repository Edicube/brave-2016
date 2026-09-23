/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Reads the bookmarks file every browser exports ("Netscape bookmark file",
// bookmarks.html). Pure, so it can be tested without Electron. The file comes
// from anywhere, so only web addresses are taken, and only so many.

const maxBookmarks = 5000

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode (text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X'
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return Object.prototype.hasOwnProperty.call(entities, name.toLowerCase())
      ? entities[name.toLowerCase()]
      : whole
  })
}

/**
 * @param {string} html the exported file
 * @return {Array<{location: string, title: string}>} web bookmarks, first
 *   occurrence of each address, at most 5000
 */
module.exports.parse = (html) => {
  const found = []
  const seen = new Set()
  const link = /<a\s[^>]*?\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/gi
  let m
  while ((m = link.exec(String(html))) && found.length < maxBookmarks) {
    const location = decode(m[1]).trim()
    if (location.length > 4096 || !/^https?:\/\/[^\s]+$/i.test(location) || seen.has(location)) {
      continue
    }
    try {
      new URL(location) // eslint-disable-line no-new
    } catch (e) {
      continue
    }
    seen.add(location)
    const title = decode(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 500)
    found.push({ location, title: title || location })
  }
  return found
}

module.exports.maxBookmarks = maxBookmarks
