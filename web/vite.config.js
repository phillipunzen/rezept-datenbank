import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Rezeptbuch',
        short_name: 'Rezeptbuch',
        description: 'Rezepte sammeln, planen, einkaufen und kochen – allein oder gemeinsam.',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#faf7f2',
        theme_color: '#c2410c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Einkaufsliste', url: '/shopping' },
          { name: 'Wochenplan', url: '/plan' },
          { name: 'Rezept hinzufügen', url: '/import' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: { cacheName: 'images', expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 120 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5190,
    proxy: { '/api': 'http://localhost:3990', '/uploads': 'http://localhost:3990' },
  },
  build: { chunkSizeWarningLimit: 900 },
});
