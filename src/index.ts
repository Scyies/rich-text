// Schema + types (v0.1)
export {
  SCHEMA_VERSION,
  isBlockOfType,
  safeValidateDocument,
  validateDocument,
} from "./editor/core/schema";

export type {
  Align,
  BaseBlock,
  Block,
  BlockMeta,
  CustomBlock,
  DocumentValidationError,
  DocumentValidationIssue,
  HeadingBlock,
  HeadingLevel,
  AssetImageSource,
  EmptyImageSource,
  ImageAlign,
  ImageBlock,
  ImageContent,
  ImageContentBase,
  ImageGroupBlock,
  ImageGroupColumnWidth,
  ImageGroupEntry,
  ImageGroupEntrySource,
  ImageSize,
  ImageSource,
  UrlImageSource,
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
  MogulDocument,
} from "./editor/core/schema";

// Factories
export {
  cloneBlocksWithFreshIds,
  createBlock,
  createCustomBlock,
  createEmptyDocument,
  createEmptyImageGroupBlock,
  createHeadingBlock,
  createImageBlock,
  createImageGroupBlock,
  createTableBlock,
  createTextBlock,
  generateBlockId,
} from "./editor/core/factories";

export type {
  CreateBlockInput,
  CreateCustomBlockInput,
  CreateEmptyImageGroupBlockInput,
  CreateHeadingBlockInput,
  CreateImageBlockInput,
  CreateImageGroupBlockInput,
  CreateImageGroupEntryInput,
  CreateTableBlockInput,
  CreateTextBlockInput,
} from "./editor/core/factories";

// Image layout helpers
export { resolveImageGroupColumnWidths } from "./editor/core/image-layout";

// Built-in custom block helpers
export { createSeparatorBlock, SEPARATOR_BLOCK_KIND } from "./editor/plugins/separator-core";
export type { CreateSeparatorBlockInput } from "./editor/plugins/separator-core";

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
  getInlineNodeLength,
  indentBlock,
  insertBlockAfter,
  insertImageGroupEntry,
  insertInlineNode,
  mergeWithPrevious,
  moveBlock,
  moveSection,
  outdentBlock,
  pruneEmptyImageSlots,
  replaceInlineObjectWithTextAt,
  removeImageGroupEntry,
  removeInlineNodeAt,
  splitBlock,
  splitImageGroup,
  turnInto,
  updateBlock,
  updateImageGroupEntry,
  updateInlineObjectAt,
} from "./editor/core/transforms";
export type { TurnIntoTarget } from "./editor/core/transforms";

// Patches (D10)
export { PatchError, applyPatches } from "./editor/core/patches";
export type { ApplyPatchesResult, DocumentPatch, InsertableBlock } from "./editor/core/patches";

// Selection (D7)
export { caretAt, clampSelection, getSelectedBlockRange, isCollapsed } from "./editor/core/selection";
export type { BlockSelection, EditorSelection, TextSelection } from "./editor/core/selection";
export type { OrderedTextSelection, SelectedTextSlice, SelectionPoint } from "./editor/core/selection";
export { compareSelectionPoints, getSelectedTextSlices, orderTextSelection, selectionPointsEqual } from "./editor/core/selection";

// Document text ranges
export { deleteTextRange, extractTextRange, replaceTextRangeWithBlocks, replaceTextRangeWithInline, textRangeToPlainText } from "./editor/core/ranges";
export type { RangeEditResult } from "./editor/core/ranges";

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
