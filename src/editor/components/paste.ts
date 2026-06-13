import { createHeadingBlock, createTextBlock, generateBlockId } from "../core/factories";
import { createSeparatorBlock } from "../plugins/separator-core";
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
 * the client surface (`wealthy-text-editor/react`). In a DOM-less environment
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
    case "P":
    case "BLOCKQUOTE":
    case "PRE": {
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
      // DIV / SECTION / ARTICLE / … — a wrapper; recurse into it.
      walkChildren(element, out, indent);
      return;
  }
}

function mapList(listElement: Element, out: Block[], indent: number, ordered: boolean): void {
  const variant: TextVariant = ordered ? "numbered" : "bullet";
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
      } else {
        inlineNodes.push(child);
      }
    }
    out.push(createTextBlock({ variant, content: inlineFromNodes(inlineNodes), ...(indent > 0 ? { indent } : {}) }));
    for (const sublist of sublists) {
      mapList(sublist, out, indent + 1, sublist.tagName === "OL");
    }
  }
}

function mapTable(tableElement: HTMLTableElement): TableBlock {
  const rowElements = Array.from(tableElement.querySelectorAll("tr"));
  const columnCount = Math.max(1, ...rowElements.map((row) => row.children.length));
  const columns: TableColumn[] = Array.from({ length: columnCount }, () => ({ id: generateBlockId() }));

  const firstRow = rowElements[0];
  const firstRowAllHeaders =
    firstRow !== undefined &&
    firstRow.children.length > 0 &&
    Array.from(firstRow.children).every((cell) => cell.tagName === "TH");
  const showHeader = tableElement.querySelector("thead") !== null || firstRowAllHeaders;

  const rows: TableRow[] = rowElements.map((rowElement) => ({
    id: generateBlockId(),
    cells: Array.from(rowElement.children).map((cell, columnIndex) => ({
      columnId: columns[Math.min(columnIndex, columnCount - 1)]!.id,
      // D9: cells hold text-variant blocks only — flatten cell content to one paragraph.
      blocks: [createTextBlock({ content: domToInlineNodes(cell as HTMLElement) })] as TextBlock[],
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
