import { describe, expect, it } from "vitest";
import { createCustomBlock, createHeadingBlock, createImageBlock, createImageGroupBlock, createTableBlock, createTextBlock } from "../core/factories";
import { createSeparatorBlock } from "../plugins/separator-core";
import { SCHEMA_VERSION, type Block, type WealthyDocument } from "../core/schema";
import { exportMarkdown } from "./markdown";

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

describe("exportMarkdown", () => {
  it("escapes link destinations and drops unsafe schemes", () => {
    const doc = docWith([
      createTextBlock({ content: [
        { type: "text", text: "safe", marks: [{ type: "link", href: "https://example.com/a file_(1)" }] },
        { type: "text", text: " unsafe", marks: [{ type: "link", href: "javascript:alert(1)" }] },
      ] }),
    ]);
    expect(exportMarkdown(doc)).toBe("[safe](https://example.com/a%20file_(1%29) unsafe");
  });
  it("renders headings and paragraphs with GFM marks", () => {
    const doc = docWith([
      createHeadingBlock({ level: 2, content: "Title" }),
      createTextBlock({
        content: [
          { type: "text", text: "a " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " " },
          { type: "text", text: "code", marks: [{ type: "code" }] },
          { type: "text", text: " " },
          { type: "text", text: "link", marks: [{ type: "link", href: "https://x.dev" }] },
        ],
      }),
    ]);
    expect(exportMarkdown(doc)).toBe("## Title\n\na **bold** `code` [link](https://x.dev)");
  });

  it("escapes Markdown syntax in text", () => {
    const doc = docWith([createTextBlock({ content: [{ type: "text", text: "a*b_c[d]" }] })]);
    expect(exportMarkdown(doc)).toBe("a\\*b\\_c\\[d\\]");
  });

  it("optionally prefixes headings with computed numbers", () => {
    const doc = docWith([
      createHeadingBlock({ level: 1, content: "A" }),
      createHeadingBlock({ level: 2, content: "B" }),
    ]);
    expect(exportMarkdown(doc, { headingNumbers: true })).toBe("# 1. A\n\n## 1.1. B");
  });

  it("renders bullets and numbered items with indent nesting", () => {
    const doc = docWith([
      createTextBlock({ variant: "numbered", content: "one" }),
      createTextBlock({ variant: "numbered", content: "two" }),
      createTextBlock({ variant: "bullet", content: "nested", indent: 1 }),
    ]);
    expect(exportMarkdown(doc)).toBe("1. one\n2. two\n  - nested");
  });

  it("renders a GFM pipe table with alignment", () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 2 });
    table.columns[1]!.align = "right";
    table.rows[0]!.cells[0]!.blocks = [createTextBlock({ content: "H1" })];
    table.rows[0]!.cells[1]!.blocks = [createTextBlock({ content: "H2" })];
    table.rows[1]!.cells[0]!.blocks = [createTextBlock({ content: "a" })];
    table.rows[1]!.cells[1]!.blocks = [createTextBlock({ content: "b" })];
    expect(exportMarkdown(docWith([table]))).toBe("| H1 | H2 |\n| --- | ---: |\n| a | b |");
  });

  it("renders image blocks and optional captions", () => {
    const image = createImageBlock({
      source: { type: "url", url: "https://example.com/a photo.png" },
      altText: "A [photo]",
      caption: "Caption",
    });
    expect(exportMarkdown(docWith([image]))).toBe("![A \\[photo\\]](https://example.com/a%20photo.png)\n\nCaption");
  });

  it("resolves asset image blocks through an export option", () => {
    const image = createImageBlock({ source: { type: "asset", id: "asset-1" } });
    expect(exportMarkdown(docWith([image]), { resolveImageSource: () => "https://cdn.example/asset-1.png" })).toBe(
      "![](https://cdn.example/asset-1.png)",
    );
  });

  it("renders image groups as portable stacked images", () => {
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a photo.png" }, altText: "A", caption: "Cap A" },
        { source: { type: "asset", id: "asset-1" }, altText: "B" },
      ],
    });
    expect(
      exportMarkdown(docWith([group]), {
        resolveImageContentSource: (image) =>
          image.source.type === "asset" ? "https://cdn.example/asset-1.png" : undefined,
      }),
    ).toBe("![A](https://example.com/a%20photo.png)\n\nCap A\n\n![B](https://cdn.example/asset-1.png)");
  });

  it("omits empty draft slots and skips an all-empty group", () => {
    const partial = createImageGroupBlock({
      images: [
        { source: { type: "empty" } },
        { source: { type: "url", url: "https://example.com/a.png" }, altText: "A" },
      ],
    });
    expect(exportMarkdown(docWith([partial]))).toBe("![A](https://example.com/a.png)");

    const allEmpty = createImageGroupBlock({ images: [{ source: { type: "empty" } }, { source: { type: "empty" } }] });
    expect(exportMarkdown(docWith([createTextBlock({ content: "x" }), allEmpty]))).toBe("x");
  });

  it("uses per-kind serializers and falls back otherwise", () => {
    const doc = docWith([
      createTextBlock({
        content: [
          { type: "text", text: "Hi " },
          { type: "object", kind: "placeholder", data: { label: "Name" } },
        ],
      }),
      createCustomBlock({ kind: "callout", data: { text: "note" } }),
    ]);
    expect(
      exportMarkdown(doc, {
        renderInlineObject: (node) => `{{${String(node.data["label"])}}}`,
        renderCustomBlock: (block) => `> ${String(block.data["text"])}`,
      }),
    ).toBe("Hi {{Name}}\n\n> note");

    expect(exportMarkdown(doc)).toBe("Hi Name\n\n<!-- custom block: callout -->");
  });

  it("renders the built-in separator custom block as a horizontal rule", () => {
    const doc = docWith([createTextBlock({ content: "before" }), createSeparatorBlock(), createTextBlock({ content: "after" })]);
    expect(exportMarkdown(doc)).toBe("before\n\n---\n\nafter");
  });
});
