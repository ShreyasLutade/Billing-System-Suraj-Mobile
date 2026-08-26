import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Lazy import("barcode-detector/pure") needs a fresh prebundle after install.
    include: ["barcode-detector", "barcode-detector/pure"],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
