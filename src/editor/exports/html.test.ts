import { describe, expect, it } from "vitest";
import { createCustomBlock, createHeadingBlock, createTableBlock, createTextBlock } from "../core/factories";
import { createSeparatorBlock } from "../plugins/separator-core";
import { SCHEMA_VERSION, type Block, type WealthyDocument } from "../core/schema";
import { exportHtml } from "./html";

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

describe("exportHtml", () => {
  it("renders headings and paragraphs with marks", () => {
    const doc = docWith([
      createHeadingBlock({ level: 2, content: "Title" }),
      createTextBlock({
        content: [
          { type: "text", text: "plain " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " " },
          { type: "text", text: "link", marks: [{ type: "link", href: "https://x.dev" }] },
        ],
      }),
    ]);
    expect(exportHtml(doc)).toBe(
      '<h2>Title</h2>\n<p>plain <strong>bold</strong> <a href="https://x.dev">link</a></p>',
    );
  });

  it("escapes text and attributes", () => {
    const doc = docWith([createTextBlock({ content: [{ type: "text", text: "<b> & \"q\"" }] })]);
    expect(exportHtml(doc)).toBe("<p>&lt;b&gt; &amp; &quot;q&quot;</p>");
  });

  it("optionally prefixes headings with computed numbers", () => {
    const doc = docWith([
      createHeadingBlock({ level: 1, content: "A" }),
      createHeadingBlock({ level: 2, content: "A.1" }),
    ]);
    expect(exportHtml(doc, { headingNumbers: true })).toBe("<h1>1. A</h1>\n<h2>1.1. A.1</h2>");
  });

  it("groups consecutive list items, nesting by indent", () => {
    const doc = docWith([
      createTextBlock({ variant: "bullet", content: "a" }),
      createTextBlock({ variant: "bullet", content: "b", indent: 1 }),
      createTextBlock({ variant: "bullet", content: "c" }),
    ]);
    expect(exportHtml(doc)).toBe("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
  });

  it("splits lists when the variant changes at the same level", () => {
    const doc = docWith([
      createTextBlock({ variant: "bullet", content: "a" }),
      createTextBlock({ variant: "numbered", content: "b" }),
    ]);
    expect(exportHtml(doc)).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
  });

  it("breaks a list run on a non-list block", () => {
    const doc = docWith([
      createTextBlock({ variant: "bullet", content: "a" }),
      createTextBlock({ content: "para" }),
      createTextBlock({ variant: "bullet", content: "b" }),
    ]);
    expect(exportHtml(doc)).toBe("<ul><li>a</li></ul>\n<p>para</p>\n<ul><li>b</li></ul>");
  });

  it("renders a table with an optional header row", () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 2, showHeader: true });
    // Put recognizable text in the cells.
    table.rows[0]!.cells[0]!.blocks = [createTextBlock({ content: "H1" })];
    table.rows[0]!.cells[1]!.blocks = [createTextBlock({ content: "H2" })];
    table.rows[1]!.cells[0]!.blocks = [createTextBlock({ content: "a" })];
    table.rows[1]!.cells[1]!.blocks = [createTextBlock({ content: "b" })];
    const html = exportHtml(docWith([table]));
    expect(html).toBe(
      "<table><colgroup><col><col></colgroup><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>",
    );
  });

  it("honors table column widths with a colgroup", () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false });
    table.columns[0] = { ...table.columns[0]!, width: { value: 30, unit: "percent" } };
    table.columns[1] = { ...table.columns[1]!, width: { value: 180, unit: "px" } };
    expect(exportHtml(docWith([table]))).toContain(
      '<colgroup><col style="width:30%"><col style="width:180px"></colgroup>',
    );
  });

  it("uses per-kind serializers for custom blocks and inline objects", () => {
    const doc = docWith([
      createTextBlock({
        content: [
          { type: "text", text: "Hi " },
          { type: "object", kind: "placeholder", data: { label: "Name", value: "Ana" } },
        ],
      }),
      createCustomBlock({ kind: "callout", data: { text: "note" } }),
    ]);
    const html = exportHtml(doc, {
      renderInlineObject: (node) => `<b>${String(node.data["value"] ?? node.data["label"])}</b>`,
      renderCustomBlock: (block) => `<aside>${String(block.data["text"])}</aside>`,
    });
    expect(html).toBe("<p>Hi <b>Ana</b></p>\n<aside>note</aside>");
  });

  it("falls back for unknown custom blocks and inline objects", () => {
    const doc = docWith([
      createTextBlock({ content: [{ type: "object", kind: "mention", data: { label: "@ana" } }] }),
      createCustomBlock({ kind: "widget", data: {} }),
    ]);
    expect(exportHtml(doc)).toBe("<p>@ana</p>\n<!-- custom block: widget -->");
  });

  it("renders the built-in separator custom block as an hr", () => {
    const doc = docWith([createTextBlock({ content: "before" }), createSeparatorBlock(), createTextBlock({ content: "after" })]);
    expect(exportHtml(doc)).toBe("<p>before</p>\n<hr>\n<p>after</p>");
  });

  it("emits text-align styles from align", () => {
    const doc = docWith([createHeadingBlock({ level: 1, content: "C", align: "center" })]);
    expect(exportHtml(doc)).toBe('<h1 style="text-align:center">C</h1>');
  });
});
