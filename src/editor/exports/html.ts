import { getHeadingNumbers, formatHeadingNumber } from "../core/numbering";
import { SEPARATOR_BLOCK_KIND } from "../plugins/separator-core";
import type {
  Block,
  BlockMeta,
  CustomBlock,
  ImageBlock,
  InlineMark,
  InlineNode,
  InlineObjectNode,
  TableBlock,
  TextBlock,
  WealthyDocument,
} from "../core/schema";

/**
 * HTML exporter (D12 — subpath entry `wealthy-text-editor/export-html`).
 *
 * Consumes the pure document model — zero React. Produces clean, semantic
 * HTML: headings, paragraphs, nested lists (grouped from the flat block list
 * by indent), and tables. Custom blocks and inline objects (D5/D6) are opaque
 * to the core, so the host supplies per-`kind` serializers via options; the
 * defaults emit a readable fallback and never throw.
 */

export interface HtmlExportOptions {
  /** Serialize a custom block to HTML. Default: an HTML comment with the kind. */
  renderCustomBlock?: ((block: CustomBlock) => string) | undefined;
  /** Serialize an inline object to HTML. Default: the escaped label/kind. */
  renderInlineObject?: ((node: InlineObjectNode) => string) | undefined;
  /** Resolve host-owned image assets to URLs. URL images do not call this. */
  resolveImageSource?: ((block: ImageBlock) => string | undefined) | undefined;
  /** Prefix headings with computed hierarchical numbers (1., 1.1…). */
  headingNumbers?: boolean | undefined;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replaceAll("'", "&#39;");
}

/** Fixed nesting order so identical mark sets produce identical HTML. */
const MARK_ORDER: InlineMark["type"][] = [
  "link",
  "code",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "color",
  "highlight",
];

function wrapWithMark(html: string, mark: InlineMark): string {
  switch (mark.type) {
    case "bold":
      return `<strong>${html}</strong>`;
    case "italic":
      return `<em>${html}</em>`;
    case "underline":
      return `<u>${html}</u>`;
    case "strikethrough":
      return `<s>${html}</s>`;
    case "code":
      return `<code>${html}</code>`;
    case "link":
      return `<a href="${escapeAttribute(mark.href)}">${html}</a>`;
    case "color":
      return `<span class="wte-color-${escapeAttribute(mark.token)}">${html}</span>`;
    case "highlight":
      return `<mark class="wte-highlight-${escapeAttribute(mark.token)}">${html}</mark>`;
  }
}

function defaultInlineObject(node: InlineObjectNode): string {
  const label = node.data["label"];
  return escapeHtml(typeof label === "string" && label.length > 0 ? label : node.kind);
}

function renderInline(content: InlineNode[], options: HtmlExportOptions): string {
  let html = "";
  for (const node of content) {
    if (node.type === "text") {
      let nodeHtml = escapeHtml(node.text);
      const marks = [...(node.marks ?? [])].sort(
        (a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type),
      );
      for (const mark of marks) {
        nodeHtml = wrapWithMark(nodeHtml, mark);
      }
      html += nodeHtml;
    } else {
      html += options.renderInlineObject?.(node) ?? defaultInlineObject(node);
    }
  }
  return html;
}

function alignStyle(align: string | undefined): string {
  return align !== undefined ? ` style="text-align:${align}"` : "";
}

function imageUrl(block: ImageBlock, options: HtmlExportOptions): string | undefined {
  return block.source.type === "url" ? block.source.url : options.resolveImageSource?.(block);
}

function imageSizeStyle(block: ImageBlock): string {
  if (block.size === undefined) {
    return "";
  }
  const unit = block.size.unit === "percent" ? "%" : "px";
  const declarations = [
    block.size.width !== undefined ? `width:${block.size.width}${unit}` : null,
    block.size.height !== undefined ? `height:${block.size.height}${unit}` : null,
  ].filter(Boolean);
  return declarations.length > 0 ? ` style="${declarations.join(";")}"` : "";
}

function tableColumnWidthStyle(column: TableBlock["columns"][number]): string {
  if (column.width === undefined) {
    return "";
  }
  const unit = column.width.unit === "percent" ? "%" : "px";
  return ` style="width:${column.width.value}${unit}"`;
}

function isListBlock(block: Block): block is TextBlock & { variant: "bullet" | "numbered" } {
  return block.type === "text" && (block.variant === "bullet" || block.variant === "numbered");
}

/**
 * Renders a maximal run of consecutive list blocks as nested `<ul>`/`<ol>`,
 * opening deeper lists inside the current `<li>` (valid HTML nesting) and
 * splitting on a variant change at the same indent.
 */
