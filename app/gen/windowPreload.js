"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// js/lib/functional.js
var require_functional = __commonJS({
  "js/lib/functional.js"(exports2, module2) {
    module2.exports.mapValuesByKeys = (o) => Object.keys(o).reduce((newObject, k) => {
      newObject[k] = k.toLowerCase().replace(/_/g, "-");
      return newObject;
    }, {});
    module2.exports.firstDefinedValue = (...arr) => {
      return arr.filter((value) => !isNaN(+value))[0];
    };
  }
});

// js/constants/messages.js
var require_messages = __commonJS({
  "js/constants/messages.js"(exports2, module2) {
    var mapValuesByKeys = require_functional().mapValuesByKeys;
    var _ = null;
    var messages2 = {
      // URL bar shortcuts
      SHORTCUT_FOCUS_URL: _,
      // Active frame shortcuts
      SHORTCUT_ACTIVE_FRAME_STOP: _,
      SHORTCUT_ACTIVE_FRAME_RELOAD: _,
      SHORTCUT_ACTIVE_FRAME_CLEAN_RELOAD: _,
      SHORTCUT_ACTIVE_FRAME_ZOOM_IN: _,
      SHORTCUT_ACTIVE_FRAME_ZOOM_OUT: _,
      SHORTCUT_ACTIVE_FRAME_ZOOM_RESET: _,
      SHORTCUT_ACTIVE_FRAME_TOGGLE_DEV_TOOLS: _,
      SHORTCUT_SET_ACTIVE_FRAME_BY_INDEX: _,
      /** @arg {number} index of frame */
      SHORTCUT_ACTIVE_FRAME_VIEW_SOURCE: _,
      SHORTCUT_SET_ACTIVE_FRAME_TO_LAST: _,
      // built dynamically from the frameShortcuts list in js/stores/windowStore.js,
      // and listed here so it is part of the channel allowlist the window bridge
      // derives from this file
      SHORTCUT_ACTIVE_FRAME_MUTE: _,
      SHORTCUT_ACTIVE_FRAME_SAVE: _,
      SHORTCUT_ACTIVE_FRAME_PRINT: _,
      SHORTCUT_ACTIVE_FRAME_SHOW_FINDBAR: _,
      SHORTCUT_ACTIVE_FRAME_BACK: _,
      SHORTCUT_ACTIVE_FRAME_FORWARD: _,
      SHORTCUT_ACTIVE_FRAME_BOOKMARK: _,
      SHORTCUT_ACTIVE_FRAME_REMOVE_BOOKMARK: _,
      // Frame management shortcuts
      SHORTCUT_NEW_FRAME: _,
      /** @arg {string} opt_url to load if any */
      SHORTCUT_CLOSE_FRAME: _,
      /** @arg {number} opt_key of frame, defaults to active frame */
      SHORTCUT_UNDO_CLOSED_FRAME: _,
      SHORTCUT_FRAME_MUTE: _,
      SHORTCUT_FRAME_RELOAD: _,
      /** @arg {number} key of frame */
      SHORTCUT_NEXT_TAB: _,
      SHORTCUT_PREV_TAB: _,
      // Misc application events
      QUIT_APPLICATION: _,
      UPDATE_APP_MENU: _,
      /** @arg {Object} args menu args to update */
      // The hamburger button in the tabs toolbar asks for the application menu
      SHOW_MAIN_MENU: _,
      // Updates
      UPDATE_REQUESTED: _,
      UPDATE_AVAILABLE: _,
      UPDATE_NOT_AVAILABLE: _,
      CHECK_FOR_UPDATE: _,
      UPDATE_META_DATA_RETRIEVED: _,
      // App state
      APP_INITIALIZED: _,
      // Webview page messages
      ZOOM_IN: _,
      ZOOM_OUT: _,
      ZOOM_RESET: _,
      PRINT_PAGE: _,
      SET_AD_DIV_CANDIDATES: _,
      /** @arg {Array} adDivCandidates, @arg {string} placeholderUrl */
      CONTEXT_MENU_OPENED: _,
      /** @arg {Object} nodeProps properties of node being clicked */
      APP_STATE_CHANGE: _,
      APP_ACTION: _,
      STOP_LOAD: _,
      // Session restore
      REQUEST_WINDOW_STATE: _,
      RESPONSE_WINDOW_STATE: _,
      // Ad block and tracking protection
      BLOCKED_RESOURCE: _,
      // Forwarded from the main process because <webview>'s 'new-window' event
      // was removed in Electron 22
      NEW_WINDOW_REQUESTED: _
    };
    module2.exports = mapValuesByKeys(messages2);
  }
});

// app/content/windowPreload.js
var electron = require("electron");
var contextBridge = electron.contextBridge;
var ipcRenderer = electron.ipcRenderer;
var messages = require_messages();
var allowedChannels = new Set(
  Object.keys(messages).map((key) => messages[key]).concat(["restore-state"])
);
var checkChannel = (channel) => {
  if (!allowedChannels.has(channel)) {
    throw new Error(`channel not allowed: ${channel}`);
  }
};
var wrapped = /* @__PURE__ */ new Map();
var menuSequence = 0;
contextBridge.exposeInMainWorld("braveBridge", {
  // resolved once, at load, so the renderer never needs the app module
  appPath: ipcRenderer.sendSync("bridge-app-path"),
  windowId: ipcRenderer.sendSync("bridge-window-id"),
  send(channel, ...args) {
    checkChannel(channel);
    ipcRenderer.send(channel, ...args);
  },
  on(channel, listener) {
    checkChannel(channel);
    const wrapper = (event, ...args) => listener({}, ...args);
    if (!wrapped.has(listener)) {
      wrapped.set(listener, /* @__PURE__ */ new Map());
    }
    wrapped.get(listener).set(channel, wrapper);
    ipcRenderer.on(channel, wrapper);
  },
  removeListener(channel, listener) {
    const byChannel = wrapped.get(listener);
    const wrapper = byChannel && byChannel.get(channel);
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper);
      byChannel.delete(channel);
    }
  },
  // stands in for remote.getCurrentWebContents().send()
  sendToSelf(channel, ...args) {
    checkChannel(channel);
    ipcRenderer.send("bridge-send-to-self", channel, args);
  },
  // stands in for remote.getCurrentWebContents().downloadURL()
  downloadURL(url) {
    ipcRenderer.send("bridge-download-url", url);
  },
  // stands in for remote.shell.openItem(userData/updateLog.log)
  openUpdateLog() {
    ipcRenderer.send("bridge-open-update-log");
  },
  /**
   * Shows a context menu. The template must already be free of functions: the
   * renderer keeps its click handlers and is called back by item id.
   * @param {Array} template a serializable menu template, items carrying menuId
   * @param {function(number)} onClick called with the id of the clicked item
   */
  popupMenu(template, onClick) {
    const menuId = ++menuSequence;
    const handler = (event, clickedMenuId, itemId) => {
      if (clickedMenuId === menuId) {
        onClick(itemId);
      }
    };
    ipcRenderer.on("bridge-menu-click", handler);
    ipcRenderer.invoke("bridge-popup-menu", menuId, template).catch(() => {
    }).then(() => ipcRenderer.removeListener("bridge-menu-click", handler));
  }
});
//# sourceMappingURL=windowPreload.js.map
