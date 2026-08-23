# Brave 2016

A desktop browser built on the 2016 Brave codebase (MPL-2.0), updated to run
on Electron 43. Original UI, modern security posture.

## Running it

You need Node.js (LTS) and npm.

```bash
git clone https://github.com/Edicube/brave-2016.git
cd brave-2016
npm ci
npm start
```

`npm ci` handles everything: installs dependencies from the lockfile, downloads
the Electron binary if it's missing, and hardens that binary with Electron
fuses automatically (fail-closed verification).

## Scripts

| Command | What it does |
|---|---|
| `npm start` | build and launch the browser |
| `npm test` | unit tests |
| `npm run lint` | style checks |
| `npm run harden` | flip Electron fuses on the binary |
| `npm run verify-fuses` | check the fuses (runs automatically after install) |
| `npm run package` | produce a packaged binary |

## Security notes

- The UI is served over `brave://ui`, never `file://`; the `file:` scheme is
  refused at the session level.
- Every IPC handler validates its sender and arguments.
- Fuses: `RUN_AS_NODE`, `NODE_OPTIONS` and the node inspector are off; cookie
  encryption is on. Verified on every install.
- TLS errors are always refused; there is no bypass and no client certs.
- DevTools are closed unless you set `BRAVE_DEBUG=1`.

To ship a signed release, fill in the `_signing_intent` fields in
`builderConfig.json` with your certificate details.

## License

The original 2016 code is MPL-2.0. See `LICENSE.txt`.