function renderListRun(items: TextBlock[], options: HtmlExportOptions): string {
  let html = "";
  const stack: Array<{ indent: number; tag: "ul" | "ol" }> = [];

  for (const item of items) {
    const indent = item.indent ?? 0;
    const tag: "ul" | "ol" = item.variant === "numbered" ? "ol" : "ul";

    while (stack.length > 0 && stack[stack.length - 1]!.indent > indent) {
      html += `</li></${stack.pop()!.tag}>`;
    }

    const top = stack[stack.length - 1];
    if (top !== undefined && top.indent === indent) {
      if (top.tag === tag) {
        html += "</li>";
      } else {
        html += `</li></${stack.pop()!.tag}>`;
        html += `<${tag}>`;
        stack.push({ indent, tag });
      }
    } else {
      html += `<${tag}>`;
      stack.push({ indent, tag });
    }
    html += `<li>${renderInline(item.content, options)}`;
  }

  while (stack.length > 0) {
    html += `</li></${stack.pop()!.tag}>`;
  }
  return html;
}

function renderTable(block: TableBlock, options: HtmlExportOptions): string {
  const renderCell = (cell: { blocks: TextBlock[] }): string =>
    cell.blocks.map((b) => renderInline(b.content, options)).join("<br>");

  const rowHtml = (
    row: { cells: Array<{ columnId: string; blocks: TextBlock[] }> },
    cellTag: "td" | "th",
  ): string => {
    const cells = block.columns.map((column) => {
      const cell = row.cells.find((candidate) => candidate.columnId === column.id);
      const align = column.align !== undefined ? ` style="text-align:${column.align}"` : "";
      return `<${cellTag}${align}>${cell !== undefined ? renderCell(cell) : ""}</${cellTag}>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  };

  const rows = [...block.rows];
  const colgroup = `<colgroup>${block.columns
    .map((column) => `<col${tableColumnWidthStyle(column)}>`)
    .join("")}</colgroup>`;
  let html = `<table>${colgroup}`;
  if (block.showHeader && rows.length > 0) {
    html += `<thead>${rowHtml(rows[0]!, "th")}</thead>`;
    rows.shift();
  }
  html += `<tbody>${rows.map((row) => rowHtml(row, "td")).join("")}</tbody></table>`;
  return html;
}

function renderImage(block: ImageBlock, options: HtmlExportOptions): string {
  const url = imageUrl(block, options);
  if (url === undefined || url.length === 0) {
    return "<!-- image block: unresolved source -->";
  }
  const caption =
    block.caption !== undefined
      ? `<figcaption>${renderInline(block.caption, options)}</figcaption>`
      : "";
  return `<figure class="wte-image"${alignStyle(block.align)}><img src="${escapeAttribute(url)}" alt="${escapeAttribute(block.altText ?? "")}"${imageSizeStyle(block)}>${caption}</figure>`;
}

export function exportHtml(document: WealthyDocument<BlockMeta>, options: HtmlExportOptions = {}): string {
  const headingNumbers = options.headingNumbers === true ? getHeadingNumbers(document) : null;
  const parts: string[] = [];
  const blocks = document.blocks;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;

    if (isListBlock(block)) {
      const run: TextBlock[] = [];
      while (index < blocks.length && isListBlock(blocks[index]!)) {
        run.push(blocks[index] as TextBlock);
        index += 1;
      }
      index -= 1; // the for-loop will re-increment
      parts.push(renderListRun(run, options));
      continue;
    }

    switch (block.type) {
      case "heading": {
        const numberPath = headingNumbers?.get(block.id);
        const prefix = numberPath !== undefined ? `${formatHeadingNumber(numberPath)}. ` : "";
        parts.push(`<h${block.level}${alignStyle(block.align)}>${escapeHtml(prefix)}${renderInline(block.content, options)}</h${block.level}>`);
        break;
      }
      case "text":
        parts.push(`<p${alignStyle(block.align)}>${renderInline(block.content, options)}</p>`);
        break;
      case "table":
        parts.push(renderTable(block, options));
        break;
      case "image":
        parts.push(renderImage(block, options));
        break;
      case "custom":
        parts.push(
          options.renderCustomBlock?.(block) ??
            (block.kind === SEPARATOR_BLOCK_KIND
              ? "<hr>"
              : `<!-- custom block: ${escapeHtml(block.kind)} -->`),
        );
        break;
    }
  }

  return parts.join("\n");
}
