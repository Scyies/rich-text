import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type IRunOptions,
} from "docx";
import type {
  Align,
  Block,
  BlockMeta,
  CustomBlock,
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
  /** Serialize an inline object to its run text. Default: the label/kind. */
  renderInlineObject?: ((node: InlineObjectNode) => string) | undefined;
  /** Heading-number prefixes are left to Word; this is accepted for parity but unused. */
  headingNumbers?: boolean | undefined;
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
  const has = (type: InlineMark["type"]): boolean => marks.some((mark) => mark.type === type);
  const colorMark = marks.find((mark): mark is Extract<InlineMark, { type: "color" }> => mark.type === "color");
  const color =
    colorMark !== undefined && /^#?[0-9a-fA-F]{6}$/.test(colorMark.token)
      ? colorMark.token.replace(/^#/, "")
      : undefined;
  // link is handled by the caller; highlight tokens have no reliable Word mapping.
  return {
    ...(has("bold") ? { bold: true } : {}),
    ...(has("italic") ? { italics: true } : {}),
    ...(has("underline") ? { underline: {} } : {}),
    ...(has("strikethrough") ? { strike: true } : {}),
    ...(has("code") ? { font: "Consolas" } : {}),
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
    case "custom":
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
