import { getInlineLength } from "./inline";
import type { Block, BlockMeta, InlineNode, WealthyDocument } from "./schema";

/**
 * Selection model (D7): inline text selection lives inside a single block
 * (per-block contenteditable); anything wider is a whole-block selection.
 * Offsets are inline units (see inline.ts).
 */

export interface TextSelection {
  type: "text";
  blockId: string;
  /**
   * Addresses an editable region nested inside the block. Omitted for a
   * block's primary content (heading/text) and for a single image's caption;
   * set to an entry id to target one caption inside an `imageGroup`.
   */
  entryId?: string;
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

export function selectionsEqual(a: EditorSelection | null, b: EditorSelection | null): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || a.type !== b.type) {
    return false;
  }
  if (a.type === "text" && b.type === "text") {
    return a.blockId === b.blockId && a.entryId === b.entryId && a.anchor === b.anchor && a.focus === b.focus;
  }
  if (a.type === "blocks" && b.type === "blocks") {
    return a.anchorBlockId === b.anchorBlockId && a.focusBlockId === b.focusBlockId;
  }
  return false;
}

export function caretAt(blockId: string, offset: number, entryId?: string): TextSelection {
  return {
    type: "text",
    blockId,
    ...(entryId !== undefined ? { entryId } : {}),
    anchor: offset,
    focus: offset,
  };
}

/**
 * The inline content a text selection points at, or null when the
 * (block, entryId) pair is not a valid editable region:
 * - heading/text: the block's own content; invalid with an entryId.
 * - image: the caption; invalid with an entryId.
 * - imageGroup: the matching entry's caption; invalid without an entryId.
 */
function resolveSelectionContent(block: Block<BlockMeta>, entryId: string | undefined): InlineNode[] | null {
  switch (block.type) {
    case "heading":
    case "text":
      return entryId === undefined ? block.content : null;
    case "image":
      return entryId === undefined ? (block.caption ?? []) : null;
    case "imageGroup": {
      if (entryId === undefined) {
        return null;
      }
      const entry = block.images.find((candidate) => candidate.id === entryId);
      return entry === undefined ? null : (entry.caption ?? []);
    }
    default:
      return null;
  }
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
    if (block === undefined) {
      return null;
    }
    const content = resolveSelectionContent(block, selection.entryId);
    if (content === null) {
      return null;
    }
    const length = getInlineLength(content);
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
