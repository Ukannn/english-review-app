import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "English Learning Lab",
        short_name: "English Lab",
        description: "Private English collocation review and learning workspace.",
        theme_color: "#0a0d11",
        background_color: "#0a0d11",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        cleanupOutdatedCaches: true
      }
    })
  ],
  test: {
    environment: "jsdom",
    fileParallelism: false,
    setupFiles: [],
    css: true
  }
});
