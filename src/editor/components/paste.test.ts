// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { exportHtml } from "../exports/html";
import { SCHEMA_VERSION, type TableBlock, type TextBlock, type WealthyDocument } from "../core/schema";
import { parseClipboardToBlocks, parseHtmlToBlocks, parsePlainTextToBlocks } from "./paste";

function cellText(cell: { blocks: TextBlock[] }): string {
  const node = cell.blocks[0]?.content[0];
  return node !== undefined && node.type === "text" ? node.text : "";
}

describe("parseHtmlToBlocks", () => {
  it("maps headings to levels", () => {
    expect(parseHtmlToBlocks("<h1>Title</h1><h3>Sub</h3>")).toMatchObject([
      { type: "heading", level: 1, content: [{ type: "text", text: "Title" }] },
      { type: "heading", level: 3, content: [{ type: "text", text: "Sub" }] },
    ]);
  });

  it("maps paragraphs and inline marks", () => {
    const blocks = parseHtmlToBlocks('<p>plain <strong>bold</strong> <a href="https://x.dev">link</a></p>');
    expect(blocks).toMatchObject([
      {
        type: "text",
        variant: "paragraph",
        content: [
          { type: "text", text: "plain " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " " },
          { type: "text", text: "link", marks: [{ type: "link", href: "https://x.dev" }] },
        ],
      },
    ]);
  });

  it("flattens nested lists into indented bullet blocks", () => {
    const blocks = parseHtmlToBlocks("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>") as TextBlock[];
    expect(blocks.map((b) => ({ variant: b.variant, indent: b.indent, text: (b.content[0] as { text: string }).text }))).toEqual([
      { variant: "bullet", indent: undefined, text: "a" },
      { variant: "bullet", indent: 1, text: "b" },
      { variant: "bullet", indent: undefined, text: "c" },
    ]);
  });

  it("maps ordered lists to numbered items", () => {
    expect(parseHtmlToBlocks("<ol><li>one</li><li>two</li></ol>")).toMatchObject([
      { type: "text", variant: "numbered" },
      { type: "text", variant: "numbered" },
    ]);
  });

  it("maps an hr to the built-in separator block", () => {
    expect(parseHtmlToBlocks("<p>a</p><hr><p>b</p>")).toMatchObject([
      { type: "text" },
      { type: "custom", kind: "separator" },
      { type: "text" },
    ]);
  });

  it("maps a table, detecting the header row and wiring cell column ids", () => {
    const table = parseHtmlToBlocks(
      "<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>",
    )[0] as TableBlock;
    expect(table.type).toBe("table");
    expect(table.showHeader).toBe(true);
    expect(table.columns).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]!.cells.map(cellText)).toEqual(["a", "b"]);
    expect(table.rows[0]!.cells[0]!.columnId).toBe(table.columns[0]!.id);
  });

  it("recurses into wrapper divs and collects loose inline as a paragraph", () => {
    expect(parseHtmlToBlocks("<div><p>inside</p></div>loose text")).toMatchObject([
      { type: "text", content: [{ type: "text", text: "inside" }] },
      { type: "text", content: [{ type: "text", text: "loose text" }] },
    ]);
  });

  it("round-trips the HTML exporter's output stably", () => {
    const blocks = parseHtmlToBlocks("<h2>T</h2><p>para</p><ul><li>x</li></ul>");
    const html = exportHtml({ schemaVersion: SCHEMA_VERSION, blocks });
    const reparsed = parseHtmlToBlocks(html);
    expect(reparsed.map((b) => b.type)).toEqual(["heading", "text", "text"]);
    expect(exportHtml({ schemaVersion: SCHEMA_VERSION, blocks: reparsed } as WealthyDocument)).toBe(html);
  });

  it("preserves exported color and highlight marks", () => {
    const document: WealthyDocument = {
      schemaVersion: SCHEMA_VERSION,
      blocks: [
        {
          id: crypto.randomUUID(),
          type: "text",
          variant: "paragraph",
          content: [
            { type: "text", text: "red", marks: [{ type: "color", token: "danger" }] },
            { type: "text", text: " hot", marks: [{ type: "highlight", token: "warning" }] },
          ],
        },
      ],
    };

    const [block] = parseHtmlToBlocks(exportHtml(document)) as TextBlock[];

    expect(block!.content).toEqual((document.blocks[0] as TextBlock).content);
  });
});

describe("parsePlainTextToBlocks", () => {
  it("splits on newlines and trims surrounding blank lines", () => {
    expect(parsePlainTextToBlocks("\nfirst\nsecond\n\n")).toMatchObject([
      { type: "text", content: [{ type: "text", text: "first" }] },
      { type: "text", content: [{ type: "text", text: "second" }] },
    ]);
  });

  it("always returns at least one block", () => {
    expect(parsePlainTextToBlocks("")).toHaveLength(1);
  });
});

describe("parseClipboardToBlocks", () => {
  it("prefers HTML when present", () => {
    expect(parseClipboardToBlocks({ html: "<h1>H</h1>", text: "H" })).toMatchObject([{ type: "heading", level: 1 }]);
  });

  it("falls back to plain text when the HTML is blank", () => {
    expect(parseClipboardToBlocks({ html: "   ", text: "a\nb" })).toMatchObject([
      { type: "text", content: [{ type: "text", text: "a" }] },
      { type: "text", content: [{ type: "text", text: "b" }] },
    ]);
  });
});
