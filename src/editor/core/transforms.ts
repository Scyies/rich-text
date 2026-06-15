import { concatInlineContent, getInlineLength, splitInlineContent } from "./inline";
import { generateBlockId } from "./factories";
import { getImpliedLevelAt, getSectionRange } from "./sections";
import {
  blockSchema,
  type Block,
  type BlockMeta,
  type HeadingBlock,
  type HeadingLevel,
  type InlineNode,
  type TextBlock,
  type TextVariant,
  type WealthyDocument,
} from "./schema";

/**
 * Pure document transforms (D1). Every function returns a new document with
 * structural sharing — blocks that did not change are reused by reference.
 * Invalid operations throw and leave no partial state behind.
 */

export const MAX_INDENT = 8;

function requireBlockIndex(document: WealthyDocument<BlockMeta>, blockId: string, operation: string): number {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) {
    throw new RangeError(`${operation}: block not found: ${blockId}`);
  }
  return index;
}

function requireSectionRange(
  document: WealthyDocument<BlockMeta>,
  headingId: string,
  operation: string,
): { start: number; end: number } {
  const range = getSectionRange(document, headingId);
  if (range === null) {
    throw new RangeError(`${operation}: heading not found: ${headingId}`);
  }
  return range;
}

function withBlocks<TMeta extends BlockMeta, TDocMeta extends BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blocks: Block<TMeta>[],
): WealthyDocument<TMeta, TDocMeta> {
  return { ...document, blocks };
}

function isTextLike(block: Block<BlockMeta>): block is HeadingBlock<BlockMeta> | TextBlock<BlockMeta> {
  return block.type === "heading" || block.type === "text";
}

// ---------------------------------------------------------------------------
// Block transforms
// ---------------------------------------------------------------------------

export function insertBlockAfter<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  afterBlockId: string | null,
  block: Block<TMeta>,
): WealthyDocument<TMeta, TDocMeta> {
  if (document.blocks.some((existing) => existing.id === block.id)) {
    throw new RangeError(`insertBlockAfter: duplicate block id: ${block.id}`);
  }
  const index = afterBlockId === null ? -1 : requireBlockIndex(document, afterBlockId, "insertBlockAfter");
  const blocks = [...document.blocks];
  blocks.splice(index + 1, 0, block);
  return withBlocks(document, blocks);
}

const PATCHABLE_KEYS: Record<Block<BlockMeta>["type"], ReadonlySet<string>> = {
  heading: new Set(["level", "align", "content", "meta"]),
  text: new Set(["variant", "indent", "align", "content", "meta"]),
  table: new Set(["columns", "rows", "showHeader", "meta"]),
  image: new Set(["source", "altText", "caption", "size", "align", "meta"]),
  custom: new Set(["kind", "data", "meta"]),
};

/**
 * Shallow-merges `patch` into the block. `id` and `type` are immutable
 * (use turnInto for type changes); unknown keys throw. The merged block is
 * re-validated against the schema so an update can never corrupt the
 * document (e.g. heading level 9).
 */
export function updateBlock<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
  patch: Record<string, unknown>,
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "updateBlock");
  const block = document.blocks[index]!;
  const allowed = PATCHABLE_KEYS[block.type];
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new RangeError(`updateBlock: key "${key}" is not patchable on a ${block.type} block`);
    }
  }
  const merged = blockSchema.parse({ ...block, ...patch }) as Block<TMeta>;
  const blocks = [...document.blocks];
  blocks[index] = merged;
  return withBlocks(document, blocks);
}

export function deleteBlock<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "deleteBlock");
  const blocks = [...document.blocks];
  blocks.splice(index, 1);
  return withBlocks(document, blocks);
}

/** Moves a block after `afterBlockId` (null = to the start of the document). */
export function moveBlock<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
  afterBlockId: string | null,
): WealthyDocument<TMeta, TDocMeta> {
  if (afterBlockId === blockId) {
    throw new RangeError("moveBlock: cannot move a block after itself");
  }
  const index = requireBlockIndex(document, blockId, "moveBlock");
  const blocks = [...document.blocks];
  const [moved] = blocks.splice(index, 1);
  const anchorIndex =
    afterBlockId === null ? -1 : blocks.findIndex((block) => block.id === afterBlockId);
  if (afterBlockId !== null && anchorIndex === -1) {
    throw new RangeError(`moveBlock: anchor block not found: ${afterBlockId}`);
  }
  blocks.splice(anchorIndex + 1, 0, moved!);
  return withBlocks(document, blocks);
}

export type TurnIntoTarget =
  | { type: "heading"; level: HeadingLevel }
  | { type: "text"; variant: TextVariant };

/**
 * Converts a line between heading and text variants (D1/D2: a one-block
 * type change — containment recomputes automatically). Content, id, meta,
 * and align survive; indent survives text→text and is dropped on →heading.
 */
