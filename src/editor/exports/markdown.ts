import { getHeadingNumbers, formatHeadingNumber, getListItemNumbers } from "../core/numbering";
import { SEPARATOR_BLOCK_KIND } from "../plugins/separator-core";
import { sanitizeLinkHref } from "../core/urls";
import type {
  Block,
  BlockMeta,
  CustomBlock,
  ImageBlock,
  ImageContentBase,
  ImageGroupBlock,
  ImageGroupEntry,
  InlineMark,
  InlineNode,
  InlineObjectNode,
  TableBlock,
  TextBlock,
  WealthyDocument,
} from "../core/schema";

/**
 * Markdown exporter (D12 — subpath entry `wealthy-text-editor/export-markdown`).
 *
 * Consumes the pure document model — zero React. Emits GitHub-flavored
 * Markdown: ATX headings, `-`/`1.` lists (indent-nested), GFM marks, and GFM
 * pipe tables. Marks without a Markdown equivalent (underline, highlight) fall
 * back to inline HTML; `color` is dropped (purely visual). Custom blocks and
 * inline objects (D5/D6) use host-supplied per-`kind` serializers.
 *
 * Note: a GFM table always has a header row, so `showHeader: false` cannot be
 * represented — the first row is used as the header either way.
 */

export interface MarkdownExportOptions {
  /** Serialize a custom block. Default: an HTML comment with the kind. */
  renderCustomBlock?: ((block: CustomBlock) => string) | undefined;
  /** Serialize an inline object. Default: the label/kind as plain text. */
  renderInlineObject?: ((node: InlineObjectNode) => string) | undefined;
  /** Resolve host-owned image assets to URLs. URL images do not call this. */
  resolveImageSource?: ((block: ImageBlock) => string | undefined) | undefined;
  /** Resolve host-owned image group entries to URLs. URL entries do not call this. */
  resolveImageContentSource?: ((image: ImageGroupEntry) => string | undefined) | undefined;
  /** Prefix headings with computed hierarchical numbers (1., 1.1…). */
  headingNumbers?: boolean | undefined;
}

/** Backslash-escapes the characters that would otherwise be Markdown syntax. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]]/g, (char) => `\\${char}`);
}

function applyMark(text: string, mark: InlineMark): string {
  if ("enabled" in mark && mark.enabled === false) return text;
  switch (mark.type) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `*${text}*`;
    case "strikethrough":
      return `~~${text}~~`;
    case "code":
      return `\`${text}\``;
    case "link":
      return sanitizeLinkHref(mark.href) === null ? text : `[${text}](${escapeMarkdownUrl(mark.href.trim())})`;
    case "underline":
      return `<u>${text}</u>`;
    case "highlight":
      return `<mark>${text}</mark>`;
    case "color":
      return text; // no Markdown representation — keep the text, drop the color
  }
}

/** code first (innermost, literal), then emphasis, then link (outermost). */
const MARK_ORDER: InlineMark["type"][] = [
  "link",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "highlight",
  "color",
  "code",
];

function defaultInlineObject(node: InlineObjectNode): string {
  const label = node.data["label"];
  return escapeMarkdown(typeof label === "string" && label.length > 0 ? label : node.kind);
}

function renderInline(content: InlineNode[], options: MarkdownExportOptions): string {
  let markdown = "";
  for (const node of content) {
    if (node.type === "text") {
      let text = escapeMarkdown(node.text);
      const marks = [...(node.marks ?? [])].sort(
        (a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type),
      );
      for (const mark of marks) {
        text = applyMark(text, mark);
      }
      markdown += text;
    } else {
      markdown += options.renderInlineObject?.(node) ?? defaultInlineObject(node);
    }
  }
  return markdown;
}

function imageBlockUrl(block: ImageBlock, options: MarkdownExportOptions): string | undefined {
  return block.source.type === "url" ? block.source.url : options.resolveImageSource?.(block);
}

function imageGroupEntryUrl(entry: ImageGroupEntry, options: MarkdownExportOptions): string | undefined {
  return entry.source.type === "url" ? entry.source.url : options.resolveImageContentSource?.(entry);
}

function escapeMarkdownUrl(url: string): string {
  return url.replaceAll(")", "%29").replaceAll(" ", "%20");
}

