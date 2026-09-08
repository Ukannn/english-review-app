import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo-128.png", "favicon-32.png", "icon-192.png", "icon-512.png", "apple-touch-icon.png"],
      manifest: {
        name: "English Learning Lab",
        short_name: "English Lab",
        description: "Private English collocation review and learning workspace.",
        theme_color: "#f5f0e8",
        background_color: "#f5f0e8",
        display: "standalone",
        start_url: "/",
        lang: "zh-CN",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
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
