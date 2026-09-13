import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://middleware:3000",
      "/admin": "http://middleware:3000",
      "/health": "http://middleware:3000",
    },
  },
});
