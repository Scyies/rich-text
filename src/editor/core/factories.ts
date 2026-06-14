import {
  SCHEMA_VERSION,
  type Align,
  type Block,
  type BlockMeta,
  type CustomBlock,
  type HeadingBlock,
  type HeadingLevel,
  type InlineNode,
  type TableBlock,
  type TableCell,
  type TableRow,
  type TextBlock,
  type TextVariant,
  type WealthyDocument,
} from "./schema";

export function generateBlockId(): string {
  return crypto.randomUUID();
}

function toContent(content: InlineNode[] | string | undefined): InlineNode[] {
  if (content === undefined) {
    return [];
  }
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  return content;
}

export interface CreateHeadingBlockInput<TMeta extends BlockMeta = BlockMeta> {
  level: HeadingLevel;
  content?: InlineNode[] | string;
  align?: Align;
  meta?: TMeta;
}

export function createHeadingBlock<TMeta extends BlockMeta = BlockMeta>(
  input: CreateHeadingBlockInput<TMeta>,
): HeadingBlock<TMeta> {
  return {
    id: generateBlockId(),
    type: "heading",
    level: input.level,
    ...(input.align !== undefined ? { align: input.align } : {}),
    content: toContent(input.content),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };
}

export interface CreateTextBlockInput<TMeta extends BlockMeta = BlockMeta> {
  variant?: TextVariant;
  content?: InlineNode[] | string;
  indent?: number;
  align?: Align;
  meta?: TMeta;
}

export function createTextBlock<TMeta extends BlockMeta = BlockMeta>(
  input: CreateTextBlockInput<TMeta> = {},
): TextBlock<TMeta> {
  return {
    id: generateBlockId(),
    type: "text",
    variant: input.variant ?? "paragraph",
    ...(input.indent !== undefined ? { indent: input.indent } : {}),
    ...(input.align !== undefined ? { align: input.align } : {}),
    content: toContent(input.content),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };
}

export interface CreateTableBlockInput<TMeta extends BlockMeta = BlockMeta> {
  columnCount: number;
  rowCount: number;
  showHeader?: boolean;
  meta?: TMeta;
}

export function createTableBlock<TMeta extends BlockMeta = BlockMeta>(
  input: CreateTableBlockInput<TMeta>,
): TableBlock<TMeta> {
  if (!Number.isInteger(input.columnCount) || input.columnCount < 1) {
    throw new RangeError("createTableBlock: columnCount must be an integer >= 1");
  }
  if (!Number.isInteger(input.rowCount) || input.rowCount < 0) {
    throw new RangeError("createTableBlock: rowCount must be an integer >= 0");
  }

  const columns = Array.from({ length: input.columnCount }, () => ({ id: generateBlockId() }));
  const rows: TableRow<TMeta>[] = Array.from({ length: input.rowCount }, () => ({
    id: generateBlockId(),
    cells: columns.map(
      (column): TableCell<TMeta> => ({
        columnId: column.id,
        blocks: [createTextBlock<TMeta>()],
      }),
    ),
  }));

  return {
    id: generateBlockId(),
    type: "table",
    columns,
    rows,
    showHeader: input.showHeader ?? true,
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };
}

export interface CreateCustomBlockInput<TMeta extends BlockMeta = BlockMeta> {
  kind: string;
  data?: Record<string, unknown>;
  meta?: TMeta;
}

export function createCustomBlock<TMeta extends BlockMeta = BlockMeta>(
  input: CreateCustomBlockInput<TMeta>,
): CustomBlock<TMeta> {
  return {
    id: generateBlockId(),
    type: "custom",
    kind: input.kind,
    data: input.data ?? {},
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };
}

export type CreateBlockInput<TMeta extends BlockMeta = BlockMeta> =
  | ({ type: "heading" } & CreateHeadingBlockInput<TMeta>)
  | ({ type: "text" } & CreateTextBlockInput<TMeta>)
  | ({ type: "table" } & CreateTableBlockInput<TMeta>)
  | ({ type: "custom" } & CreateCustomBlockInput<TMeta>);

export function createBlock<TMeta extends BlockMeta = BlockMeta>(input: CreateBlockInput<TMeta>): Block<TMeta> {
  switch (input.type) {
    case "heading":
      return createHeadingBlock(input);
    case "text":
      return createTextBlock(input);
    case "table":
      return createTableBlock(input);
    case "custom":
      return createCustomBlock(input);
  }
}

/**
 * An empty document still contains one empty paragraph: in the flat-line
 * model (D1/D2) the editor always has at least one line to put a caret on.
 */
export function createEmptyDocument<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
>(): WealthyDocument<TBlockMeta, TDocMeta> {
  return {
    schemaVersion: SCHEMA_VERSION,
    blocks: [createTextBlock<TBlockMeta>()],
  };
}
