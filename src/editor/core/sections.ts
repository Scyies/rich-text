import type { Block, BlockMeta, HeadingBlock, WealthyDocument } from "./schema";

/**
 * Section derivation (D1, D3).
 *
 * The document is a flat array; sections are NEVER stored. A section is a
 * heading plus every following block until a heading of the same or higher
 * level. These functions are pure — the section tree is a view over the
 * array, recomputed on demand.
 */

export interface Section<TMeta extends BlockMeta = BlockMeta> {
  heading: HeadingBlock<TMeta>;
  /** Blocks directly inside this section (not inside a subsection). */
  blocks: Block<TMeta>[];
  subsections: Section<TMeta>[];
}

export interface SectionTree<TMeta extends BlockMeta = BlockMeta> {
  /** Blocks before the first heading. */
  preamble: Block<TMeta>[];
  sections: Section<TMeta>[];
}

export function getSectionTree<TMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta>,
): SectionTree<TMeta> {
  const tree: SectionTree<TMeta> = { preamble: [], sections: [] };
  const stack: Section<TMeta>[] = [];

  for (const block of document.blocks) {
    if (block.type === "heading") {
      while (stack.length > 0 && stack[stack.length - 1]!.heading.level >= block.level) {
        stack.pop();
      }
      const section: Section<TMeta> = { heading: block, blocks: [], subsections: [] };
      const parent = stack[stack.length - 1];
      if (parent !== undefined) {
        parent.subsections.push(section);
      } else {
        tree.sections.push(section);
      }
      stack.push(section);
    } else {
      const current = stack[stack.length - 1];
      if (current !== undefined) {
        current.blocks.push(block);
      } else {
        tree.preamble.push(block);
      }
    }
  }

  return tree;
}

export function getSection<TMeta extends BlockMeta = BlockMeta>(
  document: WealthyDocument<TMeta>,
  headingId: string,
): Section<TMeta> | null {
  return findInSections(getSectionTree(document).sections, headingId);
}

function findInSections<TMeta extends BlockMeta>(
  sections: Section<TMeta>[],
  headingId: string,
): Section<TMeta> | null {
  for (const section of sections) {
    if (section.heading.id === headingId) {
      return section;
    }
    const nested = findInSections(section.subsections, headingId);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

/**
 * Flat index range of a section: `start` is the heading's index, `end` is
 * exclusive and covers every descendant block. Returns null if `headingId`
 * is not a heading block in the document.
 */
export function getSectionRange(
  document: WealthyDocument<BlockMeta>,
  headingId: string,
): { start: number; end: number } | null {
  const start = document.blocks.findIndex((block) => block.id === headingId);
  if (start === -1) {
    return null;
  }
  const heading = document.blocks[start]!;
  if (heading.type !== "heading") {
    return null;
  }

  let end = start + 1;
  while (end < document.blocks.length) {
    const block = document.blocks[end]!;
    if (block.type === "heading" && block.level <= heading.level) {
      break;
    }
    end += 1;
  }
  return { start, end };
}

/**
 * Level a heading would receive if inserted at flat index `index` (D4):
 * one deeper than the innermost section still open at that position, or 1
 * at the top level.
 */
export function getImpliedLevelAt(document: WealthyDocument<BlockMeta>, index: number): number {
  const stack: number[] = [];
  const upTo = Math.min(Math.max(index, 0), document.blocks.length);
  for (let blockIndex = 0; blockIndex < upTo; blockIndex += 1) {
    const block = document.blocks[blockIndex]!;
    if (block.type === "heading") {
      while (stack.length > 0 && stack[stack.length - 1]! >= block.level) {
        stack.pop();
      }
      stack.push(block.level);
    }
  }
  const innermost = stack[stack.length - 1];
  return innermost === undefined ? 1 : Math.min(innermost + 1, 6);
}
