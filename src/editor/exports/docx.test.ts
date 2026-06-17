import { Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createCustomBlock, createHeadingBlock, createImageBlock, createImageGroupBlock, createTableBlock, createTextBlock } from "../core/factories";
import { createSeparatorBlock } from "../plugins/separator-core";
import { SCHEMA_VERSION, type Block, type WealthyDocument } from "../core/schema";
import { exportDocx, type DocxExportOptions } from "./docx";

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

/** Packs the export and unzips word/document.xml — the real content check. */
async function documentXml(
  doc: WealthyDocument,
  options?: DocxExportOptions,
): Promise<{ buffer: Buffer; xml: string }> {
  const buffer = await Packer.toBuffer(exportDocx(doc, options));
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  return { buffer, xml };
}

describe("exportDocx", () => {
  it("packs a document covering all block types into a valid .docx", async () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false });
    table.rows[0]!.cells[0]!.blocks = [createTextBlock({ content: "CellA" })];
    table.rows[0]!.cells[1]!.blocks = [createTextBlock({ content: "CellB" })];

    const doc = docWith([
      createHeadingBlock({ level: 2, content: "MyTitle" }),
      createTextBlock({
        content: [
          { type: "text", text: "normal " },
          { type: "text", text: "strongword", marks: [{ type: "bold" }] },
        ],
      }),
      createTextBlock({ variant: "bullet", content: "BulletItem" }),
      createTextBlock({ variant: "numbered", content: "NumberedItem" }),
      table,
      createImageBlock({ source: { type: "url", url: "https://example.com/a.png" }, altText: "ImageAlt" }),
    ]);

    const { buffer, xml } = await documentXml(doc);

    // Valid OOXML zip container.
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");

    expect(xml).toContain("MyTitle");
    expect(xml).toContain("Heading2"); // heading style applied
    expect(xml).toContain("strongword");
    expect(xml).toMatch(/<w:b[ /]/); // bold run property
    expect(xml).toContain("BulletItem");
    expect(xml).toContain("NumberedItem");
    expect(xml).toContain("<w:numPr>"); // list numbering
    expect(xml).toContain("<w:tbl>"); // table
    expect(xml).toContain("CellA");
    expect(xml).toContain("CellB");
    expect(xml).toContain("[image: ImageAlt]"); // default image fallback
  });

  it("uses per-kind serializers for inline objects and custom blocks", async () => {
    const doc = docWith([
      createTextBlock({
        content: [
          { type: "text", text: "Hi " },
          { type: "object", kind: "placeholder", data: { label: "Name", value: "Ana" } },
        ],
      }),
      createCustomBlock({ kind: "callout", data: { text: "NoteText" } }),
    ]);
    const { xml } = await documentXml(doc, {
      renderInlineObject: (node) => String(node.data["value"] ?? node.data["label"]),
      renderCustomBlock: (block) =>
        new Paragraph({ children: [new TextRun({ text: `CALLOUT:${String(block.data["text"])}` })] }),
    });
    expect(xml).toContain("Ana");
    expect(xml).toContain("CALLOUT:NoteText");
  });

  it("uses an explicit serializer for image blocks", async () => {
    const doc = docWith([createImageBlock({ source: { type: "asset", id: "asset-1" }, caption: "Caption" })]);
    const { xml } = await documentXml(doc, {
      renderImageBlock: (block) =>
        new Paragraph({ children: [new TextRun({ text: `IMAGE:${block.source.type === "asset" ? block.source.id : block.source.url}` })] }),
    });
    expect(xml).toContain("IMAGE:asset-1");
    expect(xml).not.toContain("[image:");
  });

  it("uses paragraph-safe image content rendering for single images and image groups", async () => {
    const image = createImageBlock({ source: { type: "asset", id: "single" }, altText: "Single" });
    const group = createImageGroupBlock({
      images: [
        { source: { type: "asset", id: "left" }, columnWidth: { value: 25, unit: "percent" } },
        { source: { type: "asset", id: "right" } },
      ],
    });
    const { xml } = await documentXml(docWith([image, group]), {
      renderImageContent: (content) => [
        new Paragraph({
          children: [
            new TextRun({
              text: `CONTENT:${content.source.type === "asset" ? content.source.id : content.source.url}`,
            }),
          ],
        }),
      ],
    });
    expect(xml).toContain("CONTENT:single");
    expect(xml).toContain("CONTENT:left");
    expect(xml).toContain("CONTENT:right");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain('w:type="pct"');
    expect(xml).toContain('w:val="none"');
    expect(xml).not.toContain("[image:");
  });

  it("omits empty draft slots and skips an all-empty image group", async () => {
    const partial = createImageGroupBlock({
      images: [
        { source: { type: "empty" } },
        { source: { type: "asset", id: "kept" } },
        { source: { type: "empty" } },
      ],
    });
    const allEmpty = createImageGroupBlock({ images: [{ source: { type: "empty" } }, { source: { type: "empty" } }] });
    const { xml } = await documentXml(docWith([partial, allEmpty, createTextBlock({ content: "marker" })]), {
      renderImageContent: (content) => [
        new Paragraph({
          children: [new TextRun({ text: `CONTENT:${content.source.type === "asset" ? content.source.id : "url"}` })],
        }),
      ],
    });
    expect(xml).toContain("CONTENT:kept");
    expect(xml).toContain("marker");
    // Exactly one table (the partial group); the all-empty group emits nothing.
    expect(xml.match(/<w:tbl>/g) ?? []).toHaveLength(1);
  });

  it("keeps renderImageBlock precedence for single image blocks", async () => {
    const doc = docWith([createImageBlock({ source: { type: "asset", id: "asset-1" } })]);
    const { xml } = await documentXml(doc, {
      renderImageBlock: () => new Paragraph({ children: [new TextRun({ text: "BLOCK_RENDERER" })] }),
      renderImageContent: () => [new Paragraph({ children: [new TextRun({ text: "CONTENT_RENDERER" })] })],
    });
    expect(xml).toContain("BLOCK_RENDERER");
    expect(xml).not.toContain("CONTENT_RENDERER");
  });

  it("falls back for unknown custom blocks and inline objects", async () => {
    const doc = docWith([
      createTextBlock({ content: [{ type: "object", kind: "mention", data: { label: "@ana" } }] }),
      createCustomBlock({ kind: "widget", data: {} }),
    ]);
    const { xml } = await documentXml(doc);
    expect(xml).toContain("@ana");
    expect(xml).toContain("[widget]"); // default custom-block fallback
  });

  it("renders the built-in separator custom block as a paragraph border", async () => {
    const { xml } = await documentXml(docWith([createSeparatorBlock()]));
    expect(xml).toContain("<w:pBdr>");
    expect(xml).toContain("<w:bottom");
  });
});
