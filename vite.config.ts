import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
  base: '/fyzbit/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sw: resolve(__dirname, 'src/sw.ts'),
      },
      output: {
        // Service worker must keep a stable, predictable filename so the
        // registration in main.ts can find it.
        entryFileNames: (chunk) =>
          chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __SW_BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  server: {
    port: 5173,
    strictPort: false,
    open: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Node >=22 ships an experimental global `localStorage` that shadows the
    // one jsdom injects, breaking every test that touches localStorage
    // (throws "Cannot read properties of undefined"). Disable it so jsdom's
    // own implementation wins.
    execArgv: ['--no-experimental-webstorage'],
  },
});
