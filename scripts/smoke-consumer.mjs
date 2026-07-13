import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const consumer = await mkdtemp(join(tmpdir(), "wealthy-text-consumer-"));
const corepackPnpm = join(dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js");
const runPnpm = (args, options = {}) => existsSync(corepackPnpm)
  ? execFileSync(process.execPath, [corepackPnpm, ...args], options)
  : execFileSync("pnpm", args, { ...options, shell: process.platform === "win32" });

try {
  const packOutput = runPnpm(["pack", "--pack-destination", consumer, "--silent"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const tarball = packOutput.split(/\r?\n/).at(-1);
  if (!tarball) throw new Error("pnpm pack did not return a tarball path");
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "wealthy-text-editor": `file:${resolve(root, tarball)}`,
      react: "19.2.7",
      "react-dom": "19.2.7",
      "@types/react": "19.2.17",
      "@types/react-dom": "19.2.3",
      docx: "9.7.1",
      zod: "4.1.0"
    }
  }, null, 2));
  runPnpm(["install", "--ignore-workspace", "--prefer-offline"], { cwd: consumer, stdio: "pipe" });

  await writeFile(join(consumer, "esm.mjs"), `
    import { createEmptyDocument } from "wealthy-text-editor";
    import { separatorPlugin } from "wealthy-text-editor/react";
    import { exportHtml } from "wealthy-text-editor/export-html";
    const doc = createEmptyDocument();
    if (doc.blocks.length !== 1 || typeof exportHtml(doc) !== "string" || separatorPlugin.name !== "wte-separator") process.exit(1);
  `);
  await writeFile(join(consumer, "cjs.cjs"), `
    const core = require("wealthy-text-editor");
    const react = require("wealthy-text-editor/react");
    if (core.createEmptyDocument().blocks.length !== 1 || typeof react.DocumentEditor !== "function") process.exit(1);
  `);
  await writeFile(join(consumer, "minuta-consumer.tsx"), `
    import type { WealthyDocument } from "wealthy-text-editor";
    import { defineBlockType, type DocumentEditorApi, type EditorPlugin } from "wealthy-text-editor/react";
    type LegalBlockMeta = Record<string, unknown> & { role?: "facts" | "requests"; provenance?: "human" | "agent" };
    type LegalDocumentMeta = Record<string, unknown> & { caseId: string; jurisdiction: string };
    declare const document: WealthyDocument<LegalBlockMeta, LegalDocumentMeta>;
    declare const editor: DocumentEditorApi<LegalBlockMeta, LegalDocumentMeta>;
    const signature = defineBlockType({ kind: "signature", decode: (data) => ({ signer: String(data.signer ?? "") }), render: ({ block }) => block.data.signer });
    const plugin: EditorPlugin<LegalBlockMeta> = { name: "minuta", blockTypes: [signature] };
    document.meta!.caseId satisfies string;
    editor.document.meta!.jurisdiction satisfies string;
    plugin.name satisfies string;
  `);
  await writeFile(join(consumer, "require-consumer.cts"), `
    import { createEmptyDocument } from "wealthy-text-editor";
    import { DocumentEditor } from "wealthy-text-editor/react";
    createEmptyDocument().blocks.length satisfies number;
    DocumentEditor satisfies Function;
  `);
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    jsx: "react-jsx", noEmit: true, skipLibCheck: false
  }, include: ["minuta-consumer.tsx", "require-consumer.cts"] }, null, 2));

  execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(consumer, "tsconfig.json")], { stdio: "inherit" });
  execFileSync(process.execPath, [join(consumer, "esm.mjs")], { stdio: "pipe" });
  execFileSync(process.execPath, [join(consumer, "cjs.cjs")], { stdio: "pipe" });
  const packedPackage = JSON.parse(await readFile(join(consumer, "node_modules", "wealthy-text-editor", "package.json"), "utf8"));
  if (packedPackage.name !== "wealthy-text-editor") throw new Error("packed dependency was not installed");
  console.log("Clean Minuta-style ESM, CJS, and TypeScript consumer checks passed.");
} finally {
  await rm(consumer, { recursive: true, force: true });
}
