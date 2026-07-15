// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { exportHtml } from "../exports/html";
import { SCHEMA_VERSION, type ImageBlock, type TableBlock, type TextBlock, type MogulDocument } from "../core/schema";
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

  it("maps pasted img elements to URL image blocks", () => {
    const [block] = parseHtmlToBlocks('<img src="/photo.png" alt="Photo" width="640" height="480">') as ImageBlock[];

    expect(block).toMatchObject({
      type: "image",
      source: { type: "url", url: new URL("/photo.png", document.baseURI).href },
      altText: "Photo",
      size: { width: 640, height: 480, unit: "px" },
    });
  });

  it("maps figures with captions to image blocks", () => {
    const [block] = parseHtmlToBlocks(
      '<figure><img src="https://example.com/a.png" alt="A"><figcaption><strong>Caption</strong></figcaption></figure>',
    ) as ImageBlock[];

    expect(block).toMatchObject({
      type: "image",
      source: { type: "url", url: "https://example.com/a.png" },
      altText: "A",
      caption: [{ type: "text", text: "Caption", marks: [{ type: "bold" }] }],
    });
  });

  it("only stores http(s) image sources from pasted HTML", () => {
    for (const src of [
      "data:image/png;base64,abc",
      "blob:https://example.com/123",
      "file:///etc/passwd",
      "ftp://example.com/a.png",
      "javascript:alert(1)",
    ]) {
      expect(parseHtmlToBlocks(`<img src="${src}" alt="x">`)).toEqual([]);
    }
    expect(parseHtmlToBlocks('<img src="https://example.com/ok.png">')).toHaveLength(1);
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

  it("expands colspan and rowspan into a rectangular core table", () => {
    const [block] = parseHtmlToBlocks(
      "<table><tr><th colspan='2'>Merged</th></tr><tr><td rowspan='2'>A</td><td>B</td></tr><tr><td>C</td></tr></table>",
    );
    expect(block?.type).toBe("table");
    const table = block as TableBlock;
    expect(table.columns).toHaveLength(2);
    expect(table.rows).toHaveLength(3);
    expect(table.rows.every((row) => row.cells.length === 2)).toBe(true);
    expect(table.rows.map((row) => row.cells.map(cellText))).toEqual([
      ["Merged", ""],
      ["A", "B"],
      ["", "C"],
    ]);
  });

  it("bounds hostile spans and the total expanded table size", () => {
    const [block] = parseHtmlToBlocks(
      "<table><tr><td colspan='1000000000' rowspan='1000000000'>x</td></tr></table>",
    );
    const table = block as TableBlock;

    expect(table.columns.length).toBeLessThanOrEqual(64);
    expect(table.rows.length).toBeLessThanOrEqual(64);
    expect(table.columns.length * table.rows.length).toBeLessThanOrEqual(4096);
  });

  it("does not treat nested-table rows as rows of the outer table", () => {
    const [block] = parseHtmlToBlocks(
      "<table><tbody><tr><td>outer<table><tbody><tr><td>inner</td></tr></tbody></table></td></tr></tbody></table>",
    );
    const table = block as TableBlock;

    expect(table.rows).toHaveLength(1);
    expect(table.columns).toHaveLength(1);
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
    expect(exportHtml({ schemaVersion: SCHEMA_VERSION, blocks: reparsed } as MogulDocument)).toBe(html);
  });

  it("preserves exported color and highlight marks", () => {
    const document: MogulDocument = {
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
