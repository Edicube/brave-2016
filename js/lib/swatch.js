/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stands in for vibrant.js, which was pulled from a GitHub tag that no longer
// resolves. Picks a representative colour out of a favicon by quantising its
// pixels into coarse buckets and taking the most populated one that isn't
// near-white, near-black or transparent - which is what the swatch ordering in
// frameStateUtil was reaching for.

const toHex = (r, g, b) =>
  '#' + [r, g, b].map(c => ('0' + Math.round(c).toString(16)).slice(-2)).join('')

/**
 * @param {Image} img a fully loaded image
 * @return {string|undefined} the dominant colour as #rrggbb
 */
module.exports.dominantColor = (img) => {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, size, size)

  let pixels
  try {
    pixels = ctx.getImageData(0, 0, size, size).data
  } catch (e) {
    // tainted canvas
    return undefined
  }

  const buckets = new Map()
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a < 128) {
      continue
    }
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]

    // skip the flat background most favicons sit on
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max > 240 && min > 240) {
      continue
    }
    if (max < 24) {
      continue
    }

    // 5 bits per channel is coarse enough to group shades of the same colour
    const key = (r >> 3 << 10) | (g >> 3 << 5) | (b >> 3)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }

  let best
  buckets.forEach(bucket => {
    if (!best || bucket.count > best.count) {
      best = bucket
    }
  })

  if (!best) {
    return undefined
  }
  return toHex(best.r / best.count, best.g / best.count, best.b / best.count)
}
