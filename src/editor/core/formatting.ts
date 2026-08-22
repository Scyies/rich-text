import { applyMark, getActiveMarks, removeMark } from "./marks";
import { getSelectedBlockRange, getSelectedTextSlices, type EditorSelection } from "./selection";
import type { Align, Block, BlockMeta, InlineMark, InlineNode, MogulDocument } from "./schema";
import type { DocumentPatch } from "./patches";

export type GetInheritedMarkTypes<TMeta extends BlockMeta = BlockMeta> =
  (block: Block<TMeta>) => ReadonlySet<InlineMark["type"]>;

function rangeContainsText(block: { content: InlineNode[] }, start: number, end: number): boolean {
  let offset = 0;
  for (const node of block.content) {
    const length = node.type === "text" ? node.text.length : 1;
    const overlaps = node.type === "text" && Math.max(start, offset) < Math.min(end, offset + length);
    if (overlaps) return true;
    offset += length;
  }
  return false;
}

export function planToggleMark<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>, selection: EditorSelection, mark: InlineMark,
  getInheritedMarkTypes?: GetInheritedMarkTypes<TMeta>,
): DocumentPatch[] {
  if (selection.type !== "text") return [];
  const slices = (getSelectedTextSlices(document, selection) ?? []).filter(({ block, start, end }) =>
    start < end && rangeContainsText(block, start, end));
  if (slices.length === 0) return [];
  const activeEverywhere = slices.every(({ block, start, end }) =>
    getActiveMarks(block.content, start, end, getInheritedMarkTypes?.(block) ?? new Set()).some((active) => active.type === mark.type));
  const booleanMark = mark.type === "bold" || mark.type === "italic" || mark.type === "underline" || mark.type === "strikethrough" || mark.type === "code";
  return slices.flatMap(({ block, start, end }) => {
    const inherited = getInheritedMarkTypes?.(block) ?? new Set();
    const content = activeEverywhere
      ? (booleanMark && inherited.has(mark.type) ? applyMark(block.content, start, end, { ...mark, enabled: false } as InlineMark) : removeMark(block.content, start, end, mark.type))
      : (booleanMark && inherited.has(mark.type) ? removeMark(block.content, start, end, mark.type) : applyMark(block.content, start, end, mark));
    return content === block.content ? [] : [{ op: "update_block" as const, blockId: block.id, changes: { content } }];
  });
}

export function planSetAlignment<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>, selection: EditorSelection, align: Align,
): DocumentPatch[] {
  let blocks: Block<TMeta>[] = [];
  if (selection.type === "blocks") {
    const range = getSelectedBlockRange(document, selection);
    if (range !== null) blocks = document.blocks.slice(range.start, range.end + 1);
  } else {
    const seen = new Set<string>();
    blocks = (getSelectedTextSlices(document, selection) ?? []).map((slice) => slice.block).filter((block) => !seen.has(block.id) && seen.add(block.id));
  }
  return blocks.flatMap((block) => {
    const supports = block.type === "heading" || block.type === "text" || ((block.type === "image" || block.type === "imageGroup") && align !== "justify");
    return supports && block.align !== align ? [{ op: "update_block" as const, blockId: block.id, changes: { align } }] : [];
  });
}
