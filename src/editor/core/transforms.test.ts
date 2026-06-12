import { describe, expect, it } from "vitest";
import { createCustomBlock, createHeadingBlock, createTableBlock, createTextBlock } from "./factories";
import { SCHEMA_VERSION, type Block, type HeadingBlock, type WealthyDocument } from "./schema";
import {
  deleteBlock,
  deleteSection,
  duplicateSection,
  indentBlock,
  insertBlockAfter,
  mergeWithPrevious,
  moveBlock,
  moveSection,
  outdentBlock,
  splitBlock,
  turnInto,
  updateBlock,
} from "./transforms";

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

function ids(document: WealthyDocument): string[] {
  return document.blocks.map((block) => block.id);
}

describe("insertBlockAfter / deleteBlock / moveBlock", () => {
  const a = createTextBlock({ content: "a" });
  const b = createTextBlock({ content: "b" });
  const c = createTextBlock({ content: "c" });

  it("inserts after an anchor and at the start with null", () => {
    const block = createTextBlock({ content: "x" });
    expect(ids(insertBlockAfter(docWith([a, b]), a.id, block))).toEqual([a.id, block.id, b.id]);
    expect(ids(insertBlockAfter(docWith([a, b]), null, block))).toEqual([block.id, a.id, b.id]);
  });

  it("rejects duplicate ids and unknown anchors", () => {
    expect(() => insertBlockAfter(docWith([a]), a.id, a)).toThrow(RangeError);
    expect(() => insertBlockAfter(docWith([a]), b.id, c)).toThrow(RangeError);
  });

  it("deletes blocks and leaves others untouched by reference", () => {
    const next = deleteBlock(docWith([a, b, c]), b.id);
    expect(ids(next)).toEqual([a.id, c.id]);
    expect(next.blocks[0]).toBe(a);
  });

  it("moves a block after an anchor and to the start", () => {
    expect(ids(moveBlock(docWith([a, b, c]), c.id, a.id))).toEqual([a.id, c.id, b.id]);
    expect(ids(moveBlock(docWith([a, b, c]), c.id, null))).toEqual([c.id, a.id, b.id]);
    expect(() => moveBlock(docWith([a, b]), a.id, a.id)).toThrow(RangeError);
  });
});

describe("updateBlock", () => {
  it("merges patchable keys and revalidates", () => {
    const block = createTextBlock({ content: "hello" });
    const next = updateBlock(docWith([block]), block.id, { variant: "bullet", indent: 1 });
    expect(next.blocks[0]).toMatchObject({ variant: "bullet", indent: 1 });
  });

  it("rejects id/type changes and unknown keys", () => {
    const block = createTextBlock();
    expect(() => updateBlock(docWith([block]), block.id, { id: "x" })).toThrow(RangeError);
    expect(() => updateBlock(docWith([block]), block.id, { type: "heading" })).toThrow(RangeError);
    expect(() => updateBlock(docWith([block]), block.id, { level: 2 })).toThrow(RangeError);
  });

  it("rejects patches that produce invalid blocks", () => {
    const heading = createHeadingBlock({ level: 1 });
    expect(() => updateBlock(docWith([heading]), heading.id, { level: 9 })).toThrow();
  });
});

describe("turnInto (D1: one-block type change)", () => {
  it("converts paragraph → heading, dropping indent, keeping content/meta/align", () => {
    const block = createTextBlock({ content: "title", indent: 2, align: "center", meta: { role: "facts" } });
    const next = turnInto(docWith([block]), block.id, { type: "heading", level: 2 });
    expect(next.blocks[0]).toEqual({
      id: block.id,
      type: "heading",
      level: 2,
      align: "center",
      content: block.content,
      meta: { role: "facts" },
    });
  });

  it("converts heading → bullet and changes variants in place", () => {
    const heading = createHeadingBlock({ level: 3, content: "x" });
    const next = turnInto(docWith([heading]), heading.id, { type: "text", variant: "bullet" });
    expect(next.blocks[0]).toMatchObject({ type: "text", variant: "bullet", content: heading.content });
  });

  it("keeps indent across text→text conversions", () => {
    const bullet = createTextBlock({ variant: "bullet", indent: 2 });
    const next = turnInto(docWith([bullet]), bullet.id, { type: "text", variant: "numbered" });
    expect(next.blocks[0]).toMatchObject({ variant: "numbered", indent: 2 });
  });

  it("rejects table/custom blocks", () => {
    const table = createTableBlock({ columnCount: 1, rowCount: 0 });
    expect(() => turnInto(docWith([table]), table.id, { type: "text", variant: "paragraph" })).toThrow(RangeError);
  });
});

