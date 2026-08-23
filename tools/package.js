/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Builds a packaged app with the application code inside an ASAR archive, then
// flips the fuses that only make sense once it is packaged.
//
// What this does and does not buy, honestly:
//
// - OnlyLoadAppFromAsar makes Electron refuse to load a loose `resources/app`
//   directory. Enforced on every platform. It stops the simplest tampering,
//   dropping a modified .js file next to the app.
// - EnableEmbeddedAsarIntegrityValidation makes Electron verify the archive
//   against a hash embedded in the binary. Electron only has a verifier for
//   this on macOS and Windows; on Linux the fuse is set but nothing checks it.
// - Neither helps if an attacker can write to the install directory as the
//   user who runs the browser. On Linux the control that actually matters is
//   installing somewhere the browsing user cannot write, owned by root.
//
// GrantFileProtocolExtraPrivileges can be off because the UI is served over
// brave://ui rather than from file:// - see app/uiProtocol.js.

const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const out = path.join(root, 'dist')

async function main () {
  const { packager } = await import('@electron/packager')
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses')

  // the renderer bundle has to exist before it is sealed into the archive
  if (!fs.existsSync(path.join(root, 'app', 'gen', 'bundle.js'))) {
    console.error('run `npm run build` first')
    process.exit(1)
  }

  const paths = await packager({
    dir: root,
    out,
    name: 'Brave 2016',
    appVersion: require(path.join(root, 'package.json')).version,
    overwrite: true,
    asar: true,
    prune: true,
    icon: path.join(root, 'res', 'app-icon-green.png'),
    ignore: [
      /^\/dist($|\/)/,
      /^\/docs($|\/)/,
      /^\/test($|\/)/,
      /^\/tools($|\/)/,
      /^\/less($|\/)/,
      /^\/\.git($|\/)/,
      /^\/\.vscode($|\/)/,
      /\.map$/,
      /^\/build-.*\.js$/,
      /^\/preload-httpse\.js$/,
      /^\/sign-darwin\.sh$/
    ]
  })

  for (const dir of paths) {
    const binary = path.join(dir, 'Brave')
    if (!fs.existsSync(binary)) {
      console.error(`packaged binary not found at ${binary}`)
      continue
    }

    await flipFuses(binary, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: process.platform === 'darwin',
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      // refuse to run from a loose directory, archive only
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      // verified on macOS and Windows; set here but unchecked on Linux
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: process.platform !== 'linux'
    })

    console.log('packaged and hardened:', dir)
    const asar = path.join(dir, 'resources', 'app.asar')
    if (fs.existsSync(asar)) {
      console.log('  app.asar:', Math.round(fs.statSync(asar).size / 1024), 'KB')
    }
    console.log('  run it with:', binary)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
