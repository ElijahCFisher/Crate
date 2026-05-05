import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon.svg'],

      manifest: {
        name: 'Food Ratings',
        short_name: 'Food Ratings',
        description: 'Rate and track your food experiences',
        theme_color: '#1565C0',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Precache all built JS/CSS/HTML/SVG assets
        globPatterns: ['**/*.{js,css,html,svg}'],

        // Return cached index.html for any navigation (app-shell pattern)
        navigateFallback: 'index.html',

        // Don't try to cache auth/API calls — always hit the network
        navigateFallbackDenylist: [
          /^\/oauth\//,
          /^\/api\//,
          /^\/logout/,
        ],

        runtimeCaching: [
          // Roboto font stylesheet — stale-while-revalidate (fast + fresh)
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          // Roboto font files — cache-first for 1 year (immutable)
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 31_536_000 },
            },
          },
          // Google Drive / OAuth / GIS — always network, never cache
          {
            urlPattern: /^https:\/\/.*\.googleapis\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/accounts\.google\.com\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],

  server: {
    port: 3000,
  },
});
