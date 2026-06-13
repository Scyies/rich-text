import type { ReactNode } from "react";
import type { EditorCommands } from "../core/commands";
import type { EditorSelection } from "../core/selection";
import type { BlockMeta, CustomBlock, InlineMark, InlineNode, InlineObjectNode } from "../core/schema";
import type { DocumentEditorApi } from "../hooks/useDocumentEditor";
import type { SlashMenuItem } from "../components/SlashMenu";

/**
 * Plugin surface (D5/D6). Plugins register per-`kind` renderers and editor
 * extensions; the host passes them to `<DocumentEditor plugins={…}>`. These
 * types live React-side (renderers return `ReactNode`) — the core entry
 * (`wealthy-text-editor`) stays React-free. See ARCHITECTURE.md D5/D6.
 */

// ---------------------------------------------------------------------------
// Custom blocks (D5)
// ---------------------------------------------------------------------------

export interface RenderBlockProps<TMeta extends BlockMeta = BlockMeta> {
  block: CustomBlock<TMeta>;
  readOnly: boolean;
  update(patch: Record<string, unknown>): void;
}

/** Renderer for a `CustomBlock` of a given `kind` (e.g. "request_list"). */
export interface BlockTypeRegistration<TMeta extends BlockMeta = BlockMeta> {
  kind: string;
  render(props: RenderBlockProps<TMeta>): ReactNode;
}

// ---------------------------------------------------------------------------
// Inline objects (D6) — chips: placeholders, mentions, …
// ---------------------------------------------------------------------------

/** Handed to a chip's click-to-edit popover (`renderEditor`). */
export interface InlineObjectEditorContext {
  /** Replace the object's data/meta in the model (atomic, undoable). Each is replaced wholesale when provided. */
  update(patch: { data?: Record<string, unknown>; meta?: Record<string, unknown> }): void;
  /** Remove the chip from its block. */
  remove(): void;
  /** Close the popover without further changes. */
  close(): void;
}

/**
 * Renderer for an `InlineObjectNode` of a given `kind`. The chip itself is a
 * lightweight token rendered into the contenteditable (native-first, D16);
 * `renderEditor` supplies the React UI for the click-to-edit/fill popover,
 * hosted in a `DocumentEditor`-owned overlay.
 */
export interface InlineObjectRegistration {
  kind: string;
  /** Chip text (auto-escaped). Defaults to `data.label` ?? `kind`. */
  getLabel?: ((node: InlineObjectNode) => string) | undefined;
  /** Extra class on the chip span — e.g. to reflect filled/empty state. */
  getClassName?: ((node: InlineObjectNode) => string | undefined) | undefined;
  /** Popover content shown on chip click. Omit to make the chip non-interactive. */
  renderEditor?: ((node: InlineObjectNode, ctx: InlineObjectEditorContext) => ReactNode) | undefined;
}

// ---------------------------------------------------------------------------
// Slash menu items (D11) — shared with the standalone `slashItems` prop
// ---------------------------------------------------------------------------

export interface SlashItemContext<TMeta extends BlockMeta = BlockMeta> {
  blockId: string;
  /** The text typed after "/" when the item was applied. */
  query: string;
  /** Inserts an inline node where the "/" was typed and places the caret after it. */
  insertInlineNode(node: InlineNode): void;
  commands: DocumentEditorApi<TMeta>["commands"];
}

/** Host/plugin-provided slash menu entry (shown after the core block types). */
export interface CustomSlashItem<TMeta extends BlockMeta = BlockMeta> extends SlashMenuItem {
  apply(context: SlashItemContext<TMeta>): void;
}

// ---------------------------------------------------------------------------
// Toolbar items (lean) — extra buttons after the mark buttons
// ---------------------------------------------------------------------------

export interface ToolbarItemContext<TMeta extends BlockMeta = BlockMeta> {
  commands: EditorCommands<TMeta>;
  selection: EditorSelection | null;
}

export interface ToolbarItemRegistration<TMeta extends BlockMeta = BlockMeta> {
  id: string;
  /** Button content (short text or glyph). */
  label: string;
  title?: string | undefined;
  /** Active (pressed) state given the current selection's marks. */
  isActive?: ((activeMarkTypes: ReadonlySet<InlineMark["type"]>) => boolean) | undefined;
  apply(ctx: ToolbarItemContext<TMeta>): void;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface EditorPlugin<TMeta extends BlockMeta = BlockMeta> {
  /** Unique among the plugins passed to one editor. */
  name: string;
  blockTypes?: BlockTypeRegistration<TMeta>[] | undefined;
  inlineObjects?: InlineObjectRegistration[] | undefined;
  slashItems?: CustomSlashItem<TMeta>[] | undefined;
  toolbarItems?: ToolbarItemRegistration<TMeta>[] | undefined;
}
