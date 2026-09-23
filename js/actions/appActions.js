/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'
const AppDispatcher = require('../dispatcher/appDispatcher')
const AppConstants = require('../constants/appConstants')

const AppActions = {
  /**
   * Dispatches an event to the main process to replace the app state
   * This is called from the main process on startup before anything else
   *
   * @param {object} appState - Initial app state object (not yet converted to ImmutableJS)
   */
  setState: function (appState) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_SET_STATE,
      appState
    })
  },

  /**
   * Dispatches an event to the main process to create a new window
   */
  newWindow: function (frameOpts, browserOpts, restoredState) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_NEW_WINDOW,
      frameOpts,
      browserOpts,
      restoredState
    })
  },

  closeWindow: function (appWindowId) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_CLOSE_WINDOW,
      appWindowId
    })
  },

  /**
   * Adds a site to the site list
   * @param {Object} frameProps - Properties of the frame in question
   * @param {string} tag - A tag to associate with the site. e.g. bookmarks.
   */
  addSite: function (frameProps, tag) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_ADD_SITE,
      frameProps,
      tag
    })
  },

  /**
   * Removes a site from the site list
   * @param {Object} frameProps - Properties of the frame in question
   * @param {string} tag - A tag to associate with the site. e.g. bookmarks.
   */
  removeSite: function (frameProps, tag) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_REMOVE_SITE,
      frameProps,
      tag
    })
  },

  /**
   * Sets the default window size
   * @param {Array} size - [width, height]
   */
  setDefaultWindowSize: function (size) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_SET_DEFAULT_WINDOW_SIZE,
      size
    })
  },

  /**
   * Sets the etag value for a downloaded data file.
   * This is used for keeping track of when to re-download adblock and tracking
   * protection data.
   * @param {string} resourceName - 'adblock' or 'trackingProtection'
   * @param {string} etag - The etag of the reosurce from the http response
   */
  setResourceETag: function (resourceName, etag) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_SET_DATA_FILE_ETAG,
      resourceName,
      etag
    })
  },

  /**
   * Sets the lastCheck date.getTime() value for the data file
   * @param {string} resourceName - 'adblock', 'trackingProtection', or 'httpsEverywhere'
   * @param {number} lastCheck - The last check date of the reosurce from the http response
   */
  setResourceLastCheck: function (resourceName, lastCheckVersion, lastCheckDate) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_SET_DATA_FILE_LAST_CHECK,
      resourceName,
      lastCheckVersion,
      lastCheckDate
    })
  },

  /**
   * Sets whether the resource is enabled or not.
   * @param {string} resourceName - 'adblock', 'trackingProtection', or 'httpsEverywhere'
   * @param {boolean} enabled - true if the resource is enabled.
   */
  setResourceEnabled: function (resourceName, enabled) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_SET_RESOURCE_ENABLED,
      resourceName,
      enabled
    })
  },

  /**
   * Records a visit in history. Private tabs are never recorded.
   * @param {Object} frameProps - with location and title
   */
  recordVisit: function (frameProps) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_ADD_SITE,
      frameProps
    })
  },

  /**
   * Removes one address from history; bookmarks and pins are kept.
   * @param {string} location
   */
  removeHistoryEntry: function (location) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_REMOVE_HISTORY_ENTRY,
      location
    })
  },

  clearHistory: function () {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_CLEAR_HISTORY
    })
  },

  /**
   * Turns ad, tracker and third-party cookie blocking off (or back on) for
   * one site.
   * @param {string} host
   * @param {boolean} shieldsDown
   */
  setSiteShields: function (host, shieldsDown) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_SET_SITE_SHIELDS,
      host,
      shieldsDown
    })
  },

  /**
   * @param {string} theme - 'system', 'light' or 'dark'
   */
  /**
   * Forgets a permission decision made this session
   * @param {string} origin
   * @param {string} key as in app/permissions.js, e.g. 'notifications'
   */
  revokePermission: function (origin, key) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_REVOKE_PERMISSION,
      origin,
      key
    })
  },

  /**
   * @param {number} id a download's id from the downloads list
   * @param {string} action cancel, pause, resume, show or remove
   */
  downloadAction: function (id, action) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_DOWNLOAD_ACTION,
      id,
      action
    })
  },

  /**
   * Asks for a bookmarks file exported from another browser and imports it
   */
  importBookmarks: function () {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_IMPORT_BOOKMARKS
    })
  },

  setTheme: function (theme) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_SET_THEME,
      theme
    })
  },

  /**
   * @param {string} provider - a key of js/constants/dnsProviders.js
   */
  setDnsProvider: function (provider) {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_SET_DNS_PROVIDER,
      provider
    })
  },

  checkForUpdates: function () {
    AppDispatcher.dispatch({
      actionType: AppConstants.APP_CHECK_FOR_UPDATES
    })
  }
}

module.exports = AppActions
