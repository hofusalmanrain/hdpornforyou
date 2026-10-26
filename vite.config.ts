import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const API_TARGET = process.env.VITE_API_TARGET || "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: {
      // EPORNER API proxy (avoids CORS)
      "/api/eporner": {
        target: "https://www.eporner.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/eporner/, "/api/v2"),
        timeout: 30000,
      },
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
      },
      "/ads.txt": { target: API_TARGET, changeOrigin: true, secure: false },
      "/robots.txt": { target: API_TARGET, changeOrigin: true, secure: false },
      "/sitemap.xml": { target: API_TARGET, changeOrigin: true, secure: false },
      "/sitemap-static.xml": { target: API_TARGET, changeOrigin: true, secure: false },
      "/sitemap-videos": { target: API_TARGET, changeOrigin: true, secure: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("d3-")) return "charts-vendor";
          if (
            id.includes("@radix-ui") ||
            id.includes("lucide-react") ||
            id.includes("sonner") ||
            id.includes("vaul") ||
            id.includes("cmdk") ||
            id.includes("embla-carousel") ||
            id.includes("react-day-picker") ||
            id.includes("react-hook-form") ||
            id.includes("@hookform") ||
            id.includes("zod")
          ) {
            return "ui-vendor";
          }
          if (id.includes("react") || id.includes("@tanstack") || id.includes("scheduler")) {
            return "react-vendor";
          }
          return "vendor";
        },
      },
    },
  },
});
