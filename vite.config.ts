import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import { MEDIA_RUNTIME_CACHING } from './pwa/mediaCaching.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function copyDirectory(sourceDir: string, destinationDir: string): void {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    } else {
      throw new Error(`Unsupported asset entry: ${sourcePath}`);
    }
  }
}

export default defineConfig(({command}) => {
  const isDevServe = command === 'serve';

  const runtimeCaching: any[] = [
    // Never cache admin pages, admin chunks, admin APIs, or live health probes
    {
      urlPattern: /\/(admin|api\/admin)(\/|$)/i,
      handler: 'NetworkOnly',
    },
    {
      urlPattern: /AdminDashboard/i,
      handler: 'NetworkOnly',
    },
    {
      urlPattern: /\/api\/health$/i,
      handler: 'NetworkOnly',
    },
    // Structured public API data is managed safely in memory/offlineStore (approved/sold only)
    {
      urlPattern: /\/api\//i,
      handler: 'NetworkOnly',
    },
    // Media visibility can change; always ask Express to re-authorize it.
    MEDIA_RUNTIME_CACHING,
    // Bundled/local bike & category images
    {
      urlPattern: /^\/(src\/assets\/images|assets)\//i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'darajati-static-images',
        expiration: {
          maxEntries: 150,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    // Google Fonts for Cairo offline rendering
    {
      urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts-cache',
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 60 * 60 * 24 * 365,
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'gstatic-fonts-cache',
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 60 * 60 * 24 * 365,
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
  ];

  // In dev server mode, cache public storefront shell & non-admin modules so offline reload works
  if (isDevServe) {
    runtimeCaching.push({
      urlPattern: ({url}: {url: URL}) => {
        if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api')) return false;
        if (url.pathname.includes('AdminDashboard')) return false;
        return (
          url.pathname === '/' ||
          url.pathname.startsWith('/src/') ||
          url.pathname.startsWith('/@vite/') ||
          url.pathname.startsWith('/@react-refresh') ||
          url.pathname.startsWith('/node_modules/')
        );
      },
      handler: 'NetworkFirst',
      options: {
        cacheName: 'darajati-dev-shell',
        networkTimeoutSeconds: 3,
        cacheableResponse: {
          statuses: [200],
        },
      },
    });
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'دراجتي — بيع وشراء الدراجات وقطع الغيار في العراق',
          short_name: 'دراجتي',
          description:
            'منصة دراجتي لبيع وشراء الدراجات النارية والسكوترات والدراجات الهوائية والكهربائية وقطع الغيار في العراق.',
          theme_color: '#0D2545',
          background_color: '#F4F6F9',
          display: 'standalone',
          dir: 'rtl',
          lang: 'ar',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: ['**/AdminDashboard*'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/admin/i, /^\/api/i, /^\/uploads/i],
          cleanupOutdatedCaches: true,
          runtimeCaching,
        },
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: '/index.html',
          navigateFallbackAllowlist: [/^\/$/],
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." still resolve in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            copyDirectory(srcAssets, distAssets);
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
