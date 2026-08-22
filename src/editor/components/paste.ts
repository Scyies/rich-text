import { createHeadingBlock, createImageBlock, createTextBlock, generateBlockId } from "../core/factories";
import { createSeparatorBlock } from "../plugins/separator-core";
import { isDurableImageUrl } from "../core/schema";
import type {
  Block,
  HeadingLevel,
  InlineNode,
  TableBlock,
  TableColumn,
  TableRow,
  TextBlock,
  TextVariant,
} from "../core/schema";
import { domToInlineNodes } from "./dom";

/**
 * Rich paste (D11): best-effort clipboard HTML → blocks, with a plain-text
 * fallback. Inverts the structure the HTML exporter produces (and round-trips
 * the editor's own copied HTML, including chips via `data-wte-object`). Inline
 * content reuses `domToInlineNodes`; block structure (headings, lists, tables,
 * separators, paragraphs) is mapped here. Markdown paste is out of scope.
 *
 * This module depends on the DOM (`DOMParser`) but not React, so it lives on
 * the client surface (`mogul-text-editor/react`). In a DOM-less environment
 * `parseHtmlToBlocks` returns `[]` and callers fall back to plain text.
 */

const HEADING_LEVEL: Record<string, HeadingLevel> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

/** Block-level tags handled directly; everything else is treated as a container. */
const BLOCK_TAGS = new Set([
  "P",
  "UL",
  "OL",
  "TABLE",
  "HR",
  "IMG",
  "BLOCKQUOTE",
  "PRE",
  "DIV",
  "SECTION",
  "ARTICLE",
  "FIGURE",
  "HEADER",
  "FOOTER",
  "MAIN",
  "LI",
]);

export function parseHtmlToBlocks(html: string): Block[] {
  if (typeof DOMParser === "undefined") {
    return [];
  }
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const blocks: Block[] = [];
  walkChildren(parsed.body, blocks, 0);
  return blocks;
}

function isBlockElement(element: Element): boolean {
  return HEADING_LEVEL[element.tagName] !== undefined || BLOCK_TAGS.has(element.tagName);
}

function isWhitespaceOnly(content: InlineNode[]): boolean {
  return content.every((node) => node.type === "text" && node.text.trim().length === 0);
}

/**
 * Walks a container's children, flushing runs of loose inline nodes into
 * paragraphs and dispatching block-level elements to their mappers.
 */
function walkChildren(container: Node, out: Block[], indent: number): void {
  let inlineBuffer: Node[] = [];
  const flush = (): void => {
    const content = inlineFromNodes(inlineBuffer);
    inlineBuffer = [];
    // Whitespace between block elements (e.g. the "\n" the HTML exporter
    // inserts between blocks) is formatting, not a paragraph.
    if (content.length > 0 && !isWhitespaceOnly(content)) {
      out.push(createTextBlock({ content }));
    }
  };

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && isBlockElement(node as Element)) {
      flush();
      mapBlock(node as Element, out, indent);
    } else {
      inlineBuffer.push(node);
    }
  }
  flush();
}

function mapBlock(element: Element, out: Block[], indent: number): void {
  const level = HEADING_LEVEL[element.tagName];
  if (level !== undefined) {
    const content = domToInlineNodes(element as HTMLElement);
    out.push(createHeadingBlock({ level, content }));
    return;
  }

  switch (element.tagName) {
    case "IMG": {
      const image = mapImage(element as HTMLImageElement);
      if (image !== null) {
        out.push(image);
      }
      return;
    }
    case "FIGURE": {
      const image = mapFigure(element as HTMLElement);
      if (image !== null) {
        out.push(image);
        return;
      }
      walkChildren(element, out, indent);
      return;
    }
    case "P":
    case "BLOCKQUOTE":
    case "PRE": {
      const image = mapImageOnlyContainer(element as HTMLElement);
      if (image !== null) {
        out.push(image);
        return;
      }
      const content = domToInlineNodes(element as HTMLElement);
      if (content.length > 0) {
        out.push(createTextBlock({ content }));
      }
      return;
    }
    case "UL":
    case "OL":
      mapList(element, out, indent, element.tagName === "OL");
      return;
    case "LI":
      // A stray <li> outside a list — treat its inline content as a paragraph.
      mapList(element.parentElement ?? element, out, indent, false);
      return;
    case "TABLE":
      out.push(mapTable(element as HTMLTableElement));
      return;
    case "HR":
      out.push(createSeparatorBlock());
      return;
    default:
      // DIV / SECTION / ARTICLE / ... - a wrapper; recurse into it.
      walkChildren(element, out, indent);
      return;
  }
}

