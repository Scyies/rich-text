/**
 * wealthy-text-editor/react — React surface of the library.
 * The root entry ("wealthy-text-editor") is React-free and server-safe
 * (schema, engine, transforms, patches); this entry adds hooks and
 * components for the client.
 */

// Hooks (v0.3)
export { useDocumentEditor } from "./editor/hooks/useDocumentEditor";
export type { DocumentEditorApi, UseDocumentEditorOptions } from "./editor/hooks/useDocumentEditor";
export { useBlockEditor } from "./editor/hooks/useBlockEditor";
export type { BlockEditorApi, UseBlockEditorOptions } from "./editor/hooks/useBlockEditor";

// Components (v0.4)
export { DocumentEditor, defaultInlineTagToNode } from "./editor/components/DocumentEditor";
export type {
  CustomSlashItem,
  DocumentEditorProps,
  RenderBlockProps,
  SlashItemContext,
} from "./editor/components/DocumentEditor";
export { BlockEditor } from "./editor/components/BlockEditor";
export type { BlockEditorProps } from "./editor/components/BlockEditor";
export { InlineEditor } from "./editor/components/InlineEditor";
export type { InlineEditorHandle, InlineEditorProps } from "./editor/components/InlineEditor";
export { TableView } from "./editor/components/TableView";
export type { TableViewProps } from "./editor/components/TableView";
export { SlashMenu, CORE_SLASH_ITEMS, filterSlashItems } from "./editor/components/SlashMenu";
export type { SlashMenuItem, SlashMenuProps } from "./editor/components/SlashMenu";
export { FloatingToolbar } from "./editor/components/FloatingToolbar";
export type { FloatingToolbarProps } from "./editor/components/FloatingToolbar";

// DOM ↔ model utilities (useful for host-built block renderers)
export {
  domToInlineNodes,
  getCaretOffset,
  getSelectionOffsets,
  inlineNodesToHtml,
  setCaretOffset,
  setSelectionOffsets,
} from "./editor/components/dom";

// Input rules
export { matchInputRule } from "./editor/components/inputRules";
export type { InputRuleMatch } from "./editor/components/inputRules";
