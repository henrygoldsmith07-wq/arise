import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Injected for export metadata (exportPolicy.js getAppVersion).
  define: { __ARISE_APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  build: {
    // Arise already depends on modern browser primitives (IndexedDB/PWA APIs).
    // Pinning the syntax output to ES2020 avoids Vite's more conservative
    // browser-specific down-transforms without narrowing the app to a bleeding-
    // edge target. Keep bundle budgets fixed; new runtime code must fit them.
    target: 'es2020',
    rollupOptions: {
      output: {
        // data.js is shared by most feature routes. Without an explicit chunk
        // Rollup hoists it into index.js, making a rarely edited 200 kB source
        // catalogue part of first paint. Keep it as a shared dependency while
        // preserving React's existing vendor grouping/compression behavior.
        manualChunks: {
          vendor: ['react', 'react-dom'],
          catalogue: ['./src/lib/data.js'],
        },
      },
    },
  },
});
