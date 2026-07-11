import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react": path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "react-router-dom": path.resolve(__dirname, "./node_modules/react-router-dom"),
    },
    dedupe: ["react", "react-dom", "react-router-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "@radix-ui/react-slider", "xlsx", "jspdf", "jspdf-autotable"],
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: framework code changes rarely, so returning
        // visitors keep it cached while app-code chunks update.
        // (rolldown-vite only accepts the function form.)
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (id.includes("@supabase")) return "vendor-supabase";
          return undefined;
        },
      },
    },
  },
});
