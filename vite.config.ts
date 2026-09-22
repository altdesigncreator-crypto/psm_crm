import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

// maplibre-gl doesn't bundle its Web Worker the normal way (new Worker(new
// URL(...))) — it ships prebuilt .mjs files and fetches them at runtime, by
// filename, from wherever its own JS is being served. Excluding it from
// pre-bundling (below) fixes dev, where Vite then serves it straight out of
// node_modules alongside these files. A production build has no such
// fallback — Rollup bundles everything into dist/assets/index-*.js and
// never emits these as standalone files, so the runtime's requests for them
// 404 and parcels/other GeoJSON data silently never load (the raster
// basemap still renders fine, since it doesn't need the worker — same fix
// already proven in the psm-map project this embeds).
//
// Two files are needed: maplibre-gl-worker.mjs is the worker entry, but it
// itself imports "./maplibre-gl-shared.mjs" — the actual tile-parsing code
// the worker runs. Copied fresh from node_modules on every build (not
// committed) so this can't drift from whatever version is installed.
const MAPLIBRE_RUNTIME_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

function copyMapLibreWorker(): Plugin {
  return {
    name: "copy-maplibre-gl-worker",
    apply: "build",
    closeBundle() {
      const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist", "assets");
      mkdirSync(outDir, { recursive: true });
      for (const file of MAPLIBRE_RUNTIME_FILES) {
        const src = fileURLToPath(new URL(`./node_modules/maplibre-gl/dist/${file}`, import.meta.url));
        if (!existsSync(src)) {
          this.warn(`${file} not found in node_modules — is maplibre-gl installed?`);
          continue;
        }
        copyFileSync(src, path.join(outDir, file));
      }
    },
  };
}

// public/sw.js's CACHE_VERSION used to be a hand-edited literal ('v106') —
// easy to forget bumping on a deploy that only touches app code, and the
// consequence wasn't a build warning, it was silent: the browser compares
// the service worker script byte-for-byte, so an unbumped sw.js looks
// identical to the one already installed, `updatefound` never fires, and
// UpdatePrompt (src/components/UpdatePrompt.tsx) never has anything to show
// — users keep running the old bundle indefinitely with no prompt to
// refresh. Stamping a fresh value into dist/sw.js on every production build
// guarantees the script's bytes differ from whatever's currently installed,
// so the update-available flow fires on every single deploy, not just the
// ones where someone remembered the manual step.
function stampServiceWorkerVersion(): Plugin {
  return {
    name: "stamp-service-worker-version",
    apply: "build",
    closeBundle() {
      const swPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist", "sw.js");
      if (!existsSync(swPath)) {
        this.warn("dist/sw.js not found — did public/sw.js get removed?");
        return;
      }
      const buildId = Date.now().toString(36);
      const source = readFileSync(swPath, "utf8");
      const stamped = source.replace(
        /const CACHE_VERSION = '[^']*';/,
        `const CACHE_VERSION = '${buildId}';`
      );
      if (stamped === source) {
        this.warn("Could not find CACHE_VERSION in dist/sw.js to stamp — pattern may have changed.");
      }
      writeFileSync(swPath, stamped);
    },
  };
}

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
    copyMapLibreWorker(),
    stampServiceWorkerVersion(),
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
    // See copyMapLibreWorker() above for the full story — this half fixes
    // the same underlying issue for the dev server specifically.
    exclude: ["maplibre-gl"],
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
