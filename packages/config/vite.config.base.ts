import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export const createViteConfig = (dirname: string) => {
  return defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
      host: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
  });
};
