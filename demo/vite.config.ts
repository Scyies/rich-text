import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const demoDir = dirname(fileURLToPath(import.meta.url));

// Demo-only config (lives inside demo/ so Vitest at the repo root is unaffected).
// The workspace link resolves through the freshly built package exports.
export default defineConfig({
  root: demoDir,
  build: {
    // Lightning CSS currently warns on the standards-based ::highlight()
    // selector used for cross-block selections. Esbuild preserves it cleanly.
    cssMinify: "esbuild",
  },
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  plugins: [react()],
});
