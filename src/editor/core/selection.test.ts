import { describe, expect, it } from "vitest";
import {
  createHeadingBlock,
  createImageBlock,
  createImageGroupBlock,
  createTextBlock,
} from "./factories";
import { SCHEMA_VERSION, type WealthyDocument } from "./schema";
import { caretAt, clampSelection, selectionsEqual, type TextSelection } from "./selection";

function docWith(blocks: WealthyDocument["blocks"]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

describe("caretAt", () => {
  it("omits entryId when not given and includes it when provided", () => {
    expect(caretAt("b1", 3)).toEqual({ type: "text", blockId: "b1", anchor: 3, focus: 3 });
    expect(caretAt("b1", 3, "e1")).toEqual({
      type: "text",
      blockId: "b1",
      entryId: "e1",
      anchor: 3,
      focus: 3,
    });
  });
});

describe("selectionsEqual", () => {
  it("treats selections with different entryIds as unequal", () => {
    const base: TextSelection = { type: "text", blockId: "b1", anchor: 0, focus: 0 };
    expect(selectionsEqual(base, { ...base })).toBe(true);
    expect(selectionsEqual({ ...base, entryId: "e1" }, { ...base, entryId: "e2" })).toBe(false);
    expect(selectionsEqual({ ...base, entryId: "e1" }, base)).toBe(false);
    expect(selectionsEqual({ ...base, entryId: "e1" }, { ...base, entryId: "e1" })).toBe(true);
  });
});

describe("clampSelection", () => {
  it("accepts heading/text content selections and rejects them when an entryId is present", () => {
    const text = createTextBlock({ content: "hello" });
    const heading = createHeadingBlock({ level: 1, content: "title" });
    const doc = docWith([heading, text]);

    expect(clampSelection(doc, { type: "text", blockId: text.id, anchor: 0, focus: 99 })).toEqual({
      type: "text",
      blockId: text.id,
      anchor: 0,
      focus: 5,
    });
    expect(clampSelection(doc, { type: "text", blockId: heading.id, anchor: 2, focus: 2 })).toEqual({
      type: "text",
      blockId: heading.id,
      anchor: 2,
      focus: 2,
    });
    // A stray entryId on a text block is not a valid region.
    expect(
      clampSelection(doc, { type: "text", blockId: text.id, entryId: "nope", anchor: 0, focus: 1 }),
    ).toBeNull();
  });

  it("accepts a single image's caption selection (no entryId) and clamps to caption length", () => {
    const image = createImageBlock({
      source: { type: "url", url: "https://example.com/a.png" },
      caption: "cap",
    });
    const doc = docWith([image]);

    expect(clampSelection(doc, { type: "text", blockId: image.id, anchor: 1, focus: 99 })).toEqual({
      type: "text",
      blockId: image.id,
      anchor: 1,
      focus: 3,
    });
    // An entryId is invalid on a single image.
    expect(
      clampSelection(doc, { type: "text", blockId: image.id, entryId: "x", anchor: 0, focus: 0 }),
    ).toBeNull();
  });

  it("clamps an empty image caption to length 0", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const doc = docWith([image]);
    expect(clampSelection(doc, { type: "text", blockId: image.id, anchor: 5, focus: 7 })).toEqual({
      type: "text",
      blockId: image.id,
      anchor: 0,
      focus: 0,
    });
  });

  it("requires a matching entryId for image-group caption selections", () => {
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" }, caption: "left" },
        { source: { type: "url", url: "https://example.com/b.png" } },
      ],
    });
    const [first, second] = group.images;
    const doc = docWith([group]);

    // Valid: matching entry, clamped to its caption length ("left" = 4).
    expect(
      clampSelection(doc, { type: "text", blockId: group.id, entryId: first!.id, anchor: 0, focus: 99 }),
    ).toEqual({ type: "text", blockId: group.id, entryId: first!.id, anchor: 0, focus: 4 });
    // Valid: empty caption clamps to 0.
    expect(
      clampSelection(doc, { type: "text", blockId: group.id, entryId: second!.id, anchor: 3, focus: 3 }),
    ).toEqual({ type: "text", blockId: group.id, entryId: second!.id, anchor: 0, focus: 0 });
    // Invalid: no entryId.
    expect(clampSelection(doc, { type: "text", blockId: group.id, anchor: 0, focus: 0 })).toBeNull();
    // Invalid: unknown entryId.
    expect(
      clampSelection(doc, { type: "text", blockId: group.id, entryId: "missing", anchor: 0, focus: 0 }),
    ).toBeNull();
  });

  it("returns null for missing blocks", () => {
    const doc = docWith([createTextBlock({ content: "x" })]);
    expect(clampSelection(doc, { type: "text", blockId: "ghost", anchor: 0, focus: 0 })).toBeNull();
  });
});
