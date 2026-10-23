/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Starts Brave 2016 from a source checkout with a double click, the way
 * Firefox's own `firefox` binary starts `firefox-bin`: it finds the folder it
 * sits in and runs that checkout's Electron on it. No terminal, no npm, no
 * PATH needed - which is why a .desktop file running `npm start` fails when
 * node lives somewhere only the shell knows about.
 *
 *   npm run launcher      builds ./brave-2016 next to package.json
 *
 * The UI bundle in app/gen comes with the checkout (and `npm run update`
 * rebuilds it), so nothing is built here; this only starts the browser.
 */

#include <errno.h>
#include <libgen.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main (int argc, char **argv) {
  char self[PATH_MAX];
  ssize_t len = readlink("/proc/self/exe", self, sizeof(self) - 1);
  if (len < 0) {
    fprintf(stderr, "brave-2016: cannot find where I am: %s\n", strerror(errno));
    return 1;
  }
  self[len] = '\0';
  char *dir = dirname(self);

  char electron[PATH_MAX];
  if (snprintf(electron, sizeof(electron), "%s/node_modules/electron/dist/electron", dir) >= (int)sizeof(electron)) {
    fprintf(stderr, "brave-2016: path too long\n");
    return 1;
  }
  if (access(electron, X_OK) != 0) {
    fprintf(stderr, "brave-2016: %s is missing - run `npm ci` in %s first\n", electron, dir);
    return 1;
  }
  if (chdir(dir) != 0) {
    fprintf(stderr, "brave-2016: cannot enter %s: %s\n", dir, strerror(errno));
    return 1;
  }

  /* electron <checkout> [whatever this was given, e.g. a URL] */
  char **args = calloc((size_t)argc + 2, sizeof(char *));
  if (!args) {
    return 1;
  }
  args[0] = electron;
  args[1] = dir;
  for (int i = 1; i < argc; i++) {
    args[i + 1] = argv[i];
  }
  execv(electron, args);
  fprintf(stderr, "brave-2016: could not start %s: %s\n", electron, strerror(errno));
  return 1;
}