export function turnInto<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
  target: TurnIntoTarget,
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "turnInto");
  const block = document.blocks[index]!;
  if (!isTextLike(block)) {
    throw new RangeError(`turnInto: only heading/text blocks can be converted (got ${block.type})`);
  }

  let converted: Block<TMeta>;
  if (target.type === "heading") {
    converted = {
      id: block.id,
      type: "heading",
      level: target.level,
      ...(block.align !== undefined ? { align: block.align } : {}),
      content: block.content,
      ...(block.meta !== undefined ? { meta: block.meta as TMeta } : {}),
    };
  } else {
    converted = {
      id: block.id,
      type: "text",
      variant: target.variant,
      ...(block.type === "text" && block.indent !== undefined ? { indent: block.indent } : {}),
      ...(block.align !== undefined ? { align: block.align } : {}),
      content: block.content,
      ...(block.meta !== undefined ? { meta: block.meta as TMeta } : {}),
    };
  }

  const blocks = [...document.blocks];
  blocks[index] = converted;
  return withBlocks(document, blocks);
}

/**
 * Splits a text-like block at an inline offset. The remainder moves into a
 * new following block with id `newBlockId`. Splitting at the very end of a
 * heading yields a paragraph (pressing Enter at a heading's end starts body
 * text); any other split keeps the original block type and attrs.
 */
export function splitBlock<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
  offset: number,
  newBlockId: string = generateBlockId(),
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "splitBlock");
  const block = document.blocks[index]!;
  if (!isTextLike(block)) {
    throw new RangeError(`splitBlock: only heading/text blocks can be split (got ${block.type})`);
  }

  const [left, right] = splitInlineContent(block.content, offset);

  let second: Block<TMeta>;
  if (block.type === "heading" && right.length === 0) {
    second = { id: newBlockId, type: "text", variant: "paragraph", content: [] };
  } else if (block.type === "heading") {
    second = { ...block, id: newBlockId, content: right };
  } else {
    second = { ...block, id: newBlockId, content: right };
  }

  const blocks = [...document.blocks];
  blocks.splice(index, 1, { ...block, content: left }, second);
  return withBlocks(document, blocks);
}

/**
 * Merges a text-like block into the previous text-like block. The previous
 * block's type and attrs win; the caret should land at the previous block's
 * old content length (compute it before calling).
 */
export function mergeWithPrevious<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "mergeWithPrevious");
  if (index === 0) {
    throw new RangeError("mergeWithPrevious: block has no previous block");
  }
  const block = document.blocks[index]!;
  const previous = document.blocks[index - 1]!;
  if (!isTextLike(block) || !isTextLike(previous)) {
    throw new RangeError("mergeWithPrevious: both blocks must be heading/text blocks");
  }

  const merged = { ...previous, content: concatInlineContent(previous.content, block.content) };
  const blocks = [...document.blocks];
  blocks.splice(index - 1, 2, merged);
  return withBlocks(document, blocks);
}

/**
 * Splices an inline node (text or atomic object — D6 placeholders,
 * mentions) into a text-like block at an inline offset. The caret belongs
 * at `offset + length(node)` afterwards.
 */
export function insertInlineNode<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
  offset: number,
  node: InlineNode,
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "insertInlineNode");
  const block = document.blocks[index]!;
  if (!isTextLike(block)) {
    throw new RangeError(`insertInlineNode: only heading/text blocks accept inline content (got ${block.type})`);
  }
  const [left, right] = splitInlineContent(block.content, offset);
  const content = concatInlineContent(concatInlineContent(left, [node]), right);
  const blocks = [...document.blocks];
  blocks[index] = { ...block, content };
  return withBlocks(document, blocks);
}

/** Inline length of a node: text length, or 1 for an atomic object. */
export function getInlineNodeLength(node: InlineNode): number {
  return getInlineLength([node]);
}

/**
 * Replaces the inline object that begins at `offset` with one carrying the
 * given `data`/`meta` (each replaced wholesale when provided, otherwise the
 * existing value is kept). The object's `kind` is preserved. Throws if the
 * node at `offset` is not an inline object. This is the chip-editing entry
 * point (D6): the popover edits a placeholder/mention in place.
 */
export function updateInlineObjectAt<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
  offset: number,
  patch: { data?: Record<string, unknown>; meta?: Record<string, unknown> },
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "updateInlineObjectAt");
  const block = document.blocks[index]!;
  if (!isTextLike(block)) {
    throw new RangeError(`updateInlineObjectAt: only heading/text blocks hold inline content (got ${block.type})`);
  }
  const [left, rest] = splitInlineContent(block.content, offset);
  const target = rest[0];
  if (target === undefined || target.type !== "object") {
    throw new RangeError(`updateInlineObjectAt: no inline object at offset ${offset} in block ${blockId}`);
  }
  const nextData = patch.data ?? target.data;
  const nextMeta = patch.meta ?? target.meta;
  const updated: InlineNode = {
    type: "object",
    kind: target.kind,
    data: nextData,
    ...(nextMeta !== undefined ? { meta: nextMeta } : {}),
  };
  const [, right] = splitInlineContent(rest, 1);
  const content = concatInlineContent(concatInlineContent(left, [updated]), right);
  const blocks = [...document.blocks];
  blocks[index] = { ...block, content };
  return withBlocks(document, blocks);
}

