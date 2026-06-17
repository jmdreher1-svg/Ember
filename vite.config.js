import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server forwards /api to the Express backend (server.js) so the
// AI proxy and project persistence work with hot reload. In production
// the same Express server serves the built UI and the API on one origin.
export default defineConfig({
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
