import { describe, expect, it } from "vitest";
import { applyMark, getActiveMarks, rangeHasMark, removeMark, toggleMark } from "./marks";
import type { InlineNode } from "./schema";

const bold = { type: "bold" } as const;
const italic = { type: "italic" } as const;

describe("applyMark / removeMark", () => {
  it("marks a sub-range, splitting text nodes at the boundaries", () => {
    const content: InlineNode[] = [{ type: "text", text: "hello world" }];
    const marked = applyMark(content, 6, 11, bold);
    expect(marked).toEqual([
      { type: "text", text: "hello " },
      { type: "text", text: "world", marks: [bold] },
    ]);
  });

  it("replaces a same-type mark instead of stacking", () => {
    const content: InlineNode[] = [{ type: "text", text: "x", marks: [{ type: "color", token: "red" }] }];
    const marked = applyMark(content, 0, 1, { type: "color", token: "blue" });
    expect(marked).toEqual([{ type: "text", text: "x", marks: [{ type: "color", token: "blue" }] }]);
  });

  it("skips inline objects", () => {
    const content: InlineNode[] = [
      { type: "text", text: "a" },
      { type: "object", kind: "placeholder", data: {} },
      { type: "text", text: "b" },
    ];
    const marked = applyMark(content, 0, 3, bold);
    expect(marked[1]).toEqual({ type: "object", kind: "placeholder", data: {} });
    expect(marked[0]).toMatchObject({ marks: [bold] });
    expect(marked[2]).toMatchObject({ marks: [bold] });
  });

  it("removeMark merges adjacent text nodes back together", () => {
    const content: InlineNode[] = [
      { type: "text", text: "ab", marks: [bold] },
      { type: "text", text: "cd" },
    ];
    expect(removeMark(content, 0, 2, "bold")).toEqual([{ type: "text", text: "abcd" }]);
  });

  it("collapsed ranges are no-ops", () => {
    const content: InlineNode[] = [{ type: "text", text: "abc" }];
    expect(applyMark(content, 1, 1, bold)).toBe(content);
  });
});

describe("toggleMark / rangeHasMark / getActiveMarks", () => {
  it("toggles off only when the whole range is marked", () => {
    const partial: InlineNode[] = [
      { type: "text", text: "ab", marks: [bold] },
      { type: "text", text: "cd" },
    ];
    expect(rangeHasMark(partial, 0, 4, bold)).toBe(false);
    // Partial coverage → applying completes the range.
    expect(toggleMark(partial, 0, 4, bold)).toEqual([{ type: "text", text: "abcd", marks: [bold] }]);
    // Full coverage → toggling removes.
    const full: InlineNode[] = [{ type: "text", text: "abcd", marks: [bold] }];
    expect(toggleMark(full, 0, 4, bold)).toEqual([{ type: "text", text: "abcd" }]);
  });

  it("getActiveMarks returns the intersection across the range", () => {
    const content: InlineNode[] = [
      { type: "text", text: "ab", marks: [bold, italic] },
      { type: "text", text: "cd", marks: [bold] },
    ];
    expect(getActiveMarks(content, 0, 4)).toEqual([bold]);
    expect(getActiveMarks(content, 0, 2)).toEqual([bold, italic]);
    expect(getActiveMarks(content, 1, 1)).toEqual([]);
  });

  it("distinguishes payload-carrying marks by value", () => {
    const content: InlineNode[] = [{ type: "text", text: "x", marks: [{ type: "color", token: "red" }] }];
    expect(rangeHasMark(content, 0, 1, { type: "color", token: "red" })).toBe(true);
    expect(rangeHasMark(content, 0, 1, { type: "color", token: "blue" })).toBe(false);
  });

  it("creates and clears an explicit off override for an inherited mark", () => {
    const inherited = new Set(["bold"] as const);
    const content: InlineNode[] = [{ type: "text", text: "styled by the paragraph" }];

    expect(getActiveMarks(content, 0, 23, inherited)).toEqual([bold]);
    const disabled = toggleMark(content, 0, 23, bold, true);
    expect(disabled).toEqual([
      { type: "text", text: "styled by the paragraph", marks: [{ type: "bold", enabled: false }] },
    ]);
    expect(getActiveMarks(disabled, 0, 23, inherited)).toEqual([]);
    expect(toggleMark(disabled, 0, 23, bold, true)).toEqual(content);
  });
});
