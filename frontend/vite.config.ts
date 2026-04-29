import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: "0.0.0.0",
    open: true,
    proxy: {
      // HTTP API proxy
      "/api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
        secure: false
      },
      // WebSocket proxy with explicit upgrade handling
      "/ws": {
        target: "ws://127.0.0.1:8001",
        ws: true,  // Enable WebSocket proxying
        changeOrigin: true,
        secure: false,
        rewriteWsOrigin: true  // Rewrite WebSocket origin header
      }
    }
  }
});
