/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Replaces the original webpack 1 + babel 6 pipeline, which cannot run on
// modern Node. esbuild handles the JSX and ES2015 that babel used to.

const esbuild = require('esbuild')
const less = require('less')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const watch = process.argv.includes('--watch')
// Production unless watching or asked otherwise: React's development build
// runs extra checks on every render, and an unminified bundle is slower to
// parse at every start.
const mode = process.env.NODE_ENV || (watch ? 'development' : 'production')
const production = mode === 'production'

// Compiles the .less files that js/entry.js pulls in. esbuild has no less
// loader, so hand it plain css and let it bundle that.
const lessPlugin = {
  name: 'less',
  setup (build) {
    build.onLoad({ filter: /\.less$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, 'utf8')
      const result = await less.render(source, {
        filename: args.path,
        paths: [path.dirname(args.path)],
        javascriptEnabled: true
      })
      return {
        contents: result.css,
        loader: 'css',
        watchFiles: result.imports
      }
    })
  }
}

const options = {
  entryPoints: [path.join(root, 'js/entry.js')],
  bundle: true,
  outfile: path.join(root, 'app/gen/bundle.js'),
  // The renderer is browser code: node builtins are bundled as polyfills so it
  // needs no node integration at runtime.
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  // JSX lives in plain .js files, the way babel-preset-react allowed
  loader: {
    '.js': 'jsx',
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
    '.eot': 'file',
    '.svg': 'file',
    '.png': 'file'
  },
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  // the only three node builtins this code reaches for
  alias: {
    url: 'url',
    path: 'path-browserify',
    events: 'events'
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.BRAVE_DEBUG': JSON.stringify(process.env.BRAVE_DEBUG || ''),
    // this bundle is only ever the renderer half; the dispatcher branches on it
    'process.type': JSON.stringify('renderer')
  },
  // A sandboxed renderer has no process object, and the url and path polyfills
  // reach for a few of its fields.
  banner: {
    js: 'var process = globalThis.process || ' +
        '{ env: {}, type: "renderer", platform: "browser", ' +
        'cwd: function () { return "/" }, emit: function () {} };'
  },
  plugins: [lessPlugin]
}

// Preloads run sandboxed, where require() only resolves Electron's own
// modules, so their relative requires have to be bundled in.
const preloadOptions = {
  entryPoints: [
    path.join(root, 'app/content/webviewPreload.js'),
    path.join(root, 'app/content/windowPreload.js')
  ],
  bundle: true,
  outdir: path.join(root, 'app/gen'),
  platform: 'node',
  format: 'cjs',
  target: 'chrome120',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  external: ['electron']
}

// Stamped into the build so the running browser can tell the user it has gone
// stale. Deliberately offline: no update endpoint to phone, and none needed to
// know how old this build is.
function writeBuildInfo () {
  const dir = path.join(root, 'app', 'gen')
  fs.mkdirSync(dir, { recursive: true })
  const electronVersion = (() => {
    try {
      return fs.readFileSync(
        path.join(root, 'node_modules', 'electron', 'dist', 'version'), 'utf8').trim()
    } catch (e) {
      return 'unknown'
    }
  })()
  fs.writeFileSync(path.join(dir, 'buildinfo.json'), JSON.stringify({
    builtAt: new Date().toISOString(),
    electron: electronVersion
  }, null, 2) + '\n')
}

async function main () {
  writeBuildInfo()
  if (watch) {
    const contexts = await Promise.all([
      esbuild.context(options),
      esbuild.context(preloadOptions)
    ])
    await Promise.all(contexts.map(ctx => ctx.watch()))
    console.log('watching for changes...')
  } else {
    await Promise.all([
      esbuild.build(options),
      esbuild.build(preloadOptions)
    ])
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
