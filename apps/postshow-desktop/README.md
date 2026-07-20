# Postshow desktop

The menu-bar agent. An Electron shell around the postshow web app that adds what a browser tab cannot: a tray presence, a background scheduler that runs local jobs with catch-up on wake, and the same local runtime the CLI uses.

MIT licensed, like the rest of Postshow's client surfaces.

## How it fits together

- The window renders the deployed web app (`POSTSHOW_WEB_URL`, default `https://postshow.io`), so desktop and web are the same synced workspace.
- The shell shares `~/.postshow/config.json` with the CLI. `npx postshow init` configures both.
- The scheduler ticks every 15 minutes, on launch, and on wake from sleep. Due-ness is a persisted next-due timestamp per job, so a closed laptop just catches up when it opens. Runs execute with your local keys or Ollama and sync derived findings only.
- A small ledger (`~/.postshow/desktop.db`, `node:sqlite` - no native module rebuilds) records what ran on this machine for the tray menu.
- Electron security defaults stay on: `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload exposes two typed calls (`runtimeStatus`, `runNow`).

## Develop

```sh
pnpm --filter @eventools/postshow-desktop dev    # loads http://localhost:5173
pnpm --filter @eventools/postshow-desktop test
```

Electron's binary download is gated by pnpm's build-script policy; run `pnpm approve-builds` once locally before `dev` or `dist`.

## Package (mac)

```sh
pnpm --filter @eventools/postshow-desktop dist
```

Produces a universal dmg + zip in `dist/`. Notarization is off by default; set `notarize: true` in `electron-builder.yml` with `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` in the environment for release builds.
