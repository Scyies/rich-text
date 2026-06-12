import type { InlineMark, InlineNode } from "./schema";

/**
 * Inline-content utilities. Offsets are measured in "inline units":
 * each character of a text node is 1 unit, and an atomic inline object
 * (D6) is exactly 1 unit — the cursor treats it as a single character.
 */

/** Placeholder character used when flattening inline objects to plain text. */
export const INLINE_OBJECT_CHAR = "￼";

export function getInlineLength(content: InlineNode[]): number {
  let length = 0;
  for (const node of content) {
    length += node.type === "text" ? node.text.length : 1;
  }
  return length;
}

export function getInlineText(content: InlineNode[]): string {
  let text = "";
  for (const node of content) {
    text += node.type === "text" ? node.text : INLINE_OBJECT_CHAR;
  }
  return text;
}

export function marksEqual(a: InlineMark[] | undefined, b: InlineMark[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((mark, index) => {
    const other = right[index];
    return other !== undefined && JSON.stringify(mark) === JSON.stringify(other);
  });
}

/**
 * Splits inline content at `offset` into [left, right]. Splitting in the
 * middle of a text node splits the node; an inline object always falls
 * entirely on one side (it is atomic). Throws RangeError on out-of-range
 * offsets.
 */
export function splitInlineContent(content: InlineNode[], offset: number): [InlineNode[], InlineNode[]] {
  const total = getInlineLength(content);
  if (!Number.isInteger(offset) || offset < 0 || offset > total) {
    throw new RangeError(`splitInlineContent: offset ${offset} out of range 0..${total}`);
  }

  const left: InlineNode[] = [];
  const right: InlineNode[] = [];
  let consumed = 0;

  for (const node of content) {
    const nodeLength = node.type === "text" ? node.text.length : 1;
    if (consumed + nodeLength <= offset) {
      left.push(node);
    } else if (consumed >= offset) {
      right.push(node);
    } else {
      // Split point falls inside this node — only possible for text nodes.
      if (node.type !== "text") {
        throw new Error("splitInlineContent: unreachable — inline objects have length 1");
      }
      const splitAt = offset - consumed;
      left.push({ ...node, text: node.text.slice(0, splitAt) });
      right.push({ ...node, text: node.text.slice(splitAt) });
    }
    consumed += nodeLength;
  }

  return [normalizeInlineContent(left), normalizeInlineContent(right)];
}

/** Concatenates two inline contents, merging boundary text nodes with equal marks. */
export function concatInlineContent(a: InlineNode[], b: InlineNode[]): InlineNode[] {
  return normalizeInlineContent([...a, ...b]);
}

/** Drops empty text nodes and merges adjacent text nodes carrying identical marks. */
export function normalizeInlineContent(content: InlineNode[]): InlineNode[] {
  const result: InlineNode[] = [];
  for (const node of content) {
    if (node.type === "text" && node.text.length === 0) {
      continue;
    }
    const last = result[result.length - 1];
    if (
      last !== undefined &&
      last.type === "text" &&
      node.type === "text" &&
      marksEqual(last.marks, node.marks)
    ) {
      result[result.length - 1] = { ...last, text: last.text + node.text };
    } else {
      result.push(node);
    }
  }
  return result;
}
