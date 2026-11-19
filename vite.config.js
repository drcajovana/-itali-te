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
      // „prompt": nova verzija čeka dok korisnik ne dodirne dugme na traci (src/lib/pwa.js), umesto da se
      // tiho primeni ili da zastareli keš ostane neprimetan.
      registerType: "prompt",
      manifest: {
        name: tekst.aplikacija.naziv,
        short_name: tekst.aplikacija.naziv,
        description: tekst.aplikacija.opis,
        lang: tekst.aplikacija.jezik,
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f4efe5",
        theme_color: "#f4efe5", // boja zaglavlja aplikacije (pozadina), da traka statusa ne seče ekran
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Plan, tačka 4: Service Worker NIKAD ne presreće POST zahteve.
        // Ljuska (html, js, css, slike, fontovi) se čuva pri instalaciji, pa se aplikacija pokreće bez mreže; ekrani
        // koji traže podatke tada pokazuju poruku o vezi (TrakeLjuske i greške ekrana). Nikakvog runtimeCaching-a
        // nema: Supabase i /api pozivi uvek idu na mrežu, a POST ne hvata nijedna ruta.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
