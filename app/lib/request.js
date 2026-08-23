/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

// Minimal drop-in for the two `request` call shapes this codebase uses:
//   request(url, cb(err, response, body))
//   request.get({url, headers}) -> stream, emits 'response', can be piped
// The npm `request` package has been deprecated since 2020.

const http = require('http')
const https = require('https')

const PassThrough = require('stream').PassThrough

const maxRedirects = 5
// Idle socket timeout: a server that accepts and then never answers must not
// stall startup chains forever.
const idleTimeoutMs = 30 * 1000

function doRequest (options, cb, redirectCount) {
  const opts = typeof options === 'string' ? { url: options } : options
  const out = new PassThrough()
  send(opts, out, cb, redirectCount || 0)
  return out
}

function send (opts, out, cb, redirectCount) {
  let parsed
  try {
    parsed = new URL(opts.url)
  } catch (e) {
    out.emit('error', e)
    if (cb) cb(e)
    return
  }
  const lib = parsed.protocol === 'http:' ? http : https
  let body = ''

  const req = lib.request({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: opts.method || 'GET',
    headers: opts.headers || {}
  }, (res) => {
    const location = res.headers['location']
    if (location && res.statusCode >= 300 && res.statusCode < 400) {
      if (redirectCount >= maxRedirects) {
        const err = new Error('too many redirects')
        out.emit('error', err)
        if (cb) cb(err)
        return
      }
      let next
      try {
        next = new URL(location, opts.url)
      } catch (e) {
        out.emit('error', e)
        if (cb) cb(e)
        return
      }
      // Mirrors legitimately redirect, but a chain that leaves https hands
      // whatever is at the end of it to whatever network produced it. From a
      // secure origin that is refused rather than followed.
      if (parsed.protocol === 'https:' && next.protocol !== 'https:') {
        const err = new Error(`refusing an insecure redirect from ${opts.url}`)
        out.emit('error', err)
        if (cb) cb(err)
        return
      }
      res.resume()
      send(Object.assign({}, opts, { url: next.toString() }),
        out, cb, redirectCount + 1)
      return
    }

    out.emit('response', res)
    res.pipe(out)

    if (cb) {
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => cb(null, res, body))
    }
  })

  req.setTimeout(idleTimeoutMs, () => {
    req.destroy(new Error(`no data from ${opts.url} within ${idleTimeoutMs / 1000}s`))
  })
  req.on('error', (err) => {
    out.emit('error', err)
    if (cb) cb(err)
  })
  req.end()
}

module.exports = doRequest
module.exports.get = (options, cb) => doRequest(Object.assign(
  typeof options === 'string' ? {url: options} : options, {method: 'GET'}), cb)
