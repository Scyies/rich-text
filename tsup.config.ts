import { defineConfig } from "tsup";

export default defineConfig({
  // Object form so each entry maps to a flat dist/<key>.{js,cjs,d.ts} — the
  // exporters (D12) are separate entries so heavy deps (docx) load only when
  // the matching subpath is imported.
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
    html: "src/editor/exports/html.ts",
    markdown: "src/editor/exports/markdown.ts",
    docx: "src/editor/exports/docx.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
});
