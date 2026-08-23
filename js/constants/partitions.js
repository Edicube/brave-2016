/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Web content lives in its own sessions, separate from the one the Brave UI
// itself loads from. That keeps site cookies away from the app's session, and
// lets the file: scheme be refused for web content without also breaking the
// UI, which is loaded from disk.
//
// The private partition deliberately has no 'persist:' prefix, which is what
// makes it in-memory only.

module.exports = {
  // normal browsing, cookies kept between runs
  web: 'persist:web',
  // private tabs, discarded when the app exits
  private: 'private-1'
}
