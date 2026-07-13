import { getHeadingNumbers, formatHeadingNumber } from "../core/numbering";
import { resolveImageGroupColumnWidths } from "../core/image-layout";
import { sanitizeLinkHref } from "../core/urls";
import { SEPARATOR_BLOCK_KIND } from "../plugins/separator-core";
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
  /** Resolve host-owned image group entries to URLs. URL entries do not call this. */
  resolveImageContentSource?: ((image: ImageGroupEntry) => string | undefined) | undefined;
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
      return mark.enabled === false ? `<span style="font-weight: normal">${html}</span>` : `<strong>${html}</strong>`;
    case "italic":
      return mark.enabled === false ? `<span style="font-style: normal">${html}</span>` : `<em>${html}</em>`;
    case "underline":
      return mark.enabled === false ? `<span style="display: inline-block; text-decoration: none">${html}</span>` : `<u>${html}</u>`;
    case "strikethrough":
      return mark.enabled === false ? `<span style="display: inline-block; text-decoration: none">${html}</span>` : `<s>${html}</s>`;
    case "code":
      return mark.enabled === false ? `<span style="font-family: inherit">${html}</span>` : `<code>${html}</code>`;
    case "link":
      return sanitizeLinkHref(mark.href) === null ? html : `<a href="${escapeAttribute(mark.href.trim())}">${html}</a>`;
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

function styleAttribute(declarations: Array<string | null | undefined>): string {
  const style = declarations.filter((declaration): declaration is string => declaration !== null && declaration !== undefined);
  return style.length > 0 ? ` style="${style.join(";")}"` : "";
}

function alignStyle(align: string | undefined): string {
  return styleAttribute([align !== undefined ? `text-align:${align}` : null]);
}

function imageBlockUrl(block: ImageBlock, options: HtmlExportOptions): string | undefined {
  return block.source.type === "url" ? block.source.url : options.resolveImageSource?.(block);
}

function imageGroupEntryUrl(entry: ImageGroupEntry, options: HtmlExportOptions): string | undefined {
  return entry.source.type === "url" ? entry.source.url : options.resolveImageContentSource?.(entry);
}

function imageSizeStyle(image: ImageContentBase, honorPercentSize = true): string {
  if (image.size === undefined) {
    return "";
  }
  if (image.size.unit === "percent" && !honorPercentSize) {
    return "";
  }
  const unit = image.size.unit === "percent" ? "%" : "px";
  const declarations = [
    image.size.width !== undefined ? `width:${image.size.width}${unit}` : null,
    image.size.height !== undefined ? `height:${image.size.height}${unit}` : null,
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

function renderImageContent(
  image: ImageContentBase,
  url: string | undefined,
  options: HtmlExportOptions,
  honorPercentSize = true,
): string {
  if (url === undefined || url.length === 0) {
    return "<!-- image block: unresolved source -->";
  }
  const caption =
    image.caption !== undefined
      ? `<figcaption>${renderInline(image.caption, options)}</figcaption>`
      : "";
  return `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(image.altText ?? "")}"${imageSizeStyle(image, honorPercentSize)}>${caption}`;
}

function renderImage(block: ImageBlock, options: HtmlExportOptions): string {
  return `<figure class="wte-image"${alignStyle(block.align)}>${renderImageContent(block, imageBlockUrl(block, options), options)}</figure>`;
}

// Empty draft slots are layout-only state — they never reach the exported output.
function renderImageGroup(block: ImageGroupBlock, options: HtmlExportOptions): string | null {
  const entries = block.images.filter((entry) => entry.source.type !== "empty");
  if (entries.length === 0) {
    return null;
  }
  const widths = resolveImageGroupColumnWidths(entries);
  const rowStyle = styleAttribute([block.gap !== undefined ? `gap:${block.gap}px` : null]);
  const itemAlign = block.align ?? "center";
  const items = entries
    .map((entry, index) => {
      const width = widths[index] ?? 100 / entries.length;
      const itemStyle = styleAttribute([`width:${width}%`, `text-align:${itemAlign}`]);
      return `<figure class="wte-image"${itemStyle}>${renderImageContent(entry, imageGroupEntryUrl(entry, options), options)}</figure>`;
    })
    .join("");
  return `<figure class="wte-image-group"${alignStyle(block.align)}><div class="wte-image-group__row"${rowStyle}>${items}</div></figure>`;
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
      case "imageGroup": {
        const groupHtml = renderImageGroup(block, options);
        if (groupHtml !== null) {
          parts.push(groupHtml);
        }
        break;
      }
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
