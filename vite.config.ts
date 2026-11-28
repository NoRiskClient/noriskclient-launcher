import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'),
) as { dependencies: Record<string, string> };
const skinRendererVersion = pkg.dependencies['@noriskclient/nrc-skin-renderer'];

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async ({ command }) => ({
  plugins: [react()],

  define: {
    __SKIN_RENDERER_VERSION__: JSON.stringify(skinRendererVersion),
  },

  resolve: {
    dedupe: ["three", "react", "react-dom", "@react-three/fiber", "@react-three/drei"],
    alias: [
      {
        find: /^@iconify\/react$/,
        replacement: resolve(import.meta.dirname, "src/lib/iconify.tsx"),
      },
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // macOS 11 ships the WebKit of Safari 14.
    target: ["chrome105", "safari14"],
    rolldownOptions: {
      treeshake: command === "build" ? { manualPureFunctions: ["console.log", "console.debug"] } : undefined,
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        updater: resolve(import.meta.dirname, 'updater.html'),
        minecraftLogWindow: resolve(import.meta.dirname, 'minecraft-log-window.html'),
        singleLogWindow: resolve(import.meta.dirname, 'single-log-window.html'),
        clipOverlay: resolve(import.meta.dirname, 'clip-overlay.html'),
        clipEditorWindow: resolve(import.meta.dirname, 'clip-editor-window.html')
      }
    }
  }
}));
