const [root, react, html, markdown, docx] = await Promise.all([
  import("mogul-text-editor"),
  import("mogul-text-editor/react"),
  import("mogul-text-editor/export-html"),
  import("mogul-text-editor/export-markdown"),
  import("mogul-text-editor/export-docx"),
]);

const checks = [
  ["root.createEmptyDocument", typeof root.createEmptyDocument === "function"],
  ["root.createSeparatorBlock", typeof root.createSeparatorBlock === "function"],
  ["root.DocumentEditor is absent", root.DocumentEditor === undefined],
  ["root.documentSchema is absent", root.documentSchema === undefined],
  ["root.createHistory is absent", root.createHistory === undefined],
  ["root.documentPatchSchema is absent", root.documentPatchSchema === undefined],
  ["react.DocumentEditor", typeof react.DocumentEditor === "function"],
  ["react.InlineEditor is absent", react.InlineEditor === undefined],
  ["react.SlashMenu is absent", react.SlashMenu === undefined],
  ["react.buildPluginRegistry is absent", react.buildPluginRegistry === undefined],
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
