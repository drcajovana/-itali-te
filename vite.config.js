import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { tekst } from "./src/lib/tekst.js";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // Naslov stranice dolazi iz src/lib/tekst.js, ne iz index.html.
      name: "tekst-u-html",
      transformIndexHtml: (html) =>
        html.replaceAll("%NAZIV%", tekst.aplikacija.naziv),
    },
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: tekst.aplikacija.naziv,
        short_name: tekst.aplikacija.naziv,
        description: tekst.aplikacija.opis,
        lang: tekst.aplikacija.jezik,
        start_url: "/",
        display: "standalone",
        background_color: "#f4efe5",
        theme_color: "#4d0000",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Plan, tačka 4: Service Worker NIKAD ne presreće POST zahteve.
        // Keširamo samo GET, i to samo statičke fajlove aplikacije.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
});
