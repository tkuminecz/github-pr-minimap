import { defineConfig } from 'vitest/config';

// Content scripts can't be ES modules, so the whole extension ships as a single IIFE bundle.
// `public/` (the manifest) is copied into `dist/` as-is; load `dist/` as an unpacked extension.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: 'src/content.ts',
      formats: ['iife'],
      name: 'PrMinimap',
      fileName: () => 'content.js',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
