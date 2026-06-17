import { describe, expect, it } from "vitest";
import {
  createBlock,
  createCustomBlock,
  createEmptyDocument,
  createEmptyImageGroupBlock,
  createHeadingBlock,
  createImageBlock,
  createImageGroupBlock,
  createTableBlock,
  createTextBlock,
  generateBlockId,
} from "./factories";
import { resolveImageGroupColumnWidths } from "./image-layout";
import {
  SCHEMA_VERSION,
  blockSchema,
  documentSchema,
  inlineNodeSchema,
  imageBlockSchema,
  imageGroupBlockSchema,
  isFilledImageGroupEntry,
  safeValidateDocument,
  tableBlockSchema,
  validateDocument,
  type WealthyDocument,
} from "./schema";
import { deserializeDocument, serializeDocument } from "./serialization";

function docWith(blocks: WealthyDocument["blocks"]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

describe("block schemas", () => {
  it("accepts a heading block at every level", () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const block = createHeadingBlock({ level, content: "Title" });
      expect(blockSchema.parse(block)).toEqual(block);
    }
  });

  it("rejects heading levels outside 1-6", () => {
    const block = { ...createHeadingBlock({ level: 1 }), level: 7 };
    expect(blockSchema.safeParse(block).success).toBe(false);
    const zero = { ...createHeadingBlock({ level: 1 }), level: 0 };
    expect(blockSchema.safeParse(zero).success).toBe(false);
  });

  it("accepts text blocks for each variant, with indent", () => {
    for (const variant of ["paragraph", "bullet", "numbered"] as const) {
      const block = createTextBlock({ variant, content: "line", indent: 2 });
      expect(blockSchema.parse(block)).toEqual(block);
    }
  });

  it("rejects negative or fractional indent", () => {
    const negative = { ...createTextBlock(), indent: -1 };
    expect(blockSchema.safeParse(negative).success).toBe(false);
    const fractional = { ...createTextBlock(), indent: 1.5 };
    expect(blockSchema.safeParse(fractional).success).toBe(false);
  });

  it("rejects blocks without a uuid id", () => {
    const block = { ...createTextBlock(), id: "not-a-uuid" };
    expect(blockSchema.safeParse(block).success).toBe(false);
  });

  it("rejects unknown block types", () => {
    const block = { id: generateBlockId(), type: "video", url: "x" };
    expect(blockSchema.safeParse(block).success).toBe(false);
  });

  it("accepts custom blocks with kind + data", () => {
    const block = createCustomBlock({ kind: "request_list", data: { requests: [] } });
    expect(blockSchema.parse(block)).toEqual(block);
  });

  it("rejects custom blocks with an empty kind", () => {
    const block = { ...createCustomBlock({ kind: "x" }), kind: "" };
    expect(blockSchema.safeParse(block).success).toBe(false);
  });

  it("accepts image blocks with URL or asset sources", () => {
    const urlImage = createImageBlock({
      source: { type: "url", url: "https://example.com/photo.png" },
      altText: "Photo",
      caption: "A caption",
      size: { width: 50, unit: "percent" },
      align: "center",
    });
    expect(imageBlockSchema.parse(urlImage)).toEqual(urlImage);

    const assetImage = createImageBlock({ source: { type: "asset", id: "asset-123" } });
    expect(blockSchema.parse(assetImage)).toEqual(assetImage);
  });

  it("rejects image blocks with invalid sources or sizes", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/photo.png" } });
    expect(imageBlockSchema.safeParse({ ...image, source: { type: "url", url: "not-url" } }).success).toBe(false);
    expect(imageBlockSchema.safeParse({ ...image, source: { type: "asset", id: "" } }).success).toBe(false);
    expect(imageBlockSchema.safeParse({ ...image, size: { width: -1, unit: "px" } }).success).toBe(false);
  });

  it("rejects non-durable image url schemes at the model boundary", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/photo.png" } });
    for (const url of [
      "data:image/png;base64,abc",
      "blob:https://example.com/123",
      "javascript:alert(1)",
    ]) {
      expect(imageBlockSchema.safeParse({ ...image, source: { type: "url", url } }).success).toBe(false);
    }
  });

  it("accepts image group blocks and normalizes layout widths without mutating", () => {
    const group = createImageGroupBlock({
      images: [
        {
          source: { type: "url", url: "https://example.com/a.png" },
          caption: "A",
          columnWidth: { value: 30, unit: "percent" },
        },
        {
          source: { type: "asset", id: "asset-1" },
          altText: "B",
        },
      ],
      align: "center",
      gap: 12,
    });
    expect(imageGroupBlockSchema.parse(group)).toEqual(group);
    expect(resolveImageGroupColumnWidths(group.images)).toEqual([30, 70]);
  });

  it("rejects image groups with duplicate entry ids or widths over 100", () => {
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" }, columnWidth: { value: 60, unit: "percent" } },
        { source: { type: "url", url: "https://example.com/b.png" }, columnWidth: { value: 50, unit: "percent" } },
      ],
    });
    expect(imageGroupBlockSchema.safeParse(group).success).toBe(false);

    const duplicateId = generateBlockId();
    const duplicate = createImageGroupBlock({
      images: [
        { id: duplicateId, source: { type: "url", url: "https://example.com/a.png" } },
        { id: duplicateId, source: { type: "url", url: "https://example.com/b.png" } },
      ],
    });
    expect(imageGroupBlockSchema.safeParse(duplicate).success).toBe(false);
  });

  it("accepts empty draft slots in group entries but not in single image blocks", () => {
    const group = createEmptyImageGroupBlock({ columns: 3 });
    expect(imageGroupBlockSchema.parse(group)).toEqual(group);
    expect(group.images).toHaveLength(3);
    expect(group.images.every((entry) => entry.source.type === "empty")).toBe(true);
    expect(group.images.every((entry) => !isFilledImageGroupEntry(entry))).toBe(true);

    // A single image block must carry a real, durable source.
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    expect(imageBlockSchema.safeParse({ ...image, source: { type: "empty" } }).success).toBe(false);
  });

  it("scales fully explicit image group widths below 100 to fill the row", () => {
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" }, columnWidth: { value: 20, unit: "percent" } },
        { source: { type: "url", url: "https://example.com/b.png" }, columnWidth: { value: 30, unit: "percent" } },
      ],
    });
    expect(resolveImageGroupColumnWidths(group.images)).toEqual([40, 60]);
  });
});

