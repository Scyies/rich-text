import { getSectionTree, type Section } from "./sections";
import type { BlockMeta, WealthyDocument } from "./schema";

/**
 * Computed numbering (D3.3). Numbers are display-only and derived from the
 * section tree / list runs — they are never written into the document.
 */

// ---------------------------------------------------------------------------
// Heading numbering
// ---------------------------------------------------------------------------

/**
 * Number paths for every heading, keyed by heading block id. The path is
 * positional in the section tree (depth = tree depth, not heading level),
 * so an H1 followed by an H3 still numbers 1 / 1.1.
 */
export function getHeadingNumbers(document: WealthyDocument<BlockMeta>): Map<string, number[]> {
  const numbers = new Map<string, number[]>();
  collectHeadingNumbers(getSectionTree(document).sections, [], numbers);
  return numbers;
}

function collectHeadingNumbers(
  sections: Section<BlockMeta>[],
  prefix: number[],
  numbers: Map<string, number[]>,
): void {
  sections.forEach((section, index) => {
    const path = [...prefix, index + 1];
    numbers.set(section.heading.id, path);
    collectHeadingNumbers(section.subsections, path, numbers);
  });
}

export function getHeadingNumberPath(
  document: WealthyDocument<BlockMeta>,
  headingId: string,
): number[] | null {
  return getHeadingNumbers(document).get(headingId) ?? null;
}

/** Formats a number path as a label, e.g. [1, 2, 3] → "1.2.3". */
export function formatHeadingNumber(path: number[]): string {
  return path.join(".");
}

export function getHeadingNumberLabel(
  document: WealthyDocument<BlockMeta>,
  headingId: string,
): string | null {
  const path = getHeadingNumberPath(document, headingId);
  return path === null ? null : formatHeadingNumber(path);
}

// ---------------------------------------------------------------------------
// List numbering
// ---------------------------------------------------------------------------

/**
 * Marker numbers for every numbered text block, keyed by block id.
 *
 * A numbered run at indent level i continues across deeper-indented list
 * blocks (they are nested children) and is broken by: any non-list block,
 * any heading, or a list block at indent <= i that is not a numbered
 * continuation at exactly i.
 */
export function getListItemNumbers(document: WealthyDocument<BlockMeta>): Map<string, number> {
  const numbers = new Map<string, number>();
  // counters[i] = current count of the open numbered run at indent i.
  let counters: number[] = [];

  for (const block of document.blocks) {
    const isListBlock = block.type === "text" && (block.variant === "bullet" || block.variant === "numbered");
    if (!isListBlock) {
      counters = [];
      continue;
    }

    const indent = block.indent ?? 0;
    if (block.variant === "numbered") {
      // Deeper runs end when a shallower-or-equal item appears.
      counters.length = indent + 1;
      counters[indent] = (counters[indent] ?? 0) + 1;
      numbers.set(block.id, counters[indent]!);
    } else {
      // A bullet breaks numbered runs at its own indent and deeper.
      counters.length = indent;
    }
  }

  return numbers;
}

export function getListItemNumber(document: WealthyDocument<BlockMeta>, blockId: string): number | null {
  return getListItemNumbers(document).get(blockId) ?? null;
}
