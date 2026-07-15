import {
  SCHEMA_VERSION,
  type Align,
  type Block,
  type BlockMeta,
  type CustomBlock,
  type HeadingBlock,
  type HeadingLevel,
  type ImageAlign,
  type ImageBlock,
  type ImageGroupBlock,
  type ImageGroupColumnWidth,
  type ImageGroupEntry,
  type ImageGroupEntrySource,
  type ImageSize,
  type ImageSource,
  type InlineNode,
  type TableBlock,
  type TableCell,
  type TableRow,
  type TextBlock,
  type TextVariant,
  type MogulDocument,
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

export interface CreateImageBlockInput<TMeta extends BlockMeta = BlockMeta> {
  source: ImageSource;
  altText?: string;
  caption?: InlineNode[] | string;
  size?: ImageSize;
  align?: ImageAlign;
  meta?: TMeta;
}

export function createImageBlock<TMeta extends BlockMeta = BlockMeta>(
  input: CreateImageBlockInput<TMeta>,
): ImageBlock<TMeta> {
  return {
    id: generateBlockId(),
    type: "image",
    source: input.source,
    ...(input.altText !== undefined ? { altText: input.altText } : {}),
    ...(input.caption !== undefined ? { caption: toContent(input.caption) } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
    ...(input.align !== undefined ? { align: input.align } : {}),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };
}

export interface CreateImageGroupEntryInput<TMeta extends BlockMeta = BlockMeta> {
  id?: string;
  source: ImageGroupEntrySource;
  altText?: string;
  caption?: InlineNode[] | string;
  size?: ImageSize;
  columnWidth?: ImageGroupColumnWidth;
  meta?: TMeta;
}

export interface CreateImageGroupBlockInput<TMeta extends BlockMeta = BlockMeta> {
  images: CreateImageGroupEntryInput<TMeta>[];
  align?: ImageAlign;
  gap?: number;
  meta?: TMeta;
}

function createImageGroupEntry<TMeta extends BlockMeta>(
  input: CreateImageGroupEntryInput<TMeta>,
): ImageGroupEntry<TMeta> {
  return {
    id: input.id ?? generateBlockId(),
    source: input.source,
    ...(input.altText !== undefined ? { altText: input.altText } : {}),
    ...(input.caption !== undefined ? { caption: toContent(input.caption) } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
    ...(input.columnWidth !== undefined ? { columnWidth: input.columnWidth } : {}),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };
}

export function createImageGroupBlock<TMeta extends BlockMeta = BlockMeta>(
  input: CreateImageGroupBlockInput<TMeta>,
): ImageGroupBlock<TMeta> {
  if (input.images.length === 0) {
    throw new RangeError("createImageGroupBlock: images must contain at least one entry");
  }

  return {
    id: generateBlockId(),
    type: "imageGroup",
    images: input.images.map((image) => createImageGroupEntry(image)),
    ...(input.align !== undefined ? { align: input.align } : {}),
    ...(input.gap !== undefined ? { gap: input.gap } : {}),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };
}

export interface CreateEmptyImageGroupBlockInput<TMeta extends BlockMeta = BlockMeta> {
  /** Number of empty drop slots to lay out (>= 1). Defaults to 2. */
  columns?: number;
  gap?: number;
  meta?: TMeta;
}

/**
 * Builds an `imageGroup` of empty drop slots — the "image row" layout the user
 * fills by dropping/pasting images into each column. Empty slots are real,
 * persistable draft state ([[image-empty-slots]]); they render as drop targets
 * while editing and are pruned on blur / omitted from exports.
 */
export function createEmptyImageGroupBlock<TMeta extends BlockMeta = BlockMeta>(
  input: CreateEmptyImageGroupBlockInput<TMeta> = {},
): ImageGroupBlock<TMeta> {
  const columns = input.columns ?? 2;
  if (!Number.isInteger(columns) || columns < 1) {
    throw new RangeError("createEmptyImageGroupBlock: columns must be an integer >= 1");
  }
  return createImageGroupBlock<TMeta>({
    images: Array.from({ length: columns }, () => ({ source: { type: "empty" as const } })),
    ...(input.gap !== undefined ? { gap: input.gap } : {}),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  });
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
  | ({ type: "image" } & CreateImageBlockInput<TMeta>)
  | ({ type: "imageGroup" } & CreateImageGroupBlockInput<TMeta>)
  | ({ type: "custom" } & CreateCustomBlockInput<TMeta>);

export function createBlock<TMeta extends BlockMeta = BlockMeta>(input: CreateBlockInput<TMeta>): Block<TMeta> {
  switch (input.type) {
    case "heading":
      return createHeadingBlock(input);
    case "text":
      return createTextBlock(input);
    case "table":
      return createTableBlock(input);
    case "image":
      return createImageBlock(input);
    case "imageGroup":
      return createImageGroupBlock(input);
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
>(): MogulDocument<TBlockMeta, TDocMeta> {
  return {
    schemaVersion: SCHEMA_VERSION,
    blocks: [createTextBlock<TBlockMeta>()],
  };
}

/** Clones clipboard blocks while regenerating every structural id. */
export function cloneBlocksWithFreshIds<TMeta extends BlockMeta>(blocks: Block<TMeta>[]): Block<TMeta>[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "table": {
        const columnIds = new Map(block.columns.map((column) => [column.id, generateBlockId()]));
        return {
          ...block,
          id: generateBlockId(),
          columns: block.columns.map((column) => ({ ...column, id: columnIds.get(column.id)! })),
          rows: block.rows.map((row) => ({
            ...row,
            id: generateBlockId(),
            cells: row.cells.map((cell) => ({
              ...cell,
              columnId: columnIds.get(cell.columnId)!,
              blocks: cell.blocks.map((cellBlock) => ({ ...cellBlock, id: generateBlockId() })),
            })),
          })),
        };
      }
      case "imageGroup":
        return { ...block, id: generateBlockId(), images: block.images.map((image) => ({ ...image, id: generateBlockId() })) };
      default:
        return { ...block, id: generateBlockId() };
    }
  });
}
