/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Flips Electron's build-time fuses on the installed binary.
//
// Without this, the shipped Electron binary is a general purpose Node
// interpreter that anything on the machine can call:
//
//   ELECTRON_RUN_AS_NODE=1 electron -e "require('fs')..."
//
// That is a privilege and allowlist-evasion path that has nothing to do with
// the browser's own code, so it is closed at the binary level.
//
// npm install rewrites the binary, so this has to run after it - see the
// `harden` script in package.json.

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const path = require('path')
const fs = require('fs')

const binary = process.argv.find((arg, i) =>
  i > 1 && arg !== '--verify') ||
  path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron')

const fuses = {
  // no using this binary as a node interpreter
  [FuseV1Options.RunAsNode]: false,
  // no injecting node flags through the environment
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // no attaching a node debugger to the main process
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // cookies on disk are encrypted with the OS keyring
  [FuseV1Options.EnableCookieEncryption]: true,
  // file:// pages get no privileges beyond an ordinary origin
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
}

// The fuse wire stores each fuse as the ASCII byte '0' or '1'; the reader hands
// those back as their character codes. Normalise to booleans.
const toBool = (value) => value === 49 || value === '1' || value === true

// Every entry in `fuses` must read back exactly as set, or the binary is
// treated as unhardened. Used by --verify and by `npm run doctor`.
async function verify () {
  const { getCurrentFuseWire } = require('@electron/fuses')
  const wire = await getCurrentFuseWire(binary)
  let ok = true
  for (const key of Object.keys(fuses)) {
    const name = Object.keys(FuseV1Options).find(k => String(FuseV1Options[k]) === key)
    if (toBool(wire[key]) !== toBool(fuses[key])) {
      console.error(`  MISMATCH ${name}: expected ${fuses[key]}, got ${wire[key]}`)
      ok = false
    } else {
      console.log(`  ok ${name}: ${toBool(wire[key])}`)
    }
  }
  if (!ok) {
    console.error('fuses NOT hardened on', binary)
    process.exit(1)
  }
  console.log('fuses verified on', binary)
}

async function main () {
  // The electron package's own install step does not reliably precede ours
  // under every npm version, so make sure the binary exists before flipping.
  if (!fs.existsSync(binary)) {
    const installer = path.join(__dirname, '..', 'node_modules', 'electron', 'install.js')
    if (fs.existsSync(installer)) {
      console.log('electron binary missing; downloading it first...')
      require('child_process').execFileSync(
        process.execPath, [installer], { stdio: 'inherit' })
    }
  }

  if (!fs.existsSync(binary)) {
    // runs from postinstall, where electron may not be unpacked yet
    console.log('no electron binary yet; run `npm run harden` once it is installed')
    return
  }

  if (process.argv.includes('--verify')) {
    return verify()
  }

  await flipFuses(binary, Object.assign({ version: FuseVersion.V1, resetAdHocDarwinSignature: process.platform === 'darwin' }, fuses))

  console.log('fuses flipped on', binary)
  Object.keys(fuses).forEach((key) => {
    const name = Object.keys(FuseV1Options).find(k => String(FuseV1Options[k]) === key)
    console.log(`  ${name}: ${fuses[key]}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
