import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  esbuild: { legalComments: 'none' },
  // Injected for export metadata (exportPolicy.js getAppVersion).
  define: { __ARISE_APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  build: {
    // Arise already depends on modern browser primitives (IndexedDB/PWA APIs).
    // Pinning the syntax output to ES2020 avoids Vite's more conservative
    // browser-specific down-transforms without narrowing the app to a bleeding-
    // edge target. Keep bundle budgets fixed; new runtime code must fit them.
    target: 'es2020',
    minify: 'terser',
    terserOptions: { format: { comments: false }, compress: { passes: 1 } },
    rollupOptions: {
      output: {
        // data.js is shared by most feature routes. Without an explicit chunk
        // Rollup hoists it into index.js, making a rarely edited 200 kB source
        // catalogue part of first paint. Keep it as a shared dependency while
        // preserving React's existing vendor grouping/compression behavior.
        //
        // `engine` groups the evidence/progression modules that only lazy
        // routes and post-boot services reach (since integrity.js stopped
        // importing export.js). One shared chunk compresses better than five
        // small ones, each repeating its own import/export headers.
        manualChunks(id){
          if(/node_modules\/(react|react-dom)\//.test(id)) return 'vendor';
          if(id.endsWith('/src/lib/data.js')) return 'catalogue';
          // Tiny dependency-free helpers shared only by lazy routes that
          // already load the catalogue. As their own chunks each paid gzip
          // + import/export overhead; folding them into the catalogue saves
          // ~0.9 kB total gz JS. Boot is unchanged and every importer already
          // imports the catalogue (routes that load it early, e.g. Today, pick
          // up ~1.5 kB gz of helpers they did not need before).
          if(/\/src\/lib\/(units\.ts|experienceMode\.js|voiceCoach\.js|trainSurface\.js)$/.test(id)) return 'catalogue';
          if(/\/src\/lib\/(longitudinal|longitudinalCore|evaluation|trainingExperiments|export|exportPolicy)\.js$/.test(id)) return 'evidence';
          if(/\/src\/lib\/(progression|progressionModel|substitutions)\.js$/.test(id)) return 'engine';
          if(/\/src\/lib\/(priors|study)\.js$/.test(id)) return 'evidence-core';
          return undefined;
        },
      },
    },
  },
});
