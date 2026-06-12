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

// Inline utilities
export {
  INLINE_OBJECT_CHAR,
  concatInlineContent,
  getInlineLength,
  getInlineText,
  marksEqual,
  normalizeInlineContent,
  splitInlineContent,
} from "./editor/core/inline";

// Sections (derived containment, D1/D3)
export { getImpliedLevelAt, getSection, getSectionRange, getSectionTree } from "./editor/core/sections";
export type { Section, SectionTree } from "./editor/core/sections";

// Numbering (computed, display-only)
export {
  formatHeadingNumber,
  getHeadingNumberLabel,
  getHeadingNumberPath,
  getHeadingNumbers,
  getListItemNumber,
  getListItemNumbers,
} from "./editor/core/numbering";

// Transforms (pure)
export {
  MAX_INDENT,
  deleteBlock,
  deleteSection,
  duplicateSection,
  indentBlock,
  insertBlockAfter,
  mergeWithPrevious,
  moveBlock,
  moveSection,
  outdentBlock,
  splitBlock,
  turnInto,
  updateBlock,
} from "./editor/core/transforms";
export type { TurnIntoTarget } from "./editor/core/transforms";

// History
export { DEFAULT_COALESCE_WINDOW_MS, DEFAULT_HISTORY_LIMIT, createHistory } from "./editor/core/history";
export type { History, HistoryEntry, HistoryOptions } from "./editor/core/history";

// Patches (D10)
export { PatchError, applyPatches, documentPatchSchema, turnIntoTargetSchema } from "./editor/core/patches";
export type { ApplyPatchesResult, DocumentPatch } from "./editor/core/patches";

// Selection (D7)
export { caretAt, clampSelection, getSelectedBlockRange, isCollapsed } from "./editor/core/selection";
export type { BlockSelection, EditorSelection, TextSelection } from "./editor/core/selection";

// Selection equality
export { selectionsEqual } from "./editor/core/selection";

// Marks (range operations)
export {
  applyMark,
  getActiveMarks,
  markEquals,
  rangeHasMark,
  removeMark,
  toggleMark,
} from "./editor/core/marks";

// Engine
export { createEditorEngine } from "./editor/core/commands";
export type {
  ChangeInfo,
  ChangeOrigin,
  EditorCommands,
  EditorEngine,
  EditorEngineOptions,
  EngineListener,
} from "./editor/core/commands";
