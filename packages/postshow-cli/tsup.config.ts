import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/lib.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: true,
  // The bin must be directly executable; @eventools/* workspace deps are bundled.
  banner: { js: '#!/usr/bin/env node' },
  noExternal: [/@eventools\//],
});
