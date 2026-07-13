import { describe, expect, it } from "vitest";
import { createHeadingBlock, createImageBlock, createImageGroupBlock, createTextBlock } from "./factories";
import { SCHEMA_VERSION, type WealthyDocument } from "./schema";
import {
  caretAt,
  clampSelection,
  compareSelectionPoints,
  getSelectedTextSlices,
  orderTextSelection,
  selectionsEqual,
  type SelectionPoint,
  type TextSelection,
} from "./selection";

function docWith(blocks: WealthyDocument["blocks"]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

function point(blockId: string, offset: number, entryId?: string): SelectionPoint {
  return { blockId, ...(entryId !== undefined ? { entryId } : {}), offset };
}

describe("document text selection", () => {
  it("creates a direction-preserving collapsed caret", () => {
    expect(caretAt("b1", 3)).toEqual({ type: "text", anchor: point("b1", 3), focus: point("b1", 3) });
    expect(caretAt("b1", 3, "e1").anchor).toEqual(point("b1", 3, "e1"));
  });

  it("compares both independently addressed endpoints", () => {
    const base: TextSelection = { type: "text", anchor: point("b1", 0), focus: point("b2", 1) };
    expect(selectionsEqual(base, { ...base })).toBe(true);
    expect(selectionsEqual(base, { ...base, focus: point("b2", 2) })).toBe(false);
    expect(selectionsEqual(base, { ...base, focus: point("b2", 1, "caption") })).toBe(false);
  });

  it("clamps endpoints independently across blocks", () => {
    const heading = createHeadingBlock({ level: 1, content: "title" });
    const text = createTextBlock({ content: "hello" });
    const doc = docWith([heading, text]);
    expect(clampSelection(doc, { type: "text", anchor: point(heading.id, -2), focus: point(text.id, 99) })).toEqual({
      type: "text",
      anchor: point(heading.id, 0),
      focus: point(text.id, 5),
    });
  });

  it("validates image and image-group caption regions", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" }, caption: "cap" });
    const group = createImageGroupBlock({ images: [{ source: { type: "url", url: "https://example.com/b.png" }, caption: "left" }] });
    const entry = group.images[0]!;
    const doc = docWith([image, group]);
    expect(clampSelection(doc, { type: "text", anchor: point(image.id, 9), focus: point(group.id, 9, entry.id) })).toEqual({
      type: "text",
      anchor: point(image.id, 3),
      focus: point(group.id, 4, entry.id),
    });
    expect(clampSelection(doc, { type: "text", anchor: point(group.id, 0), focus: point(group.id, 1) })).toBeNull();
  });

  it("preserves backward direction while ordering a range", () => {
    const first = createTextBlock({ content: "one" });
    const second = createTextBlock({ content: "two" });
    const doc = docWith([first, second]);
    const selection: TextSelection = { type: "text", anchor: point(second.id, 2), focus: point(first.id, 1) };
    expect(compareSelectionPoints(doc, selection.anchor, selection.focus)).toBeGreaterThan(0);
    expect(orderTextSelection(doc, selection)).toEqual({ start: point(first.id, 1), end: point(second.id, 2), backward: true });
  });

  it("returns slices across text blocks and skips atomic blocks", () => {
    const first = createTextBlock({ content: "first" });
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const last = createHeadingBlock({ level: 2, content: "last" });
    const doc = docWith([first, image, last]);
    const slices = getSelectedTextSlices(doc, { type: "text", anchor: point(first.id, 2), focus: point(last.id, 3) });
    expect(slices?.map(({ block, start, end }) => [block.id, start, end])).toEqual([
      [first.id, 2, 5],
      [last.id, 0, 3],
    ]);
  });
});
