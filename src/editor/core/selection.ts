import { getInlineLength } from "./inline";
import type { BlockMeta, WealthyDocument } from "./schema";

/**
 * Selection model (D7): inline text selection lives inside a single block
 * (per-block contenteditable); anything wider is a whole-block selection.
 * Offsets are inline units (see inline.ts).
 */

export interface TextSelection {
  type: "text";
  blockId: string;
  anchor: number;
  focus: number;
}

export interface BlockSelection {
  type: "blocks";
  anchorBlockId: string;
  focusBlockId: string;
}

export type EditorSelection = TextSelection | BlockSelection;

export function isCollapsed(selection: TextSelection): boolean {
  return selection.anchor === selection.focus;
}

export function caretAt(blockId: string, offset: number): TextSelection {
  return { type: "text", blockId, anchor: offset, focus: offset };
}

/**
 * Clamps a selection to the current document: offsets are clamped to the
 * block's content length; selections pointing at missing blocks become null.
 */
export function clampSelection(
  document: WealthyDocument<BlockMeta>,
  selection: EditorSelection | null,
): EditorSelection | null {
  if (selection === null) {
    return null;
  }

  if (selection.type === "text") {
    const block = document.blocks.find((candidate) => candidate.id === selection.blockId);
    if (block === undefined || (block.type !== "heading" && block.type !== "text")) {
      return null;
    }
    const length = getInlineLength(block.content);
    return {
      ...selection,
      anchor: Math.min(Math.max(selection.anchor, 0), length),
      focus: Math.min(Math.max(selection.focus, 0), length),
    };
  }

  const anchorExists = document.blocks.some((block) => block.id === selection.anchorBlockId);
  const focusExists = document.blocks.some((block) => block.id === selection.focusBlockId);
  return anchorExists && focusExists ? selection : null;
}

/**
 * The contiguous index range [start, end] covered by a block selection,
 * or null if either endpoint is missing.
 */
export function getSelectedBlockRange(
  document: WealthyDocument<BlockMeta>,
  selection: BlockSelection,
): { start: number; end: number } | null {
  const anchorIndex = document.blocks.findIndex((block) => block.id === selection.anchorBlockId);
  const focusIndex = document.blocks.findIndex((block) => block.id === selection.focusBlockId);
  if (anchorIndex === -1 || focusIndex === -1) {
    return null;
  }
  return { start: Math.min(anchorIndex, focusIndex), end: Math.max(anchorIndex, focusIndex) };
}