function mapFigure(figure: HTMLElement): Block | null {
  const image = figure.querySelector("img");
  if (!(image instanceof HTMLImageElement)) {
    return null;
  }
  const figcaption = figure.querySelector("figcaption");
  const caption =
    figcaption instanceof HTMLElement ? omitWhitespaceOnly(domToInlineNodes(figcaption)) : undefined;
  return mapImage(image, caption);
}

function mapImageOnlyContainer(element: HTMLElement): Block | null {
  const images = Array.from(element.querySelectorAll("img"));
  if (images.length !== 1) {
    return null;
  }
  const clone = element.cloneNode(true) as HTMLElement;
  for (const img of Array.from(clone.querySelectorAll("img"))) {
    img.remove();
  }
  if ((clone.textContent ?? "").trim().length > 0) {
    return null;
  }
  return mapImage(images[0]!);
}

function mapImage(image: HTMLImageElement, caption?: InlineNode[] | undefined): Block | null {
  const source = imageSourceFromElement(image);
  if (source === null) {
    return null;
  }
  const width = parseImageDimension(image.getAttribute("width"));
  const height = parseImageDimension(image.getAttribute("height"));
  const altText = image.getAttribute("alt")?.trim();
  return createImageBlock({
    source: { type: "url", url: source },
    ...(altText !== undefined && altText.length > 0 ? { altText } : {}),
    ...(caption !== undefined && caption.length > 0 ? { caption } : {}),
    ...(width !== undefined || height !== undefined
      ? { size: { ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}), unit: "px" } }
      : {}),
  });
}

function imageSourceFromElement(image: HTMLImageElement): string | null {
  const source = image.getAttribute("src")?.trim();
  if (source === undefined || source.length === 0) {
    return null;
  }
  // The document model stores durable http(s) URLs (or host asset ids) only —
  // resolve to an absolute URL and validate it against the same rule the
  // schema enforces, so data:/blob:/file:/ftp:/javascript: never reach it.
  const resolved = resolveAbsoluteUrl(source, image.ownerDocument.baseURI);
  return resolved !== null && isDurableImageUrl(resolved) ? resolved : null;
}

function resolveAbsoluteUrl(value: string, fallbackBase: string): string | null {
  try {
    return new URL(value).href;
  } catch {
    const base = typeof document !== "undefined" ? document.baseURI : fallbackBase;
    try {
      return new URL(value, base).href;
    } catch {
      return null;
    }
  }
}

