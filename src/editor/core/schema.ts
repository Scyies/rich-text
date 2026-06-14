import { z } from "zod";

/**
 * wealthy-text-editor — core schema (v0.1)
 *
 * Design decisions (see ARCHITECTURE.md, D1–D15):
 * - D1: the document is a FLAT array of blocks. Sections are derived from
 *   heading levels, never stored. No parentBlockId, no children.
 * - D2: every visual line is a block; list items are TextBlocks with
 *   variant "bullet"/"numbered" and an indent level.
 * - D5: every block carries an opaque `meta` bag the library round-trips
 *   untouched and never interprets. Hosts type it via the TMeta generic.
 * - D6: inline content is TextNode (text + fixed mark set) plus atomic
 *   InlineObjectNode (placeholder/mention chips, plugin-rendered).
 * - D9: table cells hold text-variant blocks only — no headings, tables,
 *   or custom blocks inside cells. Widening this later is non-breaking.
 * - D15: the only presentation attrs in core are `align` and `indent`;
 *   everything else (font size, spacing, style roles) belongs to host meta.
 */

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const blockIdSchema = z.uuid();

export const alignSchema = z.enum(["left", "center", "right", "justify"]);
export type Align = z.infer<typeof alignSchema>;

export const metaSchema = z.record(z.string(), z.unknown());
export type BlockMeta = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Inline content (D6)
// ---------------------------------------------------------------------------

export const inlineMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("strikethrough") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("link"), href: z.string().min(1) }),
  z.object({ type: z.literal("color"), token: z.string().min(1) }),
  z.object({ type: z.literal("highlight"), token: z.string().min(1) }),
]);
export type InlineMark = z.infer<typeof inlineMarkSchema>;

export const textNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(inlineMarkSchema).optional(),
});
export type TextNode = z.infer<typeof textNodeSchema>;

/** Atomic inline widget: the cursor treats it as a single character. */
export const inlineObjectNodeSchema = z.object({
  type: z.literal("object"),
  kind: z.string().min(1),
  data: metaSchema,
  meta: metaSchema.optional(),
});
export type InlineObjectNode = z.infer<typeof inlineObjectNodeSchema>;

export const inlineNodeSchema = z.discriminatedUnion("type", [textNodeSchema, inlineObjectNodeSchema]);
export type InlineNode = z.infer<typeof inlineNodeSchema>;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const baseBlockShape = {
  id: blockIdSchema,
  meta: metaSchema.optional(),
};

export interface BaseBlock<TMeta extends BlockMeta = BlockMeta> {
  id: string;
  meta?: TMeta | undefined;
}

export const headingLevelSchema = z.literal([1, 2, 3, 4, 5, 6]);
export type HeadingLevel = z.infer<typeof headingLevelSchema>;

export const headingBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal("heading"),
  level: headingLevelSchema,
  align: alignSchema.optional(),
  content: z.array(inlineNodeSchema),
});

export interface HeadingBlock<TMeta extends BlockMeta = BlockMeta> extends BaseBlock<TMeta> {
  type: "heading";
  level: HeadingLevel;
  align?: Align | undefined;
  content: InlineNode[];
}

export const textVariantSchema = z.enum(["paragraph", "bullet", "numbered"]);
export type TextVariant = z.infer<typeof textVariantSchema>;

export const textBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal("text"),
  variant: textVariantSchema,
  indent: z.int().min(0).optional(),
  align: alignSchema.optional(),
  content: z.array(inlineNodeSchema),
});

export interface TextBlock<TMeta extends BlockMeta = BlockMeta> extends BaseBlock<TMeta> {
  type: "text";
  variant: TextVariant;
  indent?: number | undefined;
  align?: Align | undefined;
  content: InlineNode[];
}

export const tableColumnSchema = z.object({
  id: blockIdSchema,
  align: z.enum(["left", "center", "right"]).optional(),
  width: z
    .object({
      value: z.number().positive(),
      unit: z.enum(["percent", "px"]),
    })
    .optional(),
});
export type TableColumn = z.infer<typeof tableColumnSchema>;

export const tableCellSchema = z.object({
  columnId: blockIdSchema,
  // D9: restricted cell content — text-variant blocks only.
  blocks: z.array(textBlockSchema),
});

export interface TableCell<TMeta extends BlockMeta = BlockMeta> {
  columnId: string;
  blocks: TextBlock<TMeta>[];
}

