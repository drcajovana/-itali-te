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
        background_color: "#faf7f2",
        theme_color: "#7c2d12",
        icons: [],
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
