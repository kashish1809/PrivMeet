import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
  // Production assets are served by Django/whitenoise under /static/, so the build
  // needs that base. The dev server stays at / so `npm run dev` -> http://localhost:5173.
  base: command === "build" ? "/static/" : "/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // The dev server has no /api of its own: forward it to Django on 8000.
    proxy: { "/api": "http://localhost:8000" },
  },
}));
