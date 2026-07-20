import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const apiProxy = process.env.VITE_API_PROXY || "http://127.0.0.1:8000";
/** Low-RAM Docker/VPS builds: avoid hang after "transforming…". */
const dockerBuild = process.env.VITE_DOCKER_BUILD === "1";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "PokerStraton",
        short_name: "PokerStraton",
        description: "Стратегии, анализ сессий и тренажёр префлопа",
        theme_color: "#0c1210",
        background_color: "#0c1210",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        lang: "ru",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // App shell + static assets; API stays network-first.
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,ico,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  // Absolute base so /nickname and other SPA routes load /assets correctly on Render.
  base: "/",
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiProxy,
      "/health": apiProxy,
    },
  },
  build: dockerBuild
    ? {
        minify: false,
        cssMinify: false,
        sourcemap: false,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 5000,
        rollupOptions: {
          maxParallelFileOps: 1,
        },
      }
    : undefined,
});
