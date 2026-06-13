const [root, react, html, markdown, docx] = await Promise.all([
  import("wealthy-text-editor"),
  import("wealthy-text-editor/react"),
  import("wealthy-text-editor/export-html"),
  import("wealthy-text-editor/export-markdown"),
  import("wealthy-text-editor/export-docx"),
]);

const checks = [
  ["root.createEmptyDocument", typeof root.createEmptyDocument === "function"],
  ["root.createSeparatorBlock", typeof root.createSeparatorBlock === "function"],
  ["root.DocumentEditor is absent", root.DocumentEditor === undefined],
  ["react.DocumentEditor", typeof react.DocumentEditor === "function"],
  ["react.separatorPlugin", typeof react.separatorPlugin === "object"],
  ["react.createSeparatorBlock", typeof react.createSeparatorBlock === "function"],
  ["html.exportHtml", typeof html.exportHtml === "function"],
  ["markdown.exportMarkdown", typeof markdown.exportMarkdown === "function"],
  ["docx.exportDocx", typeof docx.exportDocx === "function"],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [name] of failed) {
    console.error(`Export smoke check failed: ${name}`);
  }
  process.exit(1);
}

console.log("Export smoke checks passed.");
