import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxy = process.env.VITE_API_PROXY || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  base: "./",
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
});

