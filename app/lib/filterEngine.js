/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Loads a @ghostery/adblocker engine, cached on disk between runs.
//
// This plays the role app/dataFile.js played for the original .dat files: the
// filter lists are fetched once, compiled, and the compiled engine is
// serialised into the user data directory so later starts are instant. It
// replaces both dead S3 buckets and the two native matchers that read them.

const fs = require('fs')
const path = require('path')
const app = require('electron').app
const adblocker = require('@ghostery/adblocker')
const AppConfig = require('../../js/constants/appConfig')

const FiltersEngine = adblocker.FiltersEngine

const cachePath = (resourceName) =>
  path.join(app.getPath('userData'), `${resourceName}-engine.dat`)

/**
 * @param {string} resourceName key into appConfig
 * @return {Promise.<{engine: FiltersEngine, stale: boolean}>} the cached
 *   engine, or a rejection if there is no readable cache
 */
function loadFromCache (resourceName) {
  return new Promise((resolve, reject) => {
    const file = cachePath(resourceName)
    fs.stat(file, (err, stats) => {
      if (err || !stats.isFile()) {
        reject(new Error('no cached engine'))
        return
      }
      const age = new Date().getTime() - stats.mtime.getTime()
      fs.readFile(file, (readErr, data) => {
        if (readErr) {
          reject(readErr)
          return
        }
        try {
          // throws if the library's serialisation format has moved on
          resolve({
            engine: FiltersEngine.deserialize(data),
            stale: age > AppConfig[resourceName].msBetweenRechecks
          })
        } catch (e) {
          reject(e)
        }
      })
    })
  })
}

function saveToCache (resourceName, engine) {
  return new Promise((resolve) => {
    // a failed cache write only costs us the next startup, so never reject
    fs.writeFile(cachePath(resourceName), engine.serialize(), (err) => {
      if (err) {
        console.log(`could not cache the ${resourceName} engine:`, err.message)
      }
      resolve(engine)
    })
  })
}

// Filter lists live on https mirrors that legitimately redirect, but a chain
// that ends anywhere other than https would hand attacker-controlled rules to
// whatever network path produced it. Verify where the response actually came
// from before letting it become a filter engine.
const httpsOnlyFetch = (url, opts) =>
  fetch(url, opts).then(resp => {
    if (!String(resp.url).startsWith('https:')) {
      throw new Error(`filter list did not come from https: ${url}`)
    }
    return resp
  })

function fetchFresh (resourceName, lists) {
  return FiltersEngine.fromLists(httpsOnlyFetch, lists)
    .then(engine => saveToCache(resourceName, engine))
}

/**
 * Hands over an engine as soon as one is available.
 *
 * A stale cache is still used immediately and refreshed in the background, so
 * that blocking is never off for the half minute it takes to download and
 * compile a dozen filter lists.
 *
 * @param {string} resourceName key into appConfig, used for the cache filename
 * @param {Array.<string>} lists filter list URLs to compile
 * @param {function(FiltersEngine)} onEngine called with the engine, and again
 *   later if a background refresh produces a newer one
 * @return {Promise} resolves once an engine has been handed over
 */
module.exports.load = (resourceName, lists, onEngine) => {
  return loadFromCache(resourceName).then((cached) => {
    const engine = cached.engine
    onEngine(engine)
    if (cached.stale) {
      fetchFresh(resourceName, lists)
        .then(onEngine)
        .catch(err => {
          console.log(`could not refresh ${resourceName}:`, (err && err.message) || err)
        })
    }
  }).catch(() => fetchFresh(resourceName, lists).then(onEngine))
}

// Electron's resourceType names, mapped onto the WebRequest types the engine
// matches filter options against.
const requestTypes = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xhr',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other'
}

/**
 * @param {object} details a webRequest details object
 * @return {string} the matching engine request type
 */
module.exports.requestType = (details) =>
  requestTypes[details.resourceType] || 'other'

// Phishing and malware URL blocklists, in ABP syntax, from
// https://gitlab.com/malware-filter - refreshed every 12 hours upstream.
module.exports.phishingLists = [
  'https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt',
  'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter.txt'
]

module.exports.Request = adblocker.Request
module.exports.adsLists = adblocker.adsLists
// the lists adsAndTrackingLists adds on top of the ad lists
module.exports.trackingLists = adblocker.adsAndTrackingLists
  .filter(url => !adblocker.adsLists.includes(url))
