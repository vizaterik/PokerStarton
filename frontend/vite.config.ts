import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxy = process.env.VITE_API_PROXY || "http://127.0.0.1:8000";
/** Low-RAM Docker/VPS builds: avoid hang after "transforming…". */
const dockerBuild = process.env.VITE_DOCKER_BUILD === "1";

export default defineConfig({
  plugins: [react()],
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
