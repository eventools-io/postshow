import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Base Vite configuration for all eventools.io apps
 * Override in individual apps as needed
 */
export default defineConfig({
  plugins: [
    react({
      // Use SWC for faster builds in development
      jsxRuntime: 'automatic',
      babel: {
        plugins: [
          // Optional: Add any common Babel plugins here
        ],
      },
    }),
  ],

  // Development server configuration
  server: {
    port: 3000,
    strictPort: false,
    host: true,
    open: false,
    cors: true,
  },

  // Build optimizations
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',

    // Chunk splitting strategy for optimal caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks for better caching
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'ui-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
          ],
        },
      },
    },

    // CSS code splitting
    cssCodeSplit: true,

    // Increase chunk size warning limit (500kb)
    chunkSizeWarningLimit: 500,

    // Report compressed size for build analysis
    reportCompressedSize: true,
  },

  // Dependency optimization
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@supabase/supabase-js',
    ],
    exclude: ['@eventools/ui', '@eventools/utils', '@eventools/types'],
  },

  // Path resolution
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@eventools/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@eventools/utils': path.resolve(__dirname, '../../packages/utils/src'),
      '@eventools/types': path.resolve(__dirname, '../../packages/types/src'),
    },
  },

  // Environment variable prefix
  envPrefix: ['VITE_', 'PUBLIC_'],

  // Ensure compatibility with older browsers
  esbuild: {
    target: 'es2022',
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
  },
});