describe("splitBlock / mergeWithPrevious", () => {
  it("splits a text block mid-content, preserving variant and marks", () => {
    const block = createTextBlock({
      variant: "bullet",
      indent: 1,
      content: [
        { type: "text", text: "hello ", marks: [{ type: "bold" }] },
        { type: "text", text: "world" },
      ],
    });
    const next = splitBlock(docWith([block]), block.id, 3, "11111111-1111-4111-8111-111111111111");
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0]).toMatchObject({
      id: block.id,
      content: [{ type: "text", text: "hel", marks: [{ type: "bold" }] }],
    });
    expect(next.blocks[1]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      variant: "bullet",
      indent: 1,
      content: [
        { type: "text", text: "lo ", marks: [{ type: "bold" }] },
        { type: "text", text: "world" },
      ],
    });
  });

  it("split at the end of a heading yields an empty paragraph", () => {
    const heading = createHeadingBlock({ level: 2, content: "Title" });
    const next = splitBlock(docWith([heading]), heading.id, 5);
    expect(next.blocks[1]).toMatchObject({ type: "text", variant: "paragraph", content: [] });
  });

  it("split mid-heading keeps both halves as headings", () => {
    const heading = createHeadingBlock({ level: 2, content: "AB" });
    const next = splitBlock(docWith([heading]), heading.id, 1);
    expect(next.blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(next.blocks[1]).toMatchObject({ type: "heading", level: 2 });
  });

  it("treats inline objects as atomic when splitting", () => {
    const block = createTextBlock({
      content: [
        { type: "text", text: "a" },
        { type: "object", kind: "placeholder", data: { key: "k" } },
        { type: "text", text: "b" },
      ],
    });
    const next = splitBlock(docWith([block]), block.id, 2);
    expect(next.blocks[0]).toMatchObject({
      content: [{ type: "text", text: "a" }, { type: "object", kind: "placeholder", data: { key: "k" } }],
    });
    expect(next.blocks[1]).toMatchObject({ content: [{ type: "text", text: "b" }] });
  });

  it("merges into the previous block, keeping its type and merging boundary text", () => {
    const first = createTextBlock({ content: "Hello " });
    const second = createTextBlock({ variant: "bullet", content: "world" });
    const next = mergeWithPrevious(docWith([first, second]), second.id);
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]).toMatchObject({
      id: first.id,
      variant: "paragraph",
      content: [{ type: "text", text: "Hello world" }],
    });
  });

  it("rejects merging the first block or into non-text blocks", () => {
    const table = createTableBlock({ columnCount: 1, rowCount: 0 });
    const paragraph = createTextBlock();
    expect(() => mergeWithPrevious(docWith([paragraph]), paragraph.id)).toThrow(RangeError);
    expect(() => mergeWithPrevious(docWith([table, paragraph]), paragraph.id)).toThrow(RangeError);
  });
});

describe("indent / outdent", () => {
  it("steps indent within 0..MAX and drops the property at 0", () => {
    const block = createTextBlock();
    const indented = indentBlock(docWith([block]), block.id);
    expect(indented.blocks[0]).toMatchObject({ indent: 1 });

    const outdented = outdentBlock(indented, block.id);
    expect("indent" in outdented.blocks[0]!).toBe(false);

    const stillZero = outdentBlock(outdented, block.id);
    expect("indent" in stillZero.blocks[0]!).toBe(false);
  });

  it("rejects non-text blocks", () => {
    const heading = createHeadingBlock({ level: 1 });
    expect(() => indentBlock(docWith([heading]), heading.id)).toThrow(RangeError);
  });
});

