/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import Config from '../constants/config.js'
import Immutable from 'immutable'

// If the description cannot be read, searching still has to work: without a
// fallback, searchDetail stays null and pressing Enter on a search term throws.
const fallback = Immutable.fromJS({
  searchURL: 'https://duckduckgo.com/?q={searchTerms}',
  autocompleteURL: 'https://duckduckgo.com/ac/?q={searchTerms}&type=list'
})

/**
 * Loads the specified open search path and resolves the returned promise.
 * Always resolves: a search provider is not optional.
 */
export function loadOpenSearch (path) {
  return new Promise(resolve => {
    let xhr = new window.XMLHttpRequest()
    const giveUp = (why) => {
      console.warn(`could not load the search description (${why}), using the default`)
      resolve(fallback)
    }
    xhr.onerror = () => giveUp('request failed')
    xhr.ontimeout = () => giveUp('timed out')
    xhr.open('GET', path || Config.defaultOpenSearchPath, true)
    try {
      xhr.send()
    } catch (e) {
      giveUp(e.message)
      return
    }
    xhr.onload = () => {
      if (xhr.status !== 0 && xhr.status !== 200) {
        giveUp('HTTP ' + xhr.status)
        return
      }
      let parser = new window.DOMParser()
      let doc = parser.parseFromString(xhr.responseText, 'text/xml')
      window.doc = doc
      let searchURL
      let autocompleteURL

      try {
        searchURL = doc.querySelector('Url[type="text/html"]')
          .attributes.template.value
      } catch (e) {
        console.warn('Search provider does not specify a search url.')
      }

      try {
        autocompleteURL = doc.querySelector('Url[type="application/x-suggestions+json"]')
          .attributes.template.value
      } catch (e) {
        console.warn('Search provider does not specify an autocomplete url.')
      }

      if (!searchURL) {
        giveUp('no search url in the description')
        return
      }

      resolve(Immutable.fromJS({
        searchURL,
        autocompleteURL: autocompleteURL || fallback.get('autocompleteURL')
      }))
    }
  })
}
