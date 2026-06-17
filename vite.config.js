import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server forwards /api to the Express backend (server.js) so the
// AI proxy and project persistence work with hot reload. In production
// the same Express server serves the built UI and the API on one origin.
export default defineConfig({
  // "/" for the standalone Express build; GitHub Pages sets VITE_BASE="/Ember/"
  // (project sites are served from https://<user>.github.io/<repo>/).
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
