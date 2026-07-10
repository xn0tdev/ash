import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from "path";

// https://vitejs.dev/config/
// The frontend is Ash's original (Tauri) React app, byte-for-byte. Instead of
// editing ~30 files to swap `@tauri-apps/*` imports for Wails calls, we alias
// each Tauri module to a shim under src/shim/ that routes to the Go bindings
// / @wailsio/runtime. Net effect: the Tauri frontend runs unchanged on Wails.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "src/shim/core.ts"),
      "@tauri-apps/api/window": path.resolve(__dirname, "src/shim/window.ts"),
      "@tauri-apps/api/event": path.resolve(__dirname, "src/shim/event.ts"),
      "@tauri-apps/api/path": path.resolve(__dirname, "src/shim/path.ts"),
      "@tauri-apps/plugin-opener": path.resolve(__dirname, "src/shim/opener.ts"),
      "@tauri-apps/plugin-dialog": path.resolve(__dirname, "src/shim/dialog.ts"),
      "@tauri-apps/plugin-clipboard-manager": path.resolve(__dirname, "src/shim/clipboard.ts"),
      "@tauri-apps/plugin-notification": path.resolve(__dirname, "src/shim/notification.ts"),
    },
  },
})
