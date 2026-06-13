import { Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createCustomBlock, createHeadingBlock, createTableBlock, createTextBlock } from "../core/factories";
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

  it("falls back for unknown custom blocks and inline objects", async () => {
    const doc = docWith([
      createTextBlock({ content: [{ type: "object", kind: "mention", data: { label: "@ana" } }] }),
      createCustomBlock({ kind: "widget", data: {} }),
    ]);
    const { xml } = await documentXml(doc);
    expect(xml).toContain("@ana");
    expect(xml).toContain("[widget]"); // default custom-block fallback
  });
});
