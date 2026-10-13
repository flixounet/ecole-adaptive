import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { normalizeBasePath } from './build/base';
import { publishedContentPlugin } from './build/publishedContent';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const appVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, 'VITE_BASE_PATH');
  const base = normalizeBasePath(process.env.VITE_BASE_PATH ?? env.VITE_BASE_PATH);
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    base,
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion) },
    plugins: [
      react(),
      publishedContentPlugin(fileURLToPath(new URL('../../content', import.meta.url)), base),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: null,
        registerType: 'prompt',
        scope: base,
        base,
        manifest: {
          id: base,
          name: 'École Adaptive',
          short_name: 'École',
          description: 'Lernen, Klassenarbeiten und Lernstand auf diesem Gerät.',
          lang: 'de',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#f7f5ed',
          theme_color: '#28594c',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        includeAssets: ['favicon.svg', 'icons/*.png'],
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
          globIgnores: ['content/**'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: { alias: { '@shared': fileURLToPath(new URL('../../shared', import.meta.url)) } },
    build: {
      target: 'safari15',
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('/node_modules/')) return;
            if (id.includes('/dexie')) return 'storage';
            if (
              id.includes('/ajv') ||
              id.includes('/fast-uri') ||
              id.includes('/fast-deep-equal') ||
              id.includes('/json-schema-traverse') ||
              id.includes('/require-from-string')
            )
              return 'validation';
            return 'vendor';
          },
        },
      },
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
