# Avallon Combat Log

Standalone Owlbear Rodeo extension for viewing the shared Avallon System combat log.

Install manifest after GitHub Pages is active:

- `https://limonety995-maker.github.io/odissey-dicelog/manifest.json`

## What it does

- Opens as a separate Owlbear extension
- Reads the room-wide combat log from shared room metadata
- Listens for live broadcast updates from the main Avallon System extension
- Shows the latest attacks, rolls, and debug combat tables in a dedicated viewer

## Shared integration

This extension currently listens to the same shared keys used by the main Avallon System project:

- Metadata key: `com.avallon.system/debugLog`
- Broadcast channel: `com.avallon.system/debug`

That means it can work immediately with the current main extension without changing the combat logic first.

## Local build

```bash
npm install
npm run build
```
