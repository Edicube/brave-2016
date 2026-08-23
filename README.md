# Brave 2016

Un browser desktop bazat pe Electron, construit peste codul Brave 2016 (MPL-2.0), modernizat și întărit pentru Electron 43: UI-ul original, securitate la nivel 2026.

## Rulare

Cerințe: Node.js (LTS) și npm.

```bash
git clone https://github.com/Edicube/brave-2016.git
cd brave-2016
npm ci
npm start
```

`npm ci` face totul singur: instalează dependențele exact din lockfile, descarcă binarul Electron dacă lipsește și aplică automat fuses-urile de securitate pe el (`harden` + `verify-fuses`, fail-closed).

## Scripturi utile

| Comandă | Ce face |
|---|---|
| `npm start` | build + pornește browserul |
| `npm test` | testele unitare |
| `npm run lint` | verificare stil |
| `npm run harden` | aplică fuses-urile pe binarul Electron |
| `npm run verify-fuses` | confirmă fuses-urile (rulează automat după install) |
| `npm run package` | produce binarul packaged |

## Note de securitate

- UI-ul e servit peste `brave://ui`, nu `file://`; scheme-ul `file:` e refuzat la nivel de sesiune.
- Toate handler-ele IPC validează expeditorul și argumentele.
- Fuses: `RUN_AS_NODE`, `NODE_OPTIONS`, node inspector dezactivate; cookie encryption activă. Verificate automat la fiecare instalare.
- Certificate TLS: respingere explicită a oricărei erori; niciun bypass.
- DevTools dezactivate în afara modului debug (`BRAVE_DEBUG=1`).

Pentru un release semnat: umple câmpurile `_signing_intent` din `builderConfig.json` cu datele certificatului tău.

## Licență

Codul original Brave 2016: MPL-2.0. Vezi `LICENSE.txt`.
