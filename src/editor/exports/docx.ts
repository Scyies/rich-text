import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  type FileChild,
  type IRunOptions,
} from "docx";
import { resolveImageGroupColumnWidths } from "../core/image-layout";
import { isFilledImageGroupEntry } from "../core/schema";
import { SEPARATOR_BLOCK_KIND } from "../plugins/separator-core";
import type {
  Align,
  Block,
  BlockMeta,
  CustomBlock,
  ImageBlock,
  ImageContent,
  ImageGroupBlock,
  HeadingLevel as WteHeadingLevel,
  InlineMark,
  InlineNode,
  InlineObjectNode,
  TableBlock,
  TextBlock,
  WealthyDocument,
} from "../core/schema";

/**
 * docx exporter (D12 — subpath entry `wealthy-text-editor/export-docx`).
 *
 * The only exporter with a heavy dependency (`docx`); it loads solely through
 * this subpath. Consumes the pure document model — zero React. Returns a
 * `docx` `Document`; the caller packs it (`Packer.toBuffer`/`toBlob`).
 *
 * Marks without a Word analogue are best-effort: `code` → monospace run,
 * `color` → applied only when the token is a 6-digit hex, `highlight` → dropped
 * (tokens don't map to Word's named highlights). Custom blocks / inline objects
 * (D5/D6) use host-supplied per-`kind` serializers.
 */

const NUMBERED_REFERENCE = "wte-numbered";

export interface DocxExportOptions {
  /** Serialize a custom block to docx block(s). Default: a plain paragraph with the kind. */
  renderCustomBlock?: ((block: CustomBlock) => FileChild | FileChild[]) | undefined;
  /**
   * Serialize an image block to docx block(s). Hosts can return a Paragraph
   * containing docx's ImageRun after resolving their own asset bytes.
   */
  renderImageBlock?: ((block: ImageBlock) => FileChild | FileChild[] | undefined) | undefined;
  /** Serialize image content into paragraph children safe for table cells, e.g. imageGroup entries. */
  renderImageContent?: ((image: ImageContent) => Paragraph[] | undefined) | undefined;
  /** Serialize an inline object to its run text. Default: the label/kind. */
  renderInlineObject?: ((node: InlineObjectNode) => string) | undefined;
}

const HEADING_BY_LEVEL: Record<WteHeadingLevel, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function alignment(align: Align | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    case "left":
      return AlignmentType.LEFT;
    default:
      return undefined;
  }
}

