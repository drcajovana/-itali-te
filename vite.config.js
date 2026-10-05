import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Читалиште",
        short_name: "Читалиште",
        description:
          "Читалачка платформа Народне библиотеке „Доситеј Новаковић“ у Неготину",
        lang: "sr-Cyrl-RS",
        start_url: "/",
        display: "standalone",
        background_color: "#faf7f2",
        theme_color: "#7c2d12",
        icons: [],
      },
      workbox: {
        // План, тачка 4: Service Worker НИКАД не пресреће POST захтеве.
        // Кеширамо само GET, и то само статичке фајлове апликације.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
});