export const tableRowSchema = z.object({
  id: blockIdSchema,
  cells: z.array(tableCellSchema),
});

export interface TableRow<TMeta extends BlockMeta = BlockMeta> {
  id: string;
  cells: TableCell<TMeta>[];
}

export const tableBlockSchema = z
  .object({
    ...baseBlockShape,
    type: z.literal("table"),
    columns: z.array(tableColumnSchema).min(1),
    rows: z.array(tableRowSchema),
    showHeader: z.boolean(),
  })
  .check((ctx) => {
    const table = ctx.value;
    const columnIds = new Set<string>();
    for (const column of table.columns) {
      if (columnIds.has(column.id)) {
        ctx.issues.push({
          code: "custom",
          message: `Duplicate column id: ${column.id}`,
          input: table,
          path: ["columns"],
        });
      }
      columnIds.add(column.id);
    }
    table.rows.forEach((row, rowIndex) => {
      const seenInRow = new Set<string>();
      row.cells.forEach((cell, cellIndex) => {
        if (!columnIds.has(cell.columnId)) {
          ctx.issues.push({
            code: "custom",
            message: `Cell references unknown column id: ${cell.columnId}`,
            input: table,
            path: ["rows", rowIndex, "cells", cellIndex, "columnId"],
          });
        }
        if (seenInRow.has(cell.columnId)) {
          ctx.issues.push({
            code: "custom",
            message: `Row has more than one cell for column id: ${cell.columnId}`,
            input: table,
            path: ["rows", rowIndex, "cells", cellIndex, "columnId"],
          });
        }
        seenInRow.add(cell.columnId);
      });
    });
  });

export interface TableBlock<TMeta extends BlockMeta = BlockMeta> extends BaseBlock<TMeta> {
  type: "table";
  columns: TableColumn[];
  rows: TableRow<TMeta>[];
  showHeader: boolean;
}

/** Host/plugin-defined block (D5), e.g. Minuta's request_list or signature. */
export const customBlockSchema = z.object({
  ...baseBlockShape,
  type: z.literal("custom"),
  kind: z.string().min(1),
  data: metaSchema,
});

export interface CustomBlock<TMeta extends BlockMeta = BlockMeta> extends BaseBlock<TMeta> {
  type: "custom";
  kind: string;
  data: Record<string, unknown>;
}

export const blockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  textBlockSchema,
  tableBlockSchema,
  customBlockSchema,
]);

export type Block<TMeta extends BlockMeta = BlockMeta> =
  | HeadingBlock<TMeta>
  | TextBlock<TMeta>
  | TableBlock<TMeta>
  | CustomBlock<TMeta>;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const documentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    blocks: z.array(blockSchema),
    meta: metaSchema.optional(),
  })
  .check((ctx) => {
    const seen = new Set<string>();
    ctx.value.blocks.forEach((block, index) => {
      if (seen.has(block.id)) {
        ctx.issues.push({
          code: "custom",
          message: `Duplicate block id: ${block.id}`,
          input: ctx.value,
          path: ["blocks", index, "id"],
        });
      }
      seen.add(block.id);
    });
  });

export interface WealthyDocument<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
> {
  schemaVersion: typeof SCHEMA_VERSION;
  blocks: Block<TBlockMeta>[];
  meta?: TDocMeta | undefined;
}

// Compile-time guarantee that the hand-written generic interfaces stay in
// sync with the Zod schemas at their default instantiation.
type _AssertBlockMatches = z.infer<typeof blockSchema> extends Block ? true : never;
type _AssertDocumentMatches = z.infer<typeof documentSchema> extends WealthyDocument ? true : never;
const _blockMatches: _AssertBlockMatches = true;
const _documentMatches: _AssertDocumentMatches = true;
void _blockMatches;
void _documentMatches;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateDocument(input: unknown): WealthyDocument {
  return documentSchema.parse(input) as WealthyDocument;
}

export function safeValidateDocument(input: unknown):
  | { success: true; document: WealthyDocument }
  | { success: false; error: z.ZodError } {
  const result = documentSchema.safeParse(input);
  return result.success
    ? { success: true, document: result.data as WealthyDocument }
    : { success: false, error: result.error };
}

export function isBlockOfType<TType extends Block["type"]>(
  block: Block,
  type: TType,
): block is Extract<Block, { type: TType }> {
  return block.type === type;
}
