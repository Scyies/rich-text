import { describe, expect, it } from "vitest";
import {
  createCustomBlock,
  createEmptyImageGroupBlock,
  createHeadingBlock,
  createImageBlock,
  createImageGroupBlock,
  createTableBlock,
  createTextBlock,
  generateBlockId,
} from "./factories";
import {
  SCHEMA_VERSION,
  type Block,
  type HeadingBlock,
  type ImageBlock,
  type ImageGroupBlock,
  type MogulDocument,
} from "./schema";
import {
  deleteBlock,
  deleteSection,
  duplicateSection,
  indentBlock,
  insertBlockAfter,
  insertImageGroupEntry,
  insertInlineNode,
  mergeWithPrevious,
  moveBlock,
  moveSection,
  outdentBlock,
  pruneEmptyImageSlots,
  removeImageGroupEntry,
  removeInlineNodeAt,
  splitBlock,
  splitImageGroup,
  turnInto,
  updateBlock,
  updateImageGroupEntry,
  updateInlineObjectAt,
} from "./transforms";

function docWith(blocks: Block[]): MogulDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

function ids(document: MogulDocument): string[] {
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

  it("updates image metadata and validates source changes", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const next = updateBlock(docWith([image]), image.id, {
      altText: "Alt",
      caption: [{ type: "text", text: "Caption" }],
      align: "right",
    });
    expect(next.blocks[0]).toMatchObject({ altText: "Alt", caption: [{ type: "text", text: "Caption" }], align: "right" });
    expect(() => updateBlock(docWith([image]), image.id, { source: { type: "url", url: "nope" } })).toThrow();
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

  it("rejects table/image/custom blocks", () => {
    const table = createTableBlock({ columnCount: 1, rowCount: 0 });
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    expect(() => turnInto(docWith([table]), table.id, { type: "text", variant: "paragraph" })).toThrow(RangeError);
    expect(() => turnInto(docWith([image]), image.id, { type: "text", variant: "paragraph" })).toThrow(RangeError);
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

describe("insertInlineNode", () => {
  it("splices an inline object at the offset, leaving text intact", () => {
    const block = createTextBlock({ content: "hello world" });
    const chip = { type: "object" as const, kind: "placeholder", data: { key: "name" } };
    const next = insertInlineNode(docWith([block]), block.id, 6, chip);
    expect((next.blocks[0] as Block & { content: unknown }).content).toEqual([
      { type: "text", text: "hello " },
      chip,
      { type: "text", text: "world" },
    ]);
  });

  it("inserts text nodes and merges with same-marked neighbors", () => {
    const block = createTextBlock({ content: "ab" });
    const next = insertInlineNode(docWith([block]), block.id, 1, { type: "text", text: "X" });
    expect((next.blocks[0] as Block & { content: unknown }).content).toEqual([{ type: "text", text: "aXb" }]);
  });

  it("rejects non-text blocks and out-of-range offsets", () => {
    const table = createTableBlock({ columnCount: 1, rowCount: 0 });
    const chip = { type: "object" as const, kind: "x", data: {} };
    expect(() => insertInlineNode(docWith([table]), table.id, 0, chip)).toThrow(RangeError);
    const block = createTextBlock({ content: "ab" });
    expect(() => insertInlineNode(docWith([block]), block.id, 5, chip)).toThrow(RangeError);
  });
});

describe("updateInlineObjectAt", () => {
  function blockWithChip() {
    return createTextBlock({
      content: [
        { type: "text", text: "Hi " },
        { type: "object", kind: "placeholder", data: { key: "name", label: "Name" }, meta: { src: "a" } },
        { type: "text", text: "!" },
      ],
    });
  }

  it("replaces the object's data in place, keeping kind", () => {
    const block = blockWithChip();
    const next = updateInlineObjectAt(docWith([block]), block.id, 3, { data: { key: "name", value: "Ana" } });
    expect((next.blocks[0] as Block & { content: unknown }).content).toEqual([
      { type: "text", text: "Hi " },
      { type: "object", kind: "placeholder", data: { key: "name", value: "Ana" }, meta: { src: "a" } },
      { type: "text", text: "!" },
    ]);
  });

  it("keeps existing data/meta when not in the patch", () => {
    const block = blockWithChip();
    const next = updateInlineObjectAt(docWith([block]), block.id, 3, { meta: { src: "b" } });
    const chip = (next.blocks[0] as Block & { content: { meta: unknown; data: unknown }[] }).content[1]!;
    expect(chip.meta).toEqual({ src: "b" });
    expect(chip.data).toEqual({ key: "name", label: "Name" });
  });

  it("throws when the offset is not on an inline object", () => {
    const block = blockWithChip();
    expect(() => updateInlineObjectAt(docWith([block]), block.id, 0, { data: {} })).toThrow(RangeError);
  });
});

describe("removeInlineNodeAt", () => {
  it("removes the inline object at the offset, merging neighboring text", () => {
    const block = createTextBlock({
      content: [
        { type: "text", text: "Hi " },
        { type: "object", kind: "placeholder", data: { key: "name" } },
        { type: "text", text: "there" },
      ],
    });
    const next = removeInlineNodeAt(docWith([block]), block.id, 3);
    expect((next.blocks[0] as Block & { content: unknown }).content).toEqual([{ type: "text", text: "Hi there" }]);
  });

  it("throws past the end of the content", () => {
    const block = createTextBlock({ content: "ab" });
    expect(() => removeInlineNodeAt(docWith([block]), block.id, 2)).toThrow(RangeError);
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

describe("image group transforms", () => {
  function group3() {
    return createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" }, caption: "A" },
        { source: { type: "url", url: "https://example.com/b.png" }, caption: "B" },
        { source: { type: "url", url: "https://example.com/c.png" }, caption: "C" },
      ],
    });
  }

  it("inserts an entry after a given entry (null = at the start)", () => {
    const group = group3();
    const doc = docWith([group]);
    const entry = { id: "11111111-1111-4111-8111-111111111111", source: { type: "url" as const, url: "https://example.com/x.png" } };

    const next = insertImageGroupEntry(doc, group.id, group.images[0]!.id, entry);
    const images = (next.blocks[0] as ImageGroupBlock).images;
    expect(images.map((e) => e.id)).toEqual([group.images[0]!.id, entry.id, group.images[1]!.id, group.images[2]!.id]);

    const atStart = insertImageGroupEntry(doc, group.id, null, entry);
    expect((atStart.blocks[0] as ImageGroupBlock).images[0]!.id).toBe(entry.id);
  });

  it("rejects duplicate or unknown entry ids on insert", () => {
    const group = group3();
    const doc = docWith([group]);
    const dup = { id: group.images[0]!.id, source: { type: "url" as const, url: "https://example.com/x.png" } };
    expect(() => insertImageGroupEntry(doc, group.id, null, dup)).toThrow(RangeError);
    const entry = { id: "22222222-2222-4222-8222-222222222222", source: { type: "url" as const, url: "https://example.com/x.png" } };
    expect(() => insertImageGroupEntry(doc, group.id, "nope", entry)).toThrow(RangeError);
  });

  it("updates an entry and rejects non-patchable keys", () => {
    const group = group3();
    const doc = docWith([group]);
    const next = updateImageGroupEntry(doc, group.id, group.images[1]!.id, {
      columnWidth: { value: 40, unit: "percent" },
      caption: [{ type: "text", text: "B2" }],
    });
    const entry = (next.blocks[0] as ImageGroupBlock).images[1]!;
    expect(entry.columnWidth).toEqual({ value: 40, unit: "percent" });
    expect(entry.caption).toEqual([{ type: "text", text: "B2" }]);
    expect(() => updateImageGroupEntry(doc, group.id, group.images[0]!.id, { id: "x" } as never)).toThrow(RangeError);
  });

  it("removes an entry, collapses to an image at one, and deletes at zero", () => {
    const group = group3();
    const doc = docWith([group]);

    // 3 -> 2 stays a group.
    const two = removeImageGroupEntry(doc, group.id, group.images[1]!.id);
    expect((two.blocks[0] as ImageGroupBlock).images.map((e) => e.id)).toEqual([
      group.images[0]!.id,
      group.images[2]!.id,
    ]);

    // 2 -> 1 collapses to a plain image reusing the group's slot id.
    const collapsed = removeImageGroupEntry(two, group.id, group.images[0]!.id);
    const block = collapsed.blocks[0] as ImageBlock;
    expect(block.type).toBe("image");
    expect(block.id).toBe(group.id);
    expect(block.caption).toEqual([{ type: "text", text: "C" }]);

    // Removing the only entry deletes the block.
    const one = createImageGroupBlock({ images: [{ source: { type: "url", url: "https://example.com/a.png" } }] });
    const after = removeImageGroupEntry(docWith([one]), one.id, one.images[0]!.id);
    expect(after.blocks).toHaveLength(0);
  });

  it("splits a group into two, collapsing one-entry sides", () => {
    const group = group3();
    const doc = docWith([group]);

    // Split before the middle entry: left collapses to an image (1), right is a group (2).
    const next = splitImageGroup(doc, group.id, group.images[1]!.id);
    expect(next.blocks).toHaveLength(2);
    const left = next.blocks[0] as ImageBlock;
    const right = next.blocks[1] as ImageGroupBlock;
    expect(left.type).toBe("image");
    expect(left.id).toBe(group.id);
    expect(right.type).toBe("imageGroup");
    expect(right.images.map((e) => e.caption)).toEqual([[{ type: "text", text: "B" }], [{ type: "text", text: "C" }]]);

    expect(() => splitImageGroup(doc, group.id, group.images[0]!.id)).toThrow(RangeError);
  });

  it("rejects image-group transforms on non-group blocks", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const doc = docWith([image]);
    expect(() => removeImageGroupEntry(doc, image.id, "x")).toThrow(RangeError);
    expect(() => splitImageGroup(doc, image.id, "x")).toThrow(RangeError);
  });
});

describe("pruneEmptyImageSlots", () => {
  const filled = (url: string) => ({ id: generateBlockId(), source: { type: "url" as const, url } });
  const empty = () => ({ id: generateBlockId(), source: { type: "empty" as const } });

  it("drops empty slots but keeps the filled images in a partial group", () => {
    const group = createImageGroupBlock({
      images: [filled("https://example.com/a.png"), empty(), filled("https://example.com/b.png")],
    });
    const next = pruneEmptyImageSlots(docWith([group]));
    const result = next.blocks[0] as ImageGroupBlock;
    expect(result.type).toBe("imageGroup");
    expect(result.id).toBe(group.id);
    expect(result.images.map((e) => e.source)).toEqual([
      { type: "url", url: "https://example.com/a.png" },
      { type: "url", url: "https://example.com/b.png" },
    ]);
  });

  it("collapses a group left with one filled image to an image block", () => {
    const group = createImageGroupBlock({
      images: [filled("https://example.com/a.png"), empty()],
      align: "center",
    });
    const next = pruneEmptyImageSlots(docWith([group]));
    const block = next.blocks[0] as ImageBlock;
    expect(block.type).toBe("image");
    expect(block.id).toBe(group.id);
    expect(block.source).toEqual({ type: "url", url: "https://example.com/a.png" });
    expect(block.align).toBe("center");
  });

  it("deletes a fully empty group and leaves other blocks intact", () => {
    const before = createTextBlock({ content: "above" });
    const group = createEmptyImageGroupBlock({ columns: 2 });
    const after = createTextBlock({ content: "below" });
    const next = pruneEmptyImageSlots(docWith([before, group, after]));
    expect(next.blocks.map((b) => b.id)).toEqual([before.id, after.id]);
  });

  it("returns the same document reference when there is nothing to prune", () => {
    const doc = docWith([
      createTextBlock({ content: "x" }),
      createImageGroupBlock({ images: [filled("https://example.com/a.png"), filled("https://example.com/b.png")] }),
    ]);
    expect(pruneEmptyImageSlots(doc)).toBe(doc);
  });

  it("spares the excepted block's empty slots", () => {
    const keep = createEmptyImageGroupBlock({ columns: 2 });
    const drop = createEmptyImageGroupBlock({ columns: 2 });
    const next = pruneEmptyImageSlots(docWith([keep, drop]), { exceptBlockId: keep.id });
    expect(next.blocks.map((b) => b.id)).toEqual([keep.id]);
    expect((next.blocks[0] as ImageGroupBlock).images).toHaveLength(2);
  });
});