describe("inline nodes", () => {
  it("accepts text nodes with marks, including link href and color tokens", () => {
    const node = {
      type: "text",
      text: "hello",
      marks: [
        { type: "bold" },
        { type: "link", href: "https://example.com" },
        { type: "color", token: "danger" },
      ],
    };
    expect(inlineNodeSchema.parse(node)).toEqual(node);
  });

  it("accepts atomic inline objects with a data bag", () => {
    const node = { type: "object", kind: "placeholder", data: { key: "client_name" } };
    expect(inlineNodeSchema.parse(node)).toEqual(node);
  });

  it("rejects inline objects without kind or data", () => {
    expect(inlineNodeSchema.safeParse({ type: "object", kind: "x" }).success).toBe(false);
    expect(inlineNodeSchema.safeParse({ type: "object", data: {} }).success).toBe(false);
  });
});

describe("table blocks (D9: restricted cells)", () => {
  it("accepts a factory-built table", () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 2 });
    expect(tableBlockSchema.parse(table)).toEqual(table);
  });

  it("rejects heading blocks inside cells", () => {
    const table = createTableBlock({ columnCount: 1, rowCount: 1 });
    const corrupted = {
      ...table,
      rows: [
        {
          ...table.rows[0]!,
          cells: [{ columnId: table.columns[0]!.id, blocks: [createHeadingBlock({ level: 2 })] }],
        },
      ],
    };
    expect(tableBlockSchema.safeParse(corrupted).success).toBe(false);
  });

  it("rejects nested tables inside cells", () => {
    const table = createTableBlock({ columnCount: 1, rowCount: 1 });
    const corrupted = {
      ...table,
      rows: [
        {
          ...table.rows[0]!,
          cells: [
            { columnId: table.columns[0]!.id, blocks: [createTableBlock({ columnCount: 1, rowCount: 0 })] },
          ],
        },
      ],
    };
    expect(tableBlockSchema.safeParse(corrupted).success).toBe(false);
  });

  it("rejects cells referencing unknown column ids", () => {
    const table = createTableBlock({ columnCount: 1, rowCount: 1 });
    const corrupted = {
      ...table,
      rows: [{ ...table.rows[0]!, cells: [{ columnId: generateBlockId(), blocks: [createTextBlock()] }] }],
    };
    const result = tableBlockSchema.safeParse(corrupted);
    expect(result.success).toBe(false);
  });

  it("rejects duplicate column ids and duplicate cells per column", () => {
    const table = createTableBlock({ columnCount: 1, rowCount: 0 });
    const duplicateColumns = { ...table, columns: [table.columns[0]!, table.columns[0]!] };
    expect(tableBlockSchema.safeParse(duplicateColumns).success).toBe(false);

    const base = createTableBlock({ columnCount: 1, rowCount: 1 });
    const cell = base.rows[0]!.cells[0]!;
    const duplicateCells = { ...base, rows: [{ ...base.rows[0]!, cells: [cell, cell] }] };
    expect(tableBlockSchema.safeParse(duplicateCells).success).toBe(false);
  });

  it("rejects tables with zero columns", () => {
    const table = { ...createTableBlock({ columnCount: 1, rowCount: 0 }), columns: [] };
    expect(tableBlockSchema.safeParse(table).success).toBe(false);
  });
});

