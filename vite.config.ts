import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// The original "./" manifest ID resolves against the origin, including on Pages.
// Desktop Chromium requires that same ID as an absolute URL for the lookup.
const manifestId = "./";
const relatedId = process.env.PWA_ORIGIN
  ? new URL(manifestId, new URL(process.env.PWA_ORIGIN).origin).href
  : undefined;

export default defineConfig({
  base: process.env.BASE_PATH || "./",
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icons/*.png"],
      manifest: {
        id: manifestId,
        name: "Box Game — Dots and Boxes",
        short_name: "Box Game",
        description: "Connect the dots and capture the most boxes.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        related_applications: [
          { platform: "webapp", url: "./manifest.webmanifest", id: relatedId },
        ],
        orientation: "any",
        theme_color: "#11131e",
        background_color: "#11131e",
        icons: [
          { src: "icons/board-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/board-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/board-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,wav}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: "es2022",
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
});