function parseImageDimension(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function omitWhitespaceOnly(content: InlineNode[]): InlineNode[] | undefined {
  return isWhitespaceOnly(content) ? undefined : content;
}

function mapList(listElement: Element, out: Block[], indent: number, ordered: boolean): void {
  const variant: TextVariant = ordered ? "numbered" : "bullet";
  const lowerAlpha = ordered && (listElement.getAttribute("type")?.toLowerCase() === "a" ||
    /list-style-type\s*:\s*lower-alpha/i.test(listElement.getAttribute("style") ?? ""));
  for (const li of Array.from(listElement.children)) {
    if (li.tagName !== "LI") {
      continue;
    }
    // Split the item into its own inline content vs. nested sublists.
    const inlineNodes: Node[] = [];
    const sublists: Element[] = [];
    for (const child of Array.from(li.childNodes)) {
      const isList =
        child.nodeType === Node.ELEMENT_NODE &&
        ((child as Element).tagName === "UL" || (child as Element).tagName === "OL");
      if (isList) {
        sublists.push(child as Element);
      } else if (
        child.nodeType === Node.ELEMENT_NODE &&
        (child as Element).classList.contains("wte-list-marker")
      ) {
        // Marker generated by exportHtml; the editor computes it from list semantics.
        continue;
      } else {
        inlineNodes.push(child);
      }
    }
    out.push(createTextBlock({ variant, ...(lowerAlpha ? { listMarker: "lower-alpha" as const } : {}), content: inlineFromNodes(inlineNodes), ...(indent > 0 ? { indent } : {}) }));
    for (const sublist of sublists) {
      mapList(sublist, out, indent + 1, sublist.tagName === "OL");
    }
  }
}

const MAX_TABLE_ROWS = 64;
const MAX_TABLE_COLUMNS = 64;
const MAX_TABLE_SPAN = 64;
const MAX_EXPANDED_TABLE_CELLS = MAX_TABLE_ROWS * MAX_TABLE_COLUMNS;

function directTableRows(tableElement: HTMLTableElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  for (const child of Array.from(tableElement.children)) {
    if (child.tagName === "TR") {
      rows.push(child as HTMLTableRowElement);
    } else if (child.tagName === "THEAD" || child.tagName === "TBODY" || child.tagName === "TFOOT") {
      for (const row of Array.from(child.children)) {
        if (row.tagName === "TR") rows.push(row as HTMLTableRowElement);
        if (rows.length >= MAX_TABLE_ROWS) return rows;
      }
    }
    if (rows.length >= MAX_TABLE_ROWS) return rows;
  }
  return rows;
}

function boundedSpan(cell: Element, attribute: "colspan" | "rowspan"): number {
  const parsed = Number.parseInt(cell.getAttribute(attribute) ?? "1", 10);
  return Math.min(MAX_TABLE_SPAN, Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
}

function mapTable(tableElement: HTMLTableElement): TableBlock {
  const rowElements = directTableRows(tableElement);
  // The core intentionally has no merged-cell model. Expand HTML spans into a
  // rectangular grid: content stays in the top-left covered cell and every
  // other covered coordinate becomes an explicit empty cell.
  const grid: InlineNode[][][] = [];
  let expandedCellCount = 0;
  rowElements.forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let columnIndex = 0;
    const cells = Array.from(row.children).filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
    for (const cell of cells) {
      while (columnIndex < MAX_TABLE_COLUMNS && grid[rowIndex]![columnIndex] !== undefined) columnIndex += 1;
      if (columnIndex >= MAX_TABLE_COLUMNS || expandedCellCount >= MAX_EXPANDED_TABLE_CELLS) break;
      const colspan = Math.min(boundedSpan(cell, "colspan"), MAX_TABLE_COLUMNS - columnIndex);
      const rowspan = Math.min(boundedSpan(cell, "rowspan"), MAX_TABLE_ROWS - rowIndex);
      const content = domToInlineNodes(cell as HTMLElement);
      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        grid[targetRow] ??= [];
        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
          if (expandedCellCount >= MAX_EXPANDED_TABLE_CELLS) break;
          const targetColumn = columnIndex + columnOffset;
          if (grid[targetRow]![targetColumn] === undefined) {
            grid[targetRow]![targetColumn] = rowOffset === 0 && columnOffset === 0 ? content : [];
            expandedCellCount += 1;
          }
        }
      }
      columnIndex += colspan;
    }
  });
  const columnCount = Math.min(MAX_TABLE_COLUMNS, Math.max(1, ...grid.map((row) => row.length)));
  const columns: TableColumn[] = Array.from({ length: columnCount }, () => ({ id: generateBlockId() }));

  const firstRow = rowElements[0];
  const firstRowAllHeaders =
    firstRow !== undefined &&
    firstRow.children.length > 0 &&
    Array.from(firstRow.children).every((cell) => cell.tagName === "TH");
  const showHeader = Array.from(tableElement.children).some((child) => child.tagName === "THEAD") || firstRowAllHeaders;

  const rows: TableRow[] = grid.map((gridRow) => ({
    id: generateBlockId(),
    cells: columns.map((column, columnIndex) => ({
      columnId: column.id,
      blocks: [createTextBlock({ content: gridRow[columnIndex] ?? [] })] as TextBlock[],
    })),
  }));

  return { id: generateBlockId(), type: "table", columns, rows, showHeader };
}

/** Runs `domToInlineNodes` over a loose set of nodes by cloning them into a wrapper. */
function inlineFromNodes(nodes: Node[]): InlineNode[] {
  if (nodes.length === 0) {
    return [];
  }
  const owner = nodes[0]!.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  if (owner === null) {
    return [];
  }
  const wrapper = owner.createElement("div");
  for (const node of nodes) {
    wrapper.appendChild(node.cloneNode(true));
  }
  return domToInlineNodes(wrapper);
}

/**
 * Splits plain text into paragraph blocks on newlines (leading/trailing blank
 * lines trimmed). Always returns at least one block so a paste has a target.
 */
export function parsePlainTextToBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[0] === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const blocks = lines.map((line) =>
    createTextBlock({ content: line.length > 0 ? [{ type: "text", text: line }] : [] }),
  );
  return blocks.length > 0 ? blocks : [createTextBlock({ content: [] })];
}

export interface ClipboardPayload {
  html?: string | undefined;
  text?: string | undefined;
}

/**
 * Parses a clipboard payload, preferring HTML and always falling back to plain
 * text (D11). Returns the blocks to splice in at the caret.
 */
export function parseClipboardToBlocks(payload: ClipboardPayload): Block[] {
  if (payload.html !== undefined && payload.html.trim().length > 0) {
    const blocks = parseHtmlToBlocks(payload.html);
    if (blocks.length > 0) {
      return blocks;
    }
  }
  return parsePlainTextToBlocks(payload.text ?? "");
}