function isListBlock(block: Block): block is TextBlock & { variant: "bullet" | "numbered" } {
  return block.type === "text" && (block.variant === "bullet" || block.variant === "numbered");
}

function renderListItem(
  block: TextBlock,
  listNumbers: Map<string, number>,
  options: MarkdownExportOptions,
): string {
  const indent = "  ".repeat(block.indent ?? 0);
  const marker = block.variant === "numbered" ? `${listNumbers.get(block.id) ?? 1}.` : "-";
  return `${indent}${marker} ${renderInline(block.content, options)}`;
}

/** Cell text on one line — newlines/pipes are escaped so the row stays intact. */
function renderTableCell(cell: { blocks: TextBlock[] }, options: MarkdownExportOptions): string {
  return cell.blocks
    .map((b) => renderInline(b.content, options))
    .join(" ")
    .replaceAll("|", "\\|");
}

function renderTable(block: TableBlock, options: MarkdownExportOptions): string {
  if (block.rows.length === 0) {
    return "";
  }
  const cellsFor = (row: { cells: Array<{ columnId: string; blocks: TextBlock[] }> }): string[] =>
    block.columns.map((column) => {
      const cell = row.cells.find((candidate) => candidate.columnId === column.id);
      return cell !== undefined ? renderTableCell(cell, options) : "";
    });

  const toRow = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  const header = cellsFor(block.rows[0]!);
  const separator = block.columns.map((column) => {
    switch (column.align) {
      case "center":
        return ":---:";
      case "right":
        return "---:";
      default:
        return "---";
    }
  });

  const lines = [toRow(header), toRow(separator)];
  for (const row of block.rows.slice(1)) {
    lines.push(toRow(cellsFor(row)));
  }
  return lines.join("\n");
}

function renderImageContent(
  image: ImageContentBase,
  url: string | undefined,
  options: MarkdownExportOptions,
): string {
  if (url === undefined || url.length === 0) {
    return "<!-- image block: unresolved source -->";
  }
  const markdown = `![${escapeMarkdown(image.altText ?? "")}](${escapeMarkdownUrl(url)})`;
  return image.caption !== undefined
    ? `${markdown}\n\n${renderInline(image.caption, options)}`
    : markdown;
}

function renderImage(block: ImageBlock, options: MarkdownExportOptions): string {
  return renderImageContent(block, imageBlockUrl(block, options), options);
}

function renderImageGroup(block: ImageGroupBlock, options: MarkdownExportOptions): string {
  // Empty draft slots are dropped; an all-empty group renders nothing and the
  // exporter's blank-part filter removes it.
  return block.images
    .filter((entry) => entry.source.type !== "empty")
    .map((entry) => renderImageContent(entry, imageGroupEntryUrl(entry, options), options))
    .join("\n\n");
}

export function exportMarkdown(
  document: WealthyDocument<BlockMeta>,
  options: MarkdownExportOptions = {},
): string {
  const headingNumbers = options.headingNumbers === true ? getHeadingNumbers(document) : null;
  const listNumbers = getListItemNumbers(document);
  const parts: string[] = [];
  const blocks = document.blocks;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;

    if (isListBlock(block)) {
      const lines: string[] = [];
      while (index < blocks.length && isListBlock(blocks[index]!)) {
        lines.push(renderListItem(blocks[index] as TextBlock, listNumbers, options));
        index += 1;
      }
      index -= 1; // the for-loop will re-increment
      parts.push(lines.join("\n"));
      continue;
    }

    switch (block.type) {
      case "heading": {
        const numberPath = headingNumbers?.get(block.id);
        const prefix = numberPath !== undefined ? `${formatHeadingNumber(numberPath)}. ` : "";
        parts.push(`${"#".repeat(block.level)} ${prefix}${renderInline(block.content, options)}`);
        break;
      }
      case "text":
        parts.push(renderInline(block.content, options));
        break;
      case "table":
        parts.push(renderTable(block, options));
        break;
      case "image":
        parts.push(renderImage(block, options));
        break;
      case "imageGroup":
        parts.push(renderImageGroup(block, options));
        break;
      case "custom":
        parts.push(
          options.renderCustomBlock?.(block) ??
            (block.kind === SEPARATOR_BLOCK_KIND ? "---" : `<!-- custom block: ${block.kind} -->`),
        );
        break;
    }
  }

  return parts.filter((part) => part.length > 0).join("\n\n");
}
