import { defineConfig } from 'tsup';

// The desktop shell is main + preload only; the window renders the deployed
// postshow web app (or a dev server via POSTSHOW_WEB_URL). Workspace deps are
// bundled; electron stays external (provided by the runtime).
export default defineConfig([
  {
    entry: {
      'main/index': 'src/main/index.ts',
      'main/keyring-selftest': 'src/main/keyring-selftest.ts',
    },
    outDir: 'out',
    format: ['esm'],
    target: 'node22',
    clean: true,
    // readline/promises: the bundled CLI chunk imports it without the node:
    // prefix, which esbuild does not recognize as a builtin.
    // Keep native and CommonJS runtime dependencies external so Electron loads
    // their published Node-compatible forms. Bundling undici into this ESM
    // chunk turns its CommonJS dynamic requires into runtime failures.
    external: ['electron', 'electron-updater', 'readline/promises', '@napi-rs/keyring', 'undici'],
    noExternal: [/@eventools\//, /^postshow/],
  },
  {
    entry: { 'preload/index': 'src/preload/index.ts' },
    outDir: 'out',
    format: ['cjs'],
    target: 'node22',
    external: ['electron'],
  },
]);
