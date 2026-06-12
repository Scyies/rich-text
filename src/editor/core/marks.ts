import { concatInlineContent, splitInlineContent } from "./inline";
import type { InlineMark, InlineNode } from "./schema";

/**
 * Mark operations over inline ranges (offsets in inline units, see
 * inline.ts). Marks apply to text nodes only — inline objects are atomic
 * and unmarked (D6).
 */

export function markEquals(a: InlineMark, b: InlineMark): boolean {
  if (a.type !== b.type) {
    return false;
  }
  switch (a.type) {
    case "link":
      return b.type === "link" && a.href === b.href;
    case "color":
      return b.type === "color" && a.token === b.token;
    case "highlight":
      return b.type === "highlight" && a.token === b.token;
    default:
      return true;
  }
}

function withoutMarkType(marks: InlineMark[] | undefined, type: InlineMark["type"]): InlineMark[] {
  return (marks ?? []).filter((mark) => mark.type !== type);
}

function mapRange(
  content: InlineNode[],
  start: number,
  end: number,
  mapText: (marks: InlineMark[] | undefined) => InlineMark[],
): InlineNode[] {
  const [left, rest] = splitInlineContent(content, start);
  const [middle, right] = splitInlineContent(rest, end - start);
  const mapped = middle.map((node): InlineNode => {
    if (node.type !== "text") {
      return node;
    }
    const marks = mapText(node.marks);
    return marks.length > 0 ? { ...node, marks } : { type: "text", text: node.text };
  });
  return concatInlineContent(concatInlineContent(left, mapped), right);
}

/** Adds the mark across [start, end), replacing any mark of the same type. */
export function applyMark(content: InlineNode[], start: number, end: number, mark: InlineMark): InlineNode[] {
  if (start >= end) {
    return content;
  }
  return mapRange(content, start, end, (marks) => [...withoutMarkType(marks, mark.type), mark]);
}

export function removeMark(
  content: InlineNode[],
  start: number,
  end: number,
  type: InlineMark["type"],
): InlineNode[] {
  if (start >= end) {
    return content;
  }
  return mapRange(content, start, end, (marks) => withoutMarkType(marks, type));
}

/** True when every text node in [start, end) carries the mark. */
export function rangeHasMark(content: InlineNode[], start: number, end: number, mark: InlineMark): boolean {
  if (start >= end) {
    return false;
  }
  const [, rest] = splitInlineContent(content, start);
  const [middle] = splitInlineContent(rest, end - start);
  const textNodes = middle.filter((node) => node.type === "text");
  if (textNodes.length === 0) {
    return false;
  }
  return textNodes.every(
    (node) => node.type === "text" && (node.marks ?? []).some((candidate) => markEquals(candidate, mark)),
  );
}

/** Removes the mark if the whole range has it, applies it otherwise. */
export function toggleMark(content: InlineNode[], start: number, end: number, mark: InlineMark): InlineNode[] {
  return rangeHasMark(content, start, end, mark)
    ? removeMark(content, start, end, mark.type)
    : applyMark(content, start, end, mark);
}

/** Marks present on every text node in the range (for toolbar active state). */
export function getActiveMarks(content: InlineNode[], start: number, end: number): InlineMark[] {
  if (start >= end) {
    return [];
  }
  const [, rest] = splitInlineContent(content, start);
  const [middle] = splitInlineContent(rest, end - start);
  const textNodes = middle.filter((node): node is Extract<InlineNode, { type: "text" }> => node.type === "text");
  const first = textNodes[0];
  if (first === undefined) {
    return [];
  }
  return (first.marks ?? []).filter((mark) =>
    textNodes.every((node) => (node.marks ?? []).some((candidate) => markEquals(candidate, mark))),
  );
}
