import { getSectionTree, type Section } from "./sections";
import { MAX_INDENT, type Block, type BlockMeta, type MogulDocument, type OrderedListMarker } from "./schema";

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
export function getHeadingNumbers(document: MogulDocument<BlockMeta>): Map<string, number[]> {
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
  document: MogulDocument<BlockMeta>,
  headingId: string,
): number[] | null {
  return getHeadingNumbers(document).get(headingId) ?? null;
}

/** Formats a number path as a label, e.g. [1, 2, 3] → "1.2.3". */
export function formatHeadingNumber(path: number[]): string {
  return path.join(".");
}

export function getHeadingNumberLabel(
  document: MogulDocument<BlockMeta>,
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
export interface ListMarkerPlanItem {
  blockId: string;
  level: number;
  ordinal: number;
  label: string;
  runId: string;
  marker: OrderedListMarker;
}

function alphabetic(value: number): string {
  let label = "";
  for (let remaining = value; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
    label = String.fromCharCode(97 + ((remaining - 1) % 26)) + label;
  }
  return label;
}

function planScope(blocks: readonly Block<BlockMeta>[], plan: Map<string, ListMarkerPlanItem>, scopeId: string): void {
  let counters: number[] = [];
  let runIds: Array<string | undefined> = [];
  let markers: Array<OrderedListMarker | undefined> = [];
  for (const block of blocks) {
    const isListBlock = block.type === "text" && (block.variant === "bullet" || block.variant === "numbered");
    if (!isListBlock) {
      counters = [];
      runIds = [];
      markers = [];
      continue;
    }

    const indent = Math.min(block.indent ?? 0, MAX_INDENT);
    if (block.variant === "numbered") {
      // Deeper runs end when a shallower-or-equal item appears.
      counters.length = indent + 1;
      runIds.length = indent + 1;
      markers.length = indent + 1;
      const marker = block.listMarker ?? "decimal";
      if (markers[indent] !== undefined && markers[indent] !== marker) {
        counters[indent] = 0;
        runIds[indent] = undefined;
      }
      counters[indent] = (counters[indent] ?? 0) + 1;
      runIds[indent] ??= `${scopeId}:${block.id}`;
      markers[indent] = marker;
      const ordinal = counters[indent]!;
      plan.set(block.id, {
        blockId: block.id, level: indent, ordinal,
        label: marker === "lower-alpha" ? `${alphabetic(ordinal)})` : `${ordinal}.`,
        runId: runIds[indent]!, marker,
      });
    } else {
      // A bullet breaks numbered runs at its own indent and deeper.
      counters.length = indent;
      runIds.length = indent;
      markers.length = indent;
    }
  }
}

export function getListMarkerPlan(document: MogulDocument<BlockMeta>): ReadonlyMap<string, ListMarkerPlanItem> {
  const plan = new Map<string, ListMarkerPlanItem>();
  planScope(document.blocks, plan, "document");
  for (const block of document.blocks) {
    if (block.type !== "table") continue;
    for (const row of block.rows) for (const cell of row.cells) {
      planScope(cell.blocks, plan, `cell:${block.id}:${row.id}:${cell.columnId}`);
    }
  }
  return plan;
}

export function getListItemNumbers(document: MogulDocument<BlockMeta>): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const item of getListMarkerPlan(document).values()) numbers.set(item.blockId, item.ordinal);

  return numbers;
}

export function getListItemNumber(document: MogulDocument<BlockMeta>, blockId: string): number | null {
  return getListItemNumbers(document).get(blockId) ?? null;
}