describe("document schema", () => {
  it("accepts a flat mixed-block document", () => {
    const doc = docWith([
      createHeadingBlock({ level: 1, content: "Facts" }),
      createTextBlock({ content: "First paragraph." }),
      createTextBlock({ variant: "bullet", content: "A bullet", indent: 0 }),
      createTableBlock({ columnCount: 2, rowCount: 1 }),
      createImageBlock({ source: { type: "url", url: "https://example.com/image.png" } }),
      createImageGroupBlock({
        images: [
          { source: { type: "url", url: "https://example.com/a.png" } },
          { source: { type: "url", url: "https://example.com/b.png" } },
        ],
      }),
      createCustomBlock({ kind: "signature", data: { lawyerId: generateBlockId() } }),
    ]);
    expect(validateDocument(doc)).toEqual(doc);
  });

  it("rejects duplicate block ids", () => {
    const block = createTextBlock({ content: "once" });
    const result = safeValidateDocument(docWith([block, { ...block }]));
    expect(result.success).toBe(false);
  });

  it("rejects wrong schemaVersion", () => {
    const doc = { ...docWith([createTextBlock()]), schemaVersion: 2 };
    expect(documentSchema.safeParse(doc).success).toBe(false);
  });

  it("createEmptyDocument yields one empty paragraph and passes validation", () => {
    const doc = createEmptyDocument();
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ type: "text", variant: "paragraph", content: [] });
    expect(validateDocument(doc)).toEqual(doc);
  });
});

describe("meta bag round-trip (D5)", () => {
  it("preserves arbitrary nested host data on document, blocks, and inline objects", () => {
    const meta = {
      role: "facts",
      provenance: { createdBy: "llm", createdAt: "2026-06-11T10:00:00-03:00" },
      sources: { evidenceIds: [generateBlockId()], nested: { deep: [1, "two", null, { ok: true }] } },
    };
    const doc: WealthyDocument = {
      schemaVersion: SCHEMA_VERSION,
      meta: { workspaceId: generateBlockId() },
      blocks: [
        { ...createHeadingBlock({ level: 2, content: "DOS FATOS" }), meta },
        {
          ...createTextBlock(),
          content: [
            { type: "text", text: "Cliente: " },
            { type: "object", kind: "placeholder", data: { key: "client_name" }, meta: { state: "unfilled" } },
          ],
        },
      ],
    };

    const roundTripped = deserializeDocument(serializeDocument(doc));
    expect(roundTripped).toEqual(doc);
  });
});

describe("serialization", () => {
  it("round-trips a full document", () => {
    const doc = docWith([
      createHeadingBlock({ level: 1, content: "Title", align: "center" }),
      createTextBlock({ variant: "numbered", content: "item", indent: 1, align: "justify" }),
      createTableBlock({ columnCount: 3, rowCount: 2, showHeader: false }),
    ]);
    expect(deserializeDocument(serializeDocument(doc))).toEqual(doc);
  });

  it("serializeDocument throws on a corrupt in-memory document", () => {
    const doc = docWith([{ ...createTextBlock(), indent: -3 }]);
    expect(() => serializeDocument(doc)).toThrow();
  });

  it("deserializeDocument throws SyntaxError on malformed JSON", () => {
    expect(() => deserializeDocument("{not json")).toThrow(SyntaxError);
  });

  it("deserializeDocument rejects valid JSON that violates the schema", () => {
    expect(() => deserializeDocument(JSON.stringify({ schemaVersion: 1, blocks: [{ type: "nope" }] }))).toThrow();
  });
});

describe("factories", () => {
  it("createBlock dispatches by type", () => {
    expect(createBlock({ type: "heading", level: 3 }).type).toBe("heading");
    expect(createBlock({ type: "text", variant: "bullet" })).toMatchObject({ type: "text", variant: "bullet" });
    expect(createBlock({ type: "table", columnCount: 1, rowCount: 1 }).type).toBe("table");
    expect(createBlock({ type: "image", source: { type: "asset", id: "asset-1" } }).type).toBe("image");
    expect(
      createBlock({
        type: "imageGroup",
        images: [{ source: { type: "url", url: "https://example.com/a.png" } }],
      }).type,
    ).toBe("imageGroup");
    expect(createBlock({ type: "custom", kind: "x" })).toMatchObject({ type: "custom", kind: "x", data: {} });
  });

  it("string content becomes a single text node; empty string becomes empty content", () => {
    expect(createTextBlock({ content: "hi" }).content).toEqual([{ type: "text", text: "hi" }]);
    expect(createTextBlock({ content: "" }).content).toEqual([]);
  });

  it("createTableBlock validates counts and builds aligned cells", () => {
    expect(() => createTableBlock({ columnCount: 0, rowCount: 1 })).toThrow(RangeError);
    expect(() => createTableBlock({ columnCount: 1, rowCount: -1 })).toThrow(RangeError);
    const table = createTableBlock({ columnCount: 2, rowCount: 3 });
    expect(table.rows).toHaveLength(3);
    for (const row of table.rows) {
      expect(row.cells.map((cell) => cell.columnId)).toEqual(table.columns.map((column) => column.id));
    }
  });

  it("generated ids are unique uuids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateBlockId()));
    expect(ids.size).toBe(100);
  });
});
