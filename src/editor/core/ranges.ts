import { concatInlineContent, getInlineLength, getInlineText, splitInlineContent } from "./inline";
import { createTextBlock } from "./factories";
import { caretAt, orderTextSelection, type TextSelection } from "./selection";
import type { Block, BlockMeta, InlineNode, WealthyDocument } from "./schema";

export interface RangeEditResult<TMeta extends BlockMeta, TDocMeta extends BlockMeta> {
  document: WealthyDocument<TMeta, TDocMeta>;
  selection: TextSelection;
}

function isTopLevelTextBlock<TMeta extends BlockMeta>(
  block: Block<TMeta> | undefined,
): block is Extract<Block<TMeta>, { type: "heading" | "text" }> {
  return block?.type === "heading" || block?.type === "text";
}

function sliceContent(content: InlineNode[], start: number, end: number): InlineNode[] {
  const [, fromStart] = splitInlineContent(content, start);
  const [selected] = splitInlineContent(fromStart, Math.max(0, end - start));
  return selected;
}

/** Deletes a top-level text range as one immutable document operation. */
export function deleteTextRange<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  selection: TextSelection,
): RangeEditResult<TMeta, TDocMeta> {
  const ordered = orderTextSelection(document, selection);
  if (ordered === null || ordered.start.entryId !== undefined || ordered.end.entryId !== undefined) {
    throw new Error("deleteTextRange: only top-level text ranges are supported");
  }
  const startIndex = document.blocks.findIndex((block) => block.id === ordered.start.blockId);
  const endIndex = document.blocks.findIndex((block) => block.id === ordered.end.blockId);
  const startBlock = document.blocks[startIndex];
  const endBlock = document.blocks[endIndex];
  if (!isTopLevelTextBlock(startBlock) || !isTopLevelTextBlock(endBlock)) {
    throw new Error("deleteTextRange: endpoints must be heading or text blocks");
  }

  const [left] = splitInlineContent(startBlock.content, ordered.start.offset);
  const [, right] = splitInlineContent(endBlock.content, ordered.end.offset);
  const mergedContent = concatInlineContent(left, right);
  const mergedBlock = { ...startBlock, content: mergedContent } as Block<TMeta>;
  const blocks = [
    ...document.blocks.slice(0, startIndex),
    mergedBlock,
    ...document.blocks.slice(endIndex + 1),
  ];
  return {
    document: { ...document, blocks },
    selection: caretAt(startBlock.id, getInlineLength(left)),
  };
}

/** Replaces a text range with inline content while retaining the start block. */
export function replaceTextRangeWithInline<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  selection: TextSelection,
  inserted: InlineNode[],
): RangeEditResult<TMeta, TDocMeta> {
  const deleted = deleteTextRange(document, selection);
  const point = deleted.selection.focus;
  const blockIndex = deleted.document.blocks.findIndex((block) => block.id === point.blockId);
  const block = deleted.document.blocks[blockIndex];
  if (!isTopLevelTextBlock(block)) throw new Error("replaceTextRangeWithInline: target is not text-like");
  const [left, right] = splitInlineContent(block.content, point.offset);
  const content = concatInlineContent(concatInlineContent(left, inserted), right);
  const blocks = [...deleted.document.blocks];
  blocks[blockIndex] = { ...block, content } as Block<TMeta>;
  const offset = point.offset + getInlineLength(inserted);
  return { document: { ...deleted.document, blocks }, selection: caretAt(block.id, offset) };
}

export function replaceTextRangeWithBlocks<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  selection: TextSelection,
  inserted: Block<TMeta>[],
  inlineSingleParagraph = true,
): { document: WealthyDocument<TMeta, TDocMeta>; selection: TextSelection | null } {
  const only = inserted.length === 1 ? inserted[0] : undefined;
  if (inlineSingleParagraph && only?.type === "text" && only.variant === "paragraph") {
    return replaceTextRangeWithInline(document, selection, only.content);
  }
  const deleted = deleteTextRange(document, selection);
  if (inserted.length === 0) return deleted;
  const point = deleted.selection.focus;
  const index = deleted.document.blocks.findIndex((block) => block.id === point.blockId);
  const block = deleted.document.blocks[index];
  if (!isTopLevelTextBlock(block)) throw new Error("replaceTextRangeWithBlocks: target is not text-like");
  const [left, right] = splitInlineContent(block.content, point.offset);
  const leftBlock = getInlineLength(left) > 0 ? ({ ...block, content: left } as Block<TMeta>) : null;
  const rightBlock = getInlineLength(right) > 0 ? createTextBlock<TMeta>({ content: right }) : null;
  const replacement = [
    ...(leftBlock === null ? [] : [leftBlock]),
    ...inserted,
    ...(rightBlock === null ? [] : [rightBlock]),
  ];
  const blocks = [...deleted.document.blocks.slice(0, index), ...replacement, ...deleted.document.blocks.slice(index + 1)];
  const lastText = [...inserted].reverse().find(isTopLevelTextBlock);
  const nextSelection = rightBlock !== null
    ? caretAt(rightBlock.id, 0)
    : lastText !== undefined
      ? caretAt(lastText.id, getInlineLength(lastText.content))
      : leftBlock !== null
        ? caretAt(leftBlock.id, getInlineLength(left))
        : null;
  return { document: { ...deleted.document, blocks }, selection: nextSelection };
}

/** Returns a clipped document fragment suitable for clipboard serialization. */
export function extractTextRange<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  selection: TextSelection,
): WealthyDocument<TMeta, TDocMeta> {
  const ordered = orderTextSelection(document, selection);
  if (ordered === null || ordered.start.entryId !== undefined || ordered.end.entryId !== undefined) {
    throw new Error("extractTextRange: only top-level text ranges are supported");
  }
  const startIndex = document.blocks.findIndex((block) => block.id === ordered.start.blockId);
  const endIndex = document.blocks.findIndex((block) => block.id === ordered.end.blockId);
  const startBlock = document.blocks[startIndex];
  const endBlock = document.blocks[endIndex];
  if (!isTopLevelTextBlock(startBlock) || !isTopLevelTextBlock(endBlock)) {
    throw new Error("extractTextRange: endpoints must be heading or text blocks");
  }
  const blocks = document.blocks.slice(startIndex, endIndex + 1).map((block, relativeIndex) => {
    const absoluteIndex = startIndex + relativeIndex;
    if (!isTopLevelTextBlock(block)) return block;
    const start = absoluteIndex === startIndex ? ordered.start.offset : 0;
    const end = absoluteIndex === endIndex ? ordered.end.offset : getInlineLength(block.content);
    return { ...block, content: sliceContent(block.content, start, end) } as Block<TMeta>;
  });
  return { ...document, blocks };
}

export function textRangeToPlainText<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  selection: TextSelection,
): string {
  return extractTextRange(document, selection).blocks
    .map((block) => {
      if (block.type === "heading" || block.type === "text") return getInlineText(block.content);
      if (block.type === "image") return block.altText ?? "";
      if (block.type === "imageGroup") return block.images.map((entry) => entry.altText ?? "").join("\t");
      return "";
    })
    .join("\n");
}
