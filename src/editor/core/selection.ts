import { getInlineLength } from "./inline";
import type { Block, BlockMeta, InlineNode, MogulDocument } from "./schema";

/** An address inside one editable region of a document block. */
export interface SelectionPoint {
  blockId: string;
  /** Entry id for nested editable regions such as an image-group caption. */
  entryId?: string;
  /** Offset in inline units (see inline.ts). */
  offset: number;
}

/**
 * Direction-preserving text range. Anchor is where extension began; focus is
 * the active end. The points may address different top-level text blocks.
 */
export interface TextSelection {
  type: "text";
  anchor: SelectionPoint;
  focus: SelectionPoint;
}

export interface BlockSelection {
  type: "blocks";
  anchorBlockId: string;
  focusBlockId: string;
}

export type EditorSelection = TextSelection | BlockSelection;

export interface OrderedTextSelection {
  start: SelectionPoint;
  end: SelectionPoint;
  backward: boolean;
}

export interface SelectedTextSlice<TMeta extends BlockMeta = BlockMeta> {
  block: Extract<Block<TMeta>, { type: "heading" | "text" }>;
  start: number;
  end: number;
}

export function selectionPointsEqual(a: SelectionPoint, b: SelectionPoint): boolean {
  return a.blockId === b.blockId && a.entryId === b.entryId && a.offset === b.offset;
}

export function isCollapsed(selection: TextSelection): boolean {
  return selectionPointsEqual(selection.anchor, selection.focus);
}

export function selectionsEqual(a: EditorSelection | null, b: EditorSelection | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.type !== b.type) return false;
  if (a.type === "text" && b.type === "text") {
    return selectionPointsEqual(a.anchor, b.anchor) && selectionPointsEqual(a.focus, b.focus);
  }
  if (a.type === "blocks" && b.type === "blocks") {
    return a.anchorBlockId === b.anchorBlockId && a.focusBlockId === b.focusBlockId;
  }
  return false;
}

export function caretAt(blockId: string, offset: number, entryId?: string): TextSelection {
  const point: SelectionPoint = { blockId, ...(entryId !== undefined ? { entryId } : {}), offset };
  return { type: "text", anchor: point, focus: point };
}

/** Returns the inline content addressed by a point, or null for a non-editable region. */
export function resolveSelectionPointContent<TMeta extends BlockMeta>(
  block: Block<TMeta>,
  entryId: string | undefined,
): InlineNode[] | null {
  switch (block.type) {
    case "heading":
    case "text":
      return entryId === undefined ? block.content : null;
    case "image":
      return entryId === undefined ? (block.caption ?? []) : null;
    case "imageGroup": {
      if (entryId === undefined) return null;
      const entry = block.images.find((candidate) => candidate.id === entryId);
      return entry === undefined ? null : (entry.caption ?? []);
    }
    default:
      return null;
  }
}

function clampPoint<TMeta extends BlockMeta, TDocMeta extends BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  point: SelectionPoint,
): SelectionPoint | null {
  const block = document.blocks.find((candidate) => candidate.id === point.blockId);
  if (block === undefined) return null;
  const content = resolveSelectionPointContent(block, point.entryId);
  if (content === null) return null;
  return { ...point, offset: Math.min(Math.max(point.offset, 0), getInlineLength(content)) };
}

/** Clamps both endpoints independently, preserving range direction. */
export function clampSelection<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  selection: EditorSelection | null,
): EditorSelection | null {
  if (selection === null) return null;
  if (selection.type === "text") {
    const anchor = clampPoint(document, selection.anchor);
    const focus = clampPoint(document, selection.focus);
    return anchor === null || focus === null ? null : { type: "text", anchor, focus };
  }
  const anchorExists = document.blocks.some((block) => block.id === selection.anchorBlockId);
  const focusExists = document.blocks.some((block) => block.id === selection.focusBlockId);
  return anchorExists && focusExists ? selection : null;
}

function regionIndex(block: Block, entryId: string | undefined): number {
  if (entryId === undefined) return 0;
  if (block.type !== "imageGroup") return -1;
  return block.images.findIndex((entry) => entry.id === entryId);
}

/** Compares document points in visual document order. */
export function compareSelectionPoints<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  a: SelectionPoint,
  b: SelectionPoint,
): number | null {
  const aIndex = document.blocks.findIndex((block) => block.id === a.blockId);
  const bIndex = document.blocks.findIndex((block) => block.id === b.blockId);
  if (aIndex === -1 || bIndex === -1) return null;
  if (aIndex !== bIndex) return aIndex - bIndex;
  const block = document.blocks[aIndex]!;
  const aRegion = regionIndex(block, a.entryId);
  const bRegion = regionIndex(block, b.entryId);
  if (aRegion === -1 || bRegion === -1) return null;
  return aRegion === bRegion ? a.offset - b.offset : aRegion - bRegion;
}

export function orderTextSelection<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  selection: TextSelection,
): OrderedTextSelection | null {
  const comparison = compareSelectionPoints(document, selection.anchor, selection.focus);
  if (comparison === null) return null;
  return comparison <= 0
    ? { start: selection.anchor, end: selection.focus, backward: false }
      : { start: selection.focus, end: selection.anchor, backward: true };
}

/** The contiguous top-level block range covered by a supported text selection. */
export function getSelectedTextBlockRange<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  selection: TextSelection,
): { start: number; end: number } | null {
  const ordered = orderTextSelection(document, selection);
  if (ordered === null || ordered.start.entryId !== undefined || ordered.end.entryId !== undefined) return null;
  const start = document.blocks.findIndex((block) => block.id === ordered.start.blockId);
  const end = document.blocks.findIndex((block) => block.id === ordered.end.blockId);
  const startBlock = document.blocks[start];
  const endBlock = document.blocks[end];
  if (
    startBlock === undefined || endBlock === undefined ||
    (startBlock.type !== "heading" && startBlock.type !== "text") ||
    (endBlock.type !== "heading" && endBlock.type !== "text")
  ) return null;
  return { start, end };
}

/**
 * Returns inline slices for top-level heading/text ranges. Atomic blocks may
 * lie between slices and remain represented by the enclosing block range.
 */
export function getSelectedTextSlices<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  selection: TextSelection,
): SelectedTextSlice<TMeta>[] | null {
  const ordered = orderTextSelection(document, selection);
  const range = getSelectedTextBlockRange(document, selection);
  if (ordered === null || range === null) return null;
  const { start: startIndex, end: endIndex } = range;

  const slices: SelectedTextSlice<TMeta>[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const block = document.blocks[index];
    if (block?.type !== "heading" && block?.type !== "text") continue;
    const length = getInlineLength(block.content);
    slices.push({
      block,
      start: index === startIndex ? ordered.start.offset : 0,
      end: index === endIndex ? ordered.end.offset : length,
    });
  }
  return slices;
}

/** The contiguous index range [start, end] covered by a block selection. */
export function getSelectedBlockRange<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  selection: BlockSelection,
): { start: number; end: number } | null {
  const anchorIndex = document.blocks.findIndex((block) => block.id === selection.anchorBlockId);
  const focusIndex = document.blocks.findIndex((block) => block.id === selection.focusBlockId);
  if (anchorIndex === -1 || focusIndex === -1) return null;
  return { start: Math.min(anchorIndex, focusIndex), end: Math.max(anchorIndex, focusIndex) };
}
