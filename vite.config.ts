import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Content scripts can't be ES modules, so the whole extension ships as a single IIFE bundle.
// `public/` (fonts, licences) is copied into `dist/` as-is; load `dist/` as an unpacked extension.
export default defineConfig({
  plugins: [manifest()],
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

/**
 * Writes the extension's manifest into the build with the version from package.json, so a release
 * only has to change the version in one place.
 */
function manifest(): Plugin {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  return {
    name: 'pr-minimap:manifest',
    generateBundle() {
      const { manifest_version, name, ...rest } = read('./src/manifest.json');
      const { version } = read('./package.json');
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify({ manifest_version, name, version, ...rest }, null, 2)}\n`,
      });
    },
  };
}