/**
 * Removes the single inline node (one inline unit) at `offset` — the chip a
 * popover's `remove()` deletes, or any one atomic object. Throws on an
 * out-of-range offset or a non-text-like block.
 */
export function removeInlineNodeAt<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
  offset: number,
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "removeInlineNodeAt");
  const block = document.blocks[index]!;
  if (!isTextLike(block)) {
    throw new RangeError(`removeInlineNodeAt: only heading/text blocks hold inline content (got ${block.type})`);
  }
  const [left, rest] = splitInlineContent(block.content, offset);
  if (rest.length === 0) {
    throw new RangeError(`removeInlineNodeAt: no inline node at offset ${offset} in block ${blockId}`);
  }
  const [, right] = splitInlineContent(rest, 1);
  const content = concatInlineContent(left, right);
  const blocks = [...document.blocks];
  blocks[index] = { ...block, content };
  return withBlocks(document, blocks);
}

export function indentBlock<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
): WealthyDocument<TMeta, TDocMeta> {
  return shiftIndent(document, blockId, 1);
}

export function outdentBlock<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
): WealthyDocument<TMeta, TDocMeta> {
  return shiftIndent(document, blockId, -1);
}

function shiftIndent<TMeta extends BlockMeta, TDocMeta extends BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  blockId: string,
  delta: number,
): WealthyDocument<TMeta, TDocMeta> {
  const index = requireBlockIndex(document, blockId, "indent/outdent");
  const block = document.blocks[index]!;
  if (block.type !== "text") {
    throw new RangeError(`indent/outdent: only text blocks can be indented (got ${block.type})`);
  }
  const nextIndent = Math.min(Math.max((block.indent ?? 0) + delta, 0), MAX_INDENT);
  const updated: TextBlock<TMeta> =
    nextIndent === 0 ? stripIndent(block) : { ...block, indent: nextIndent };
  const blocks = [...document.blocks];
  blocks[index] = updated;
  return withBlocks(document, blocks);
}

function stripIndent<TMeta extends BlockMeta>(block: TextBlock<TMeta>): TextBlock<TMeta> {
  const { indent: _indent, ...rest } = block;
  return rest;
}

// ---------------------------------------------------------------------------
// Section transforms (derived containment, D3/D4)
// ---------------------------------------------------------------------------

/**
 * Moves a whole section (heading + descendants) after `afterBlockId`
 * (null = to the start). The subtree is re-leveled to fit the drop
 * position (D4): the heading takes the level implied by its new enclosing
 * section, and every descendant heading shifts by the same delta,
 * clamped to 1..6.
 */
export function moveSection<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  headingId: string,
  afterBlockId: string | null,
): WealthyDocument<TMeta, TDocMeta> {
  const range = requireSectionRange(document, headingId, "moveSection");
  const extracted = document.blocks.slice(range.start, range.end);
  const remaining = [...document.blocks.slice(0, range.start), ...document.blocks.slice(range.end)];

  let insertIndex: number;
  if (afterBlockId === null) {
    insertIndex = 0;
  } else {
    if (extracted.some((block) => block.id === afterBlockId)) {
      throw new RangeError("moveSection: cannot move a section inside itself");
    }
    const anchorIndex = remaining.findIndex((block) => block.id === afterBlockId);
    if (anchorIndex === -1) {
      throw new RangeError(`moveSection: anchor block not found: ${afterBlockId}`);
    }
    insertIndex = anchorIndex + 1;
  }

  const remainingDocument = withBlocks(document, remaining);
  const heading = extracted[0] as HeadingBlock<TMeta>;
  const impliedLevel = getImpliedLevelAt(remainingDocument, insertIndex);
  const delta = impliedLevel - heading.level;

  const releveled = extracted.map((block) =>
    block.type === "heading"
      ? { ...block, level: clampLevel(block.level + delta) }
      : block,
  );

  const blocks = [...remaining];
  blocks.splice(insertIndex, 0, ...releveled);
  return withBlocks(document, blocks);
}

function clampLevel(level: number): HeadingLevel {
  return Math.min(Math.max(level, 1), 6) as HeadingLevel;
}

/** Deletes a heading and every block in its section. */
export function deleteSection<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  headingId: string,
): WealthyDocument<TMeta, TDocMeta> {
  const range = requireSectionRange(document, headingId, "deleteSection");
  const blocks = [...document.blocks.slice(0, range.start), ...document.blocks.slice(range.end)];
  return withBlocks(document, blocks);
}

/**
 * Inserts a deep copy of the section immediately after it. Every copied
 * block gets a fresh id (block ids are document-unique); the copy's new
 * heading id is returned alongside the document.
 */
export function duplicateSection<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta, TDocMeta>,
  headingId: string,
): { document: WealthyDocument<TMeta, TDocMeta>; newHeadingId: string } {
  const range = requireSectionRange(document, headingId, "duplicateSection");
  const copies = document.blocks
    .slice(range.start, range.end)
    .map((block) => ({ ...structuredClone(block), id: generateBlockId() }));

  const blocks = [...document.blocks];
  blocks.splice(range.end, 0, ...copies);
  return { document: withBlocks(document, blocks), newHeadingId: copies[0]!.id };
}
