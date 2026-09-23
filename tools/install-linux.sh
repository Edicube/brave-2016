#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this file,
# You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Installs the packaged build (npm run package) somewhere the browsing user
# cannot write to.
#
# This is the integrity control that actually works on Linux. Electron only
# verifies ASAR integrity on macOS and Windows, and a check performed from
# inside the app is worthless against someone who can rewrite the app. What
# does work is ownership: root owns the files, the browsing user can only read
# and run them, so nothing running as that user can swap the code out.
#
#   sudo sh tools/install-linux.sh           install to /opt/brave-2016
#   sudo sh install.sh                        the same, from a release archive
#   sh tools/install-linux.sh --verify       check an installed copy
#   PREFIX=/some/where sh tools/install-linux.sh   install elsewhere (tests)

set -eu

PREFIX="${PREFIX:-/opt/brave-2016}"
SELF="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$SELF/Brave 2016" ]; then
  # running as install.sh from inside an extracted release archive
  BUILD="$SELF"
else
  BUILD="$(cd "$SELF/.." && pwd)/dist/Brave 2016-linux-x64"
fi

verify () {
  if [ ! -f "$PREFIX/SHA256SUMS" ]; then
    echo "no install found at $PREFIX" >&2
    exit 1
  fi
  cd "$PREFIX"
  if sha256sum --quiet -c SHA256SUMS; then
    echo "ok: every file in $PREFIX matches its recorded checksum"
  else
    echo "MODIFIED: the files above no longer match what was installed" >&2
    exit 1
  fi
  # checksums only mean something if nobody else could have rewritten them
  owner="$(stat -c %U "$PREFIX" "$PREFIX/SHA256SUMS" | sort -u)"
  if [ "$owner" != "root" ] && [ -z "${ALLOW_NON_ROOT:-}" ]; then
    echo "warning: $PREFIX is owned by $owner, not root, so the checksums could have been rewritten too" >&2
    exit 1
  fi
}

if [ "${1:-}" = "--verify" ]; then
  verify
  exit 0
fi

if [ ! -x "$BUILD/Brave 2016" ]; then
  echo "no packaged build at $BUILD - run: npm run package" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ] && [ -z "${ALLOW_NON_ROOT:-}" ]; then
  echo "run with sudo: installing as your own user defeats the point" >&2
  exit 1
fi

rm -rf "$PREFIX"
mkdir -p "$PREFIX"
cp -a "$BUILD/." "$PREFIX/"

# record what was installed, before anyone else has had a chance to touch it
rm -f "$PREFIX/install.sh"
( cd "$PREFIX" && find . -type f ! -name SHA256SUMS -print0 | sort -z |
    xargs -0 sha256sum > SHA256SUMS )

if [ "$(id -u)" -eq 0 ]; then
  chown -R root:root "$PREFIX"
  chmod -R go-w "$PREFIX"
  # Chromium's setuid sandbox helper, if present, has to be root-owned 4755
  if [ -f "$PREFIX/chrome-sandbox" ]; then
    chmod 4755 "$PREFIX/chrome-sandbox"
  fi

  cat > /usr/local/bin/brave-2016 <<LAUNCH
#!/bin/sh
exec "$PREFIX/Brave 2016" "\$@"
LAUNCH
  chmod 755 /usr/local/bin/brave-2016

  cat > /usr/share/applications/brave-2016.desktop <<DESKTOP
[Desktop Entry]
Name=Brave 2016
Comment=Brave 0.7.7 revived on a current Electron
Exec=/usr/local/bin/brave-2016 %U
Terminal=false
Type=Application
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
DESKTOP
fi

echo "installed to $PREFIX"
echo "check it any time with: sh tools/install-linux.sh --verify"
