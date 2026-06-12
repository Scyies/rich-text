import { describe, expect, it } from "vitest";
import { createHeadingBlock, createTextBlock, generateBlockId } from "./factories";
import { PatchError, applyPatches } from "./patches";
import { SCHEMA_VERSION, type Block, type TextBlock, type WealthyDocument } from "./schema";

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

describe("applyPatches (D10)", () => {
  it("applies a sequence of patches in order", () => {
    const heading = createHeadingBlock({ level: 1, content: "Facts" });
    const paragraph = createTextBlock({ content: "old text" });
    const doc = docWith([heading, paragraph]);

    const { document: next, applied } = applyPatches(doc, [
      { op: "update_block", blockId: paragraph.id, changes: { content: [{ type: "text", text: "new text" }] } },
      {
        op: "insert_block_after",
        afterBlockId: paragraph.id,
        block: { id: generateBlockId(), type: "text", variant: "bullet", content: [] },
      },
      { op: "turn_into", blockId: paragraph.id, target: { type: "text", variant: "numbered" } },
    ]);

    expect(applied).toHaveLength(3);
    expect(next.blocks).toHaveLength(3);
    expect(next.blocks[1]).toMatchObject({
      variant: "numbered",
      content: [{ type: "text", text: "new text" }],
    });
    expect(next.blocks[2]).toMatchObject({ variant: "bullet" });
  });

  it("generates an id for inserted blocks that omit one", () => {
    const anchor = createTextBlock();
    const { document: next } = applyPatches(docWith([anchor]), [
      { op: "insert_block_after", afterBlockId: anchor.id, block: { type: "text", variant: "paragraph", content: [] } },
    ]);
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[1]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("supports section ops", () => {
    const h1 = createHeadingBlock({ level: 1, content: "A" });
    const p = createTextBlock({ content: "body" });
    const h1b = createHeadingBlock({ level: 1, content: "B" });
    const doc = docWith([h1, p, h1b]);

    const { document: next } = applyPatches(doc, [{ op: "delete_section", headingId: h1.id }]);
    expect(next.blocks.map((block) => block.id)).toEqual([h1b.id]);

    const { document: duplicated } = applyPatches(doc, [{ op: "duplicate_section", headingId: h1.id }]);
    expect(duplicated.blocks).toHaveLength(5);
  });

  it("is atomic: a failing patch mid-sequence leaves the document untouched", () => {
    const paragraph = createTextBlock({ content: "original" });
    const doc = docWith([paragraph]);

    expect(() =>
      applyPatches(doc, [
        { op: "update_block", blockId: paragraph.id, changes: { content: [{ type: "text", text: "changed" }] } },
        { op: "delete_block", blockId: generateBlockId() }, // unknown id → fails
      ]),
    ).toThrow(PatchError);

    expect((doc.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "original" }]);
  });

  it("reports the failing patch index", () => {
    const paragraph = createTextBlock();
    try {
      applyPatches(docWith([paragraph]), [
        { op: "delete_block", blockId: paragraph.id },
        { op: "delete_block", blockId: paragraph.id }, // already deleted
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PatchError);
      expect((error as PatchError).patchIndex).toBe(1);
    }
  });

  it("rejects malformed patches up front (zod)", () => {
    const paragraph = createTextBlock();
    const doc = docWith([paragraph]);
    expect(() => applyPatches(doc, [{ op: "explode" }])).toThrow(PatchError);
    expect(() => applyPatches(doc, "not an array")).toThrow(PatchError);
    expect(() =>
      applyPatches(doc, [{ op: "turn_into", blockId: paragraph.id, target: { type: "heading", level: 9 } }]),
    ).toThrow(PatchError);
  });

  it("rejects patches whose changes would corrupt a block", () => {
    const heading = createHeadingBlock({ level: 1 });
    expect(() =>
      applyPatches(docWith([heading]), [{ op: "update_block", blockId: heading.id, changes: { level: 99 } }]),
    ).toThrow(PatchError);
  });

  it("validates the final document (e.g. duplicate ids via insert)", () => {
    const paragraph = createTextBlock();
    const doc = docWith([paragraph]);
    expect(() =>
      applyPatches(doc, [{ op: "insert_block_after", afterBlockId: null, block: { ...paragraph } }]),
    ).toThrow(PatchError);
  });
});