function runOptionsFromMarks(marks: InlineMark[]): IRunOptions {
  type ToggleMark = Extract<InlineMark, { type: "bold" | "italic" | "underline" | "strikethrough" | "code" }>;
  const toggle = (type: "bold" | "italic" | "underline" | "strikethrough" | "code"): boolean | undefined => {
    const mark = marks.find((candidate): candidate is ToggleMark => candidate.type === type);
    return mark === undefined ? undefined : mark.enabled !== false;
  };
  const bold = toggle("bold");
  const italic = toggle("italic");
  const underline = toggle("underline");
  const strikethrough = toggle("strikethrough");
  const colorMark = marks.find((mark): mark is Extract<InlineMark, { type: "color" }> => mark.type === "color");
  const color =
    colorMark !== undefined && /^#?[0-9a-fA-F]{6}$/.test(colorMark.token)
      ? colorMark.token.replace(/^#/, "")
      : undefined;
  // link is handled by the caller; highlight tokens have no reliable Word mapping.
  return {
    ...(bold !== undefined ? { bold } : {}),
    ...(italic !== undefined ? { italics: italic } : {}),
    ...(underline !== undefined ? { underline: { type: underline ? UnderlineType.SINGLE : UnderlineType.NONE } } : {}),
    ...(strikethrough !== undefined ? { strike: strikethrough } : {}),
    ...(toggle("code") === true ? { font: "Consolas" } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

function inlineToRuns(content: InlineNode[], options: DocxExportOptions): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  for (const node of content) {
    if (node.type === "text") {
      const marks = node.marks ?? [];
      const run = new TextRun({ text: node.text, ...runOptionsFromMarks(marks) });
      const link = marks.find((mark): mark is Extract<InlineMark, { type: "link" }> => mark.type === "link");
      runs.push(link !== undefined ? new ExternalHyperlink({ link: link.href, children: [run] }) : run);
    } else {
      const text = options.renderInlineObject?.(node) ?? defaultInlineObjectText(node);
      runs.push(new TextRun({ text }));
    }
  }
  return runs;
}

function defaultInlineObjectText(node: InlineObjectNode): string {
  const label = node.data["label"];
  return typeof label === "string" && label.length > 0 ? label : node.kind;
}

function textBlockParagraph(block: TextBlock, options: DocxExportOptions): Paragraph {
  const children = inlineToRuns(block.content, options);
  const align = alignment(block.align);
  const indent = block.indent ?? 0;
  if (block.variant === "bullet") {
    return new Paragraph({ children, bullet: { level: indent }, ...(align !== undefined ? { alignment: align } : {}) });
  }
  if (block.variant === "numbered") {
    return new Paragraph({
      children,
      numbering: { reference: NUMBERED_REFERENCE, level: indent },
      ...(align !== undefined ? { alignment: align } : {}),
    });
  }
  return new Paragraph({ children, ...(align !== undefined ? { alignment: align } : {}) });
}

function tableToDocx(block: TableBlock, options: DocxExportOptions): Table {
  const rows = block.rows.map(
    (row) =>
      new TableRow({
        children: block.columns.map((column) => {
          const cell = row.cells.find((candidate) => candidate.columnId === column.id);
          const paragraphs =
            cell !== undefined && cell.blocks.length > 0
              ? cell.blocks.map((b) => textBlockParagraph(b, options))
              : [new Paragraph({ children: [] })];
          return new TableCell({ children: paragraphs });
        }),
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function separatorToDocx(): Paragraph {
  return new Paragraph({
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 6,
        color: "A8B0BA",
        space: 1,
      },
    },
    children: [],
  });
}

function imageSourceLabel(image: ImageContent): string {
  return image.source.type === "url" ? image.source.url : image.source.id;
}

function imageContentToParagraphs(
  image: ImageContent,
  options: DocxExportOptions,
  align?: Align | undefined,
): Paragraph[] {
  const rendered = options.renderImageContent?.(image);
  if (rendered !== undefined) {
    return rendered;
  }

  const docxAlign = alignment(align);
  const label = image.altText !== undefined && image.altText.length > 0 ? image.altText : imageSourceLabel(image);
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: `[image: ${label}]`, italics: true })],
      ...(docxAlign !== undefined ? { alignment: docxAlign } : {}),
    }),
  ];
  if (image.caption !== undefined && image.caption.length > 0) {
    children.push(
      new Paragraph({
        children: inlineToRuns(image.caption, options),
        ...(docxAlign !== undefined ? { alignment: docxAlign } : {}),
      }),
    );
  }
  return children;
}

function imageToDocx(block: ImageBlock, options: DocxExportOptions): FileChild | FileChild[] {
  const rendered = options.renderImageBlock?.(block);
  if (rendered !== undefined) {
    return rendered;
  }

  return imageContentToParagraphs(block, options, block.align);
}

// Empty draft slots never reach the document; an all-empty group emits nothing.
function imageGroupToDocx(block: ImageGroupBlock, options: DocxExportOptions): Table | [] {
  const entries = block.images.filter(isFilledImageGroupEntry);
  if (entries.length === 0) {
    return [];
  }
  const widths = resolveImageGroupColumnWidths(entries);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: entries.map((image, index) => {
          const width = widths[index] ?? 100 / entries.length;
          return new TableCell({
            width: { size: width, type: WidthType.PERCENTAGE },
            borders: NO_BORDERS,
            children: imageContentToParagraphs(image, options, block.align),
          });
        }),
      }),
    ],
  });
}

function blockToDocx(block: Block, options: DocxExportOptions): FileChild | FileChild[] {
  switch (block.type) {
    case "heading": {
      const align = alignment(block.align);
      return new Paragraph({
        children: inlineToRuns(block.content, options),
        heading: HEADING_BY_LEVEL[block.level],
        ...(align !== undefined ? { alignment: align } : {}),
      });
    }
    case "text":
      return textBlockParagraph(block, options);
    case "table":
      return tableToDocx(block, options);
    case "image":
      return imageToDocx(block, options);
    case "imageGroup":
      return imageGroupToDocx(block, options);
    case "custom":
      if (options.renderCustomBlock === undefined && block.kind === SEPARATOR_BLOCK_KIND) {
        return separatorToDocx();
      }
      return (
        options.renderCustomBlock?.(block) ??
        new Paragraph({ children: [new TextRun({ text: `[${block.kind}]`, italics: true })] })
      );
  }
}

export function exportDocx(document: WealthyDocument<BlockMeta>, options: DocxExportOptions = {}): Document {
  const children: FileChild[] = [];
  for (const block of document.blocks) {
    const mapped = blockToDocx(block, options);
    if (Array.isArray(mapped)) {
      children.push(...mapped);
    } else {
      children.push(mapped);
    }
  }

  return new Document({
    numbering: {
      config: [
        {
          reference: NUMBERED_REFERENCE,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [{ children }],
  });
}
