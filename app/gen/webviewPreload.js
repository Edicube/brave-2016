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

// js/constants/keyCodes.js
var require_keyCodes = __commonJS({
  "js/constants/keyCodes.js"(exports2, module2) {
    var KeyCodes2 = {
      ENTER: 13,
      ESC: 27,
      UP: 38,
      DOWN: 40
    };
    module2.exports = KeyCodes2;
  }
});

// app/content/webviewPreload.js
var webFrame = require("electron").webFrame;
var ipc = require("electron").ipcRenderer;
var messages = require_messages();
var KeyCodes = require_keyCodes();
var browserZoomLevel = 0;
var browserMaxZoom = 9;
var browserMinZoom = -8;
ipc.on(messages.ZOOM_IN, function() {
  if (browserMaxZoom > browserZoomLevel) {
    browserZoomLevel += 1;
  }
  webFrame.setZoomLevel(browserZoomLevel);
});
ipc.on(messages.ZOOM_OUT, function() {
  if (browserMinZoom < browserZoomLevel) {
    browserZoomLevel -= 1;
  }
  webFrame.setZoomLevel(browserZoomLevel);
});
ipc.on(messages.ZOOM_RESET, function() {
  browserZoomLevel = 0;
  webFrame.setZoomLevel(browserZoomLevel);
});
function ensureNodeVisible(node) {
  if (document.defaultView.getComputedStyle(node).display === "none") {
    node.style.display = "";
  }
  if (document.defaultView.getComputedStyle(node).zIndex === "-1") {
    node.style.zIndex = "";
  }
}
function getAdSize(node, iframeData) {
  var acceptableAdSizes = [
    [970, 250],
    [970, 90],
    [728, 90],
    [300, 250],
    [300, 600],
    [160, 600],
    [120, 600],
    [320, 50]
  ];
  for (var i = 0; i < acceptableAdSizes.length; i++) {
    var adSize = acceptableAdSizes[i];
    if (node.offsetWidth === adSize[0] && node.offsetHeight >= adSize[1] || node.offsetWidth >= adSize[0] && node.offsetHeight === adSize[1]) {
      return adSize;
    }
  }
  if (iframeData) {
    return [iframeData.width || iframeData.w, iframeData.height || iframeData.h];
  }
  return null;
}
function processAdNode(node, iframeData, replacementUrl) {
  if (!node) {
    return;
  }
  var adSize = getAdSize(node, iframeData);
  if (!adSize) {
    node.style.display = "none";
    return;
  }
  var segments = ["IAB2", "IAB17", "IAB14", "IAB21", "IAB20"];
  var segment = segments[Math.floor(Math.random() * 4)];
  var time_in_segment = (/* @__PURE__ */ new Date()).getSeconds();
  var segment_expiration_time = 0;
  var srcUrl = replacementUrl + "?width=" + adSize[0] + "&height=" + adSize[1] + "&seg=" + segment + ":" + time_in_segment + ":" + segment_expiration_time;
  var src = '<html><body style="width: ' + adSize[0] + "px; height: " + adSize[1] + '; padding: 0; margin: 0; overflow: hidden;"><script src="' + srcUrl + '"></script></body></html>';
  if (node.tagName === "IFRAME") {
    node.srcdoc = src;
  } else {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    var iframe = document.createElement("iframe");
    iframe.style.padding = 0;
    iframe.style.border = 0;
    iframe.style.margin = 0;
    iframe.style.width = adSize[0] + "px";
    iframe.style.height = adSize[1] + "px";
    iframe.srcdoc = src;
    node.appendChild(iframe);
    ensureNodeVisible(node);
    if (node.parentNode) {
      ensureNodeVisible(node.parentNode);
      if (node.parentNode) {
        ensureNodeVisible(node.parentNode.parentNode);
      }
    }
  }
}
ipc.on(messages.SET_AD_DIV_CANDIDATES, function(e, adDivCandidates, placeholderUrl) {
  var fallbackNodeDataForCommon = {};
  adDivCandidates.forEach(function(iframeData) {
    var replaceId = iframeData.replapceId || iframeData.rid;
    var selector = '[id="' + replaceId + '"]';
    var node = document.querySelector(selector);
    if (!node) {
      return;
    }
    if (replaceId.startsWith("google_ads_iframe_") || replaceId.endsWith("__container__")) {
      fallbackNodeDataForCommon[node.id] = iframeData;
      return;
    }
    processAdNode(document.querySelector(selector), iframeData, placeholderUrl);
  });
  var commonSelectors = [
    '[id^="google_ads_iframe_"][id$="__container__"]',
    '[id^="ad-slot-banner-"]',
    "[data-ad-slot]"
  ];
  commonSelectors.forEach((commonSelector) => {
    var nodes = document.querySelectorAll(commonSelector);
    if (!nodes) {
      return;
    }
    Array.from(nodes).forEach((node) => {
      processAdNode(node, fallbackNodeDataForCommon[node.id], placeholderUrl);
    });
  });
});
document.addEventListener("contextmenu", (e) => {
  var name = e.target.nodeName.toUpperCase();
  var nodeProps = {
    name,
    src: name === "A" ? e.target.href : e.target.src
  };
  console.log("sending", nodeProps);
  ipc.send(messages.CONTEXT_MENU_OPENED, nodeProps);
  e.preventDefault();
}, false);
document.onkeydown = (e) => {
  switch (e.keyCode) {
    case KeyCodes.ESC:
      e.preventDefault();
      ipc.send(messages.STOP_LOAD);
      break;
  }
};
document.addEventListener("DOMContentLoaded", () => {
  Array.from(document.querySelectorAll("img")).forEach(function(img) {
    img.addEventListener("error", function() {
      this.style.visibility = "hidden";
    });
  });
  if (typeof process !== "undefined" && process.env && process.env.BRAVE_DEBUG) {
    console.log(`webviewPreload active: ${document.querySelectorAll("*").length} nodes reachable, title "${document.title}"`);
  }
});
//# sourceMappingURL=webviewPreload.js.map
