// Schema + types (v0.1)
export {
  SCHEMA_VERSION,
  alignSchema,
  blockIdSchema,
  blockSchema,
  customBlockSchema,
  documentSchema,
  headingBlockSchema,
  headingLevelSchema,
  inlineMarkSchema,
  inlineNodeSchema,
  inlineObjectNodeSchema,
  isBlockOfType,
  metaSchema,
  safeValidateDocument,
  tableBlockSchema,
  tableCellSchema,
  tableColumnSchema,
  tableRowSchema,
  textBlockSchema,
  textNodeSchema,
  textVariantSchema,
  validateDocument,
} from "./editor/core/schema";

export type {
  Align,
  BaseBlock,
  Block,
  BlockMeta,
  CustomBlock,
  HeadingBlock,
  HeadingLevel,
  InlineMark,
  InlineNode,
  InlineObjectNode,
  TableBlock,
  TableCell,
  TableColumn,
  TableRow,
  TextBlock,
  TextNode,
  TextVariant,
  WealthyDocument,
} from "./editor/core/schema";

// Factories
export {
  createBlock,
  createCustomBlock,
  createEmptyDocument,
  createHeadingBlock,
  createTableBlock,
  createTextBlock,
  generateBlockId,
} from "./editor/core/factories";

export type {
  CreateBlockInput,
  CreateCustomBlockInput,
  CreateHeadingBlockInput,
  CreateTableBlockInput,
  CreateTextBlockInput,
} from "./editor/core/factories";

// Serialization
export { deserializeDocument, serializeDocument } from "./editor/core/serialization";
