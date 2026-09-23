/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-disable n/no-callback-literal -- Electron callbacks take a result, not a node-style error */

'use strict'

// Asks before a site gets the camera, the microphone or notifications.
//
// Electron grants every permission when no handler is installed, and this
// version of Brave never had a prompt, so until now the only safe answer was
// no, always - which meant video calls simply did not work. Now those few
// permissions are asked about; everything else stays refused outright.
//
// Decisions last for the session only, and a "Block" is remembered as firmly
// as an "Allow", so a page cannot keep re-asking until it gets a yes.

const electron = require('electron')
const dialog = electron.dialog
const BrowserWindow = electron.BrowserWindow

const debug = (...args) => {
  if (process.env.BRAVE_DEBUG) {
    console.log('[permissions]', ...args)
  }
}

// Never harmful, cannot read anything back: granted without asking
const alwaysAllowed = new Set([
  'fullscreen',
  'mediaKeySystem',
  'clipboard-sanitized-write'
])

// Asked about. Location is not here: Electron has no location provider
// without a Google API key, so it could not work even if allowed.
const askable = new Set(['media', 'notifications'])

// origin + '|' + what -> true (allowed) / false (blocked), for this session
const decisions = new Map()
// origin + '|' + what -> callbacks waiting on a prompt already on screen
const pending = new Map()
// what.key -> what.label, for showing decisions in Settings
const labels = new Map()

// The decisions, for the list in Settings. Held in app state but never saved.
function publish () {
  const list = []
  for (const [key, allowed] of decisions) {
    const split = key.lastIndexOf('|')
    const what = key.slice(split + 1)
    list.push({ origin: key.slice(0, split), key: what, label: labels.get(what) || what, allowed })
  }
  try {
    require('../js/stores/appStore').setSessionOnly('sitePermissions', list)
  } catch (e) {
    debug('could not publish decisions:', e.message)
  }
}

/**
 * Forgets one decision, so the site is asked again next time.
 * @param {string} origin
 * @param {string} key
 * @return {boolean} whether there was such a decision
 */
module.exports.revoke = (origin, key) => {
  const had = decisions.delete(origin + '|' + key)
  if (had) {
    debug(`forgot ${key} for ${origin}`)
    publish()
  }
  return had
}

const originOf = (target) => {
  try {
    const u = new URL(target)
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.origin : null
  } catch (e) {
    return null
  }
}

/**
 * What a request is for, in a form fit for a decision key and for the user.
 * @return {{key: string, label: string}|null}
 */
function describe (permission, details) {
  if (permission === 'notifications') {
    return { key: 'notifications', label: 'show notifications' }
  }
  if (permission === 'media') {
    const types = ((details && details.mediaTypes) || []).slice().sort()
    if (!types.length || types.some(t => t !== 'audio' && t !== 'video')) {
      return null
    }
    const label = types.length === 2
      ? 'use your camera and microphone'
      : types[0] === 'video' ? 'use your camera' : 'use your microphone'
    return { key: 'media:' + types.join('+'), label }
  }
  return null
}

/**
 * The decision that needs no user: 'allow', 'deny', or 'ask'. Pure, so it can
 * be tested without Electron.
 *
 * @param {string} permission
 * @param {object} details from the permission request
 * @param {string} topUrl URL of the page in the tab
 * @return {'allow'|'deny'|'ask'}
 */
function classify (permission, details, topUrl) {
  if (alwaysAllowed.has(permission)) {
    return 'allow'
  }
  if (!askable.has(permission) || process.env.BRAVE_DENY_PERMISSIONS) {
    return 'deny'
  }
  const requesting = originOf((details && details.requestingUrl) || topUrl)
  const top = originOf(topUrl)
  // Only the page the user is looking at may ask, not a frame it embeds
  if (!requesting || !top || requesting !== top) {
    return 'deny'
  }
  if (!describe(permission, details)) {
    return 'deny'
  }
  return 'ask'
}

function ask (webContents, origin, what, done) {
  const key = origin + '|' + what.key
  if (decisions.has(key)) {
    done(decisions.get(key))
    return
  }
  if (pending.has(key)) {
    pending.get(key).push(done)
    return
  }
  pending.set(key, [done])

  const host = webContents.hostWebContents || webContents
  const parent = BrowserWindow.fromWebContents(host)
  const options = {
    type: 'question',
    buttons: ['Block', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    title: 'Permission',
    message: `${new URL(origin).host} wants to ${what.label}.`,
    detail: 'Allowed until you close Brave.'
  }
  const shown = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
  shown.then(({ response }) => response === 1, () => false).then((allowed) => {
    decisions.set(key, allowed)
    labels.set(what.key, what.label)
    publish()
    debug(`${allowed ? 'allowed' : 'blocked'} ${what.key} for ${origin}`)
    const waiting = pending.get(key) || []
    pending.delete(key)
    waiting.forEach(cb => cb(allowed))
  })
}

/**
 * @param {Session} ses
 */
module.exports.register = (ses) => {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const topUrl = webContents ? webContents.getURL() : ''
    const verdict = classify(permission, details, topUrl)
    if (verdict !== 'ask') {
      debug(`${verdict} ${permission} for`, (details && details.requestingUrl) || topUrl)
      callback(verdict === 'allow')
      return
    }
    ask(webContents, originOf(topUrl), describe(permission, details), callback)
  })

  // navigator.permissions.query and friends: true only once actually granted
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (alwaysAllowed.has(permission)) {
      return true
    }
    const origin = originOf(requestingOrigin)
    if (!origin) {
      return false
    }
    for (const [key, allowed] of decisions) {
      if (allowed && key.startsWith(origin + '|') &&
          key.slice(origin.length + 1).split(':')[0] === permission) {
        return true
      }
    }
    return false
  })
}

module.exports.classifyForTest = classify
module.exports.describeForTest = describe
