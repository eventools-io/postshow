import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shouldEmitHiddenSourceMaps = process.env.BUILD_SOURCEMAPS === 'true';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5176,
    strictPort: false,
    host: true,
  },
  build: {
    outDir: 'dist',
    // Public sourcemaps expose bundled TypeScript source and comments. Keep
    // default deploys map-free; opt-in builds emit hidden maps for private upload.
    sourcemap: shouldEmitHiddenSourceMaps ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
});