describe("section transforms (D4)", () => {
  function buildDoc() {
    const h1 = createHeadingBlock({ level: 1, content: "A" });
    const p1 = createTextBlock({ content: "a-body" });
    const h2 = createHeadingBlock({ level: 2, content: "A.1" });
    const p2 = createTextBlock({ content: "a1-body" });
    const h1b = createHeadingBlock({ level: 1, content: "B" });
    const h3 = createHeadingBlock({ level: 3, content: "B.deep" });
    const p3 = createTextBlock({ content: "deep-body" });
    return { h1, p1, h2, p2, h1b, h3, p3, doc: docWith([h1, p1, h2, p2, h1b, h3, p3]) };
  }

  it("deleteSection removes the heading and all descendants", () => {
    const { h1, h1b, h3, p3, doc } = buildDoc();
    const next = deleteSection(doc, h1.id);
    expect(ids(next)).toEqual([h1b.id, h3.id, p3.id]);
  });

  it("moveSection re-levels the subtree to fit the drop position", () => {
    const { h1, p1, h2, p2, h1b, h3, p3, doc } = buildDoc();
    // Move section A (H1, with H2 child) inside B.deep (H3 section):
    // implied level is 4 → delta +3; child H2 → clamped level 5... (2+3=5).
    const next = moveSection(doc, h1.id, h3.id);
    expect(ids(next)).toEqual([h1b.id, h3.id, h1.id, p1.id, h2.id, p2.id, p3.id]);
    expect((next.blocks[2] as HeadingBlock).level).toBe(4);
    expect((next.blocks[4] as HeadingBlock).level).toBe(5);
  });

  it("moveSection to the document start re-levels to 1", () => {
    const { h1b, h3, p3, doc } = buildDoc();
    // B.deep is an H3; moved to the top it becomes H1.
    const next = moveSection(doc, h3.id, null);
    expect(ids(next).slice(0, 2)).toEqual([h3.id, p3.id]);
    expect((next.blocks[0] as HeadingBlock).level).toBe(1);
    void h1b;
  });

  it("moveSection clamps re-leveled headings at 6", () => {
    const h5 = createHeadingBlock({ level: 5, content: "outer" });
    const h5child = createHeadingBlock({ level: 6, content: "inner" });
    const mover = createHeadingBlock({ level: 1, content: "mover" });
    const moverChild = createHeadingBlock({ level: 2, content: "mover child" });
    const doc = docWith([h5, h5child, mover, moverChild]);
    // Implied level inside h5child (H6) is clamped to 6 → delta +5; child 2+5=7 → clamp 6.
    const next = moveSection(doc, mover.id, h5child.id);
    expect((next.blocks[2] as HeadingBlock).level).toBe(6);
    expect((next.blocks[3] as HeadingBlock).level).toBe(6);
  });

  it("moveSection refuses to move a section inside itself", () => {
    const { h1, p1, doc } = buildDoc();
    expect(() => moveSection(doc, h1.id, p1.id)).toThrow(RangeError);
  });

  it("duplicateSection deep-copies with fresh ids right after the original", () => {
    const { h1, p1, h2, p2, h1b, doc } = buildDoc();
    const { document: next, newHeadingId } = duplicateSection(doc, h1.id);
    expect(next.blocks).toHaveLength(11);
    expect(next.blocks[4]!.id).toBe(newHeadingId);
    // Copy sits between the original section and B.
    expect(next.blocks[8]!.id).toBe(h1b.id);
    // Fresh ids everywhere; contents equal.
    const originalIds = new Set([h1.id, p1.id, h2.id, p2.id]);
    const copies = next.blocks.slice(4, 8);
    for (const copy of copies) {
      expect(originalIds.has(copy.id)).toBe(false);
    }
    expect(copies.map((block) => (block as HeadingBlock).content ?? null)).toEqual(
      [h1, p1, h2, p2].map((block) => block.content),
    );
  });

  it("section transforms reject non-heading ids", () => {
    const paragraph = createTextBlock();
    const custom = createCustomBlock({ kind: "x" });
    const doc = docWith([paragraph, custom]);
    expect(() => deleteSection(doc, paragraph.id)).toThrow(RangeError);
    expect(() => moveSection(doc, custom.id, null)).toThrow(RangeError);
    expect(() => duplicateSection(doc, paragraph.id)).toThrow(RangeError);
  });
});
