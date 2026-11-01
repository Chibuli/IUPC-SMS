import { defineConfig, loadEnv } from 'vite'
import { validateProductionConfig } from './src/lib/production-config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') validateProductionConfig(loadEnv(mode, '.', 'VITE_'))
  return {
  plugins: [
    react(),
    tailwindcss(),
    /**
     * The app is installed on the device rather than opened in a browser tab:
     * a teacher keys marks in rooms with no signal, so the shell has to open
     * offline, and that is what the precache below buys. The Google Fonts the
     * interface is set in are cached too, or the shell would come back offline
     * in fallback type.
     */
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'iupc-crest.png', 'iupc-wordmark.png'],
      manifest: {
        name: 'IUPC Academy — School Management',
        short_name: 'IUPC Academy',
        description: 'Academic records, timetable and assessment for IUPC Academy.',
        start_url: '/dashboard',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f9fafb',
        theme_color: '#ffffff',
        categories: ['education', 'productivity'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  }
})
