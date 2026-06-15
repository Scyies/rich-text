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
  ImageInsertionInput,
  ImageInsertionResult,
  ImageRequestContext,
  RenderBlockProps,
  SlashItemContext,
} from "./editor/components/DocumentEditor";
export { BlockEditor } from "./editor/components/BlockEditor";
export type { BlockEditorProps } from "./editor/components/BlockEditor";

// Paste (D11) — clipboard HTML → blocks, with a plain-text fallback
export {
  parseClipboardToBlocks,
  parseHtmlToBlocks,
  parsePlainTextToBlocks,
} from "./editor/components/paste";
export type { ClipboardPayload } from "./editor/components/paste";

// i18n (v0.5) — locale dictionaries + React binding for the built-in chrome
export { resolveMessages, en, ptBR, DEFAULT_LOCALE, MessagesProvider, useMessages } from "./editor/i18n";
export type { EditorMessages, Locale } from "./editor/i18n";

// Plugins (D5/D6) — block + inline-object renderers, slash/toolbar items
export { separatorPlugin } from "./editor/plugins/separator";
export { createSeparatorBlock, SEPARATOR_BLOCK_KIND } from "./editor/plugins/separator-core";
export type { CreateSeparatorBlockInput } from "./editor/plugins/separator-core";
export type {
  BlockTypeRegistration,
  EditorPlugin,
  InlineObjectEditorContext,
  InlineObjectRegistration,
  ToolbarItemContext,
  ToolbarItemRegistration,
} from "./editor/plugins/types";
