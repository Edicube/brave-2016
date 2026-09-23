/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'
const Immutable = require('immutable')

// Not called `exports`: that name is already a parameter of the CommonJS
// module wrapper, and redeclaring it with const is a syntax error.
const siteUtil = {}

/**
 * Obtains the index of the location in sites
 *
 * @param sites The application state's Immutable sites list
 * @param location The frameProps of the page in question
 * @return index of the location or -1 if not found.
 */
siteUtil.getSiteUrlIndex = function (sites, location) {
  return sites.findIndex(site => site.get('location') === location)
}

/**
 * Checks if a frameProps has the specified tag
 *
 * @param sites The application state's Immutable sites list
 * @param location The location of the page in question
 * @param tag The tag of the site to check
 * @return true if the location is already bookmarked
 */
siteUtil.isSiteInList = function (sites, location, tag) {
  const index = siteUtil.getSiteUrlIndex(sites, location)
  if (index === -1) {
    return false
  }
  return sites.get(index).get('tags').includes(tag)
}

/**
 * Adds the specified frameProps to sites
 *
 * @param sites The application state's Immutable site list
 * @param frameProps The frameProps of the page in question
 * @param tag The tag to add for this site.  Supported tags are:
 *   'bookmark' for bookmarks.
 *   'reader' for reading list.
 * Otherwise it's only considered to be a history item
 * @return The new sites Immutable object
 */
siteUtil.addSite = function (sites, frameProps, tag) {
  const index = siteUtil.getSiteUrlIndex(sites, frameProps.get('location'))
  let tags = sites.getIn([index, 'tags']) || new Immutable.List()
  if (tag) {
    tags = tags.toSet().add(tag).toList()
  } else {
    // If we aren't adding any tags and we're a private tab,
    // then do nothing.
    if (frameProps.get('isPrivate')) {
      return sites
    }
  }

  const site = Immutable.fromJS({
    lastAccessed: new Date(),
    tags,
    location: frameProps.get('location'),
    title: frameProps.get('title')
  })

  if (index === -1) {
    return sites.push(site)
  }

  return sites.setIn([index], site)
}

/**
 * Removes the specified frameProps from sites
 *
 * @param sites The application state's Immutable sites list
 * @param frameProps The frameProps of the page in question
 * @return The new sites Immutable object
 */
siteUtil.removeSite = function (sites, frameProps, tag) {
  let index = -1
  if (frameProps.get('isPinned')) {
    index = siteUtil.getSiteUrlIndex(sites, frameProps.get('src'))
  }
  // When pinning a tab from the current window the src might not be
  // set to the current site on that first window.
  // So only if it's not found with the src and it's a pinned tab,
  // then check the src then location.  This also fixes pinned sites
  // with HTTPS Everywhere.
  if (index === -1) {
    index = siteUtil.getSiteUrlIndex(sites, frameProps.get('location'))
  }
  if (index === -1) {
    return sites
  }
  const tags = sites.getIn([index, 'tags'])
  return sites.setIn([index, 'tags'], tags.toSet().remove(tag).toList())
}

/**
 * Detemrines the icon class to use for the site
 *
 * @param site The site in question
 * @return the class of the fontawesome icon to use
 */
siteUtil.getSiteIconClass = function (site) {
  if (site.get('tags').includes('bookmark')) {
    return 'fa-star-o'
  }
  if (site.get('tags').includes('reader')) {
    return 'fa-book'
  }
  return 'fa-file-o'
}

const isUntagged = (site) => !site.get('tags') || site.get('tags').size === 0

/**
 * Most recent history entries kept. The whole app state is sent to every
 * window on each change, so an unbounded history would slow every navigation.
 */
siteUtil.maxHistory = 1000

/**
 * Drops the oldest untagged (history-only) entries beyond the limit.
 * Bookmarks and pins are never dropped.
 */
siteUtil.capHistory = function (sites, max) {
  max = max || siteUtil.maxHistory
  const history = sites.filter(isUntagged)
  if (history.size <= max) {
    return sites
  }
  const cutoff = history
    .map(site => new Date(site.get('lastAccessed')).getTime() || 0)
    .sort((a, b) => b - a)
    .get(max - 1)
  let kept = 0
  return sites.filter(site => {
    if (!isUntagged(site)) {
      return true
    }
    const t = new Date(site.get('lastAccessed')).getTime() || 0
    if (t > cutoff || (t === cutoff && kept < max)) {
      kept++
      return true
    }
    return false
  })
}

/**
 * Removes an address from history. A bookmarked or pinned entry stays.
 */
siteUtil.removeHistoryEntry = function (sites, location) {
  return sites.filter(site => site.get('location') !== location || !isUntagged(site))
}

siteUtil.clearHistory = function (sites) {
  return sites.filter(site => !isUntagged(site))
}

module.exports = siteUtil
