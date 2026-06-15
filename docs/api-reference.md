# API reference

The public surface, by entry point. Model types (`WealthyDocument`, `Block`, `InlineNode`, …)
are described in [Concepts](./concepts.md); this page focuses on the exported functions, hooks,
components, and their signatures.

> **Stability:** everything listed here is part of the 1.x public contract. Anything *not*
> listed (internal components, DOM helpers, raw Zod schemas) is intentionally not exported — see
> [Stability & versioning](./stability.md).

- [`wealthy-text-editor` (root, React-free)](#root--wealthy-text-editor)
- [`wealthy-text-editor/react`](#react--wealthy-text-editorreact)
- [`wealthy-text-editor/export-html`](#export-html)
- [`wealthy-text-editor/export-markdown`](#export-markdown)
- [`wealthy-text-editor/export-docx`](#export-docx)
- [`wealthy-text-editor/styles.css`](#styles)

---

## Root — `wealthy-text-editor`

React-free core: schema, factories, the headless engine, pure transforms, the patch pipeline,
sections, numbering, serialization. Safe on the server.

### Schema & validation

| Export | Signature | Description |
| --- | --- | --- |
| `SCHEMA_VERSION` | `1` | The current (frozen) wire-format version. |
| `validateDocument` | `(input: unknown) => WealthyDocument` | Parses & validates; throws on invalid. |
| `safeValidateDocument` | `(input: unknown) => { success: true; document } \| { success: false; error }` | Non-throwing validation. |
| `isBlockOfType` | `<T>(block: Block, type: T) => block is Extract<Block, { type: T }>` | Type-guard helper. |

**Types:** `WealthyDocument`, `Block`, `BaseBlock`, `HeadingBlock`, `TextBlock`, `TableBlock`,
`ImageBlock`, `ImageContent`, `ImageGroupBlock`, `ImageGroupEntry`, `ImageGroupColumnWidth`,
`ImageSource`, `ImageSize`, `ImageAlign`, `CustomBlock`, `TableColumn`, `TableRow`, `TableCell`, `InlineNode`, `TextNode`,
`InlineObjectNode`, `InlineMark`, `Align`, `HeadingLevel`, `TextVariant`, `BlockMeta`.

### Factories

| Export | Signature |
| --- | --- |
| `createEmptyDocument` | `<TBlockMeta, TDocMeta>() => WealthyDocument` — one empty paragraph |
| `createBlock` | `(input: CreateBlockInput) => Block` |
| `createHeadingBlock` | `(input: CreateHeadingBlockInput) => HeadingBlock` |
| `createTextBlock` | `(input?: CreateTextBlockInput) => TextBlock` |
| `createTableBlock` | `(input: CreateTableBlockInput) => TableBlock` |
| `createImageBlock` | `(input: CreateImageBlockInput) => ImageBlock` |
| `createImageGroupBlock` | `(input: CreateImageGroupBlockInput) => ImageGroupBlock` |
| `createCustomBlock` | `(input: CreateCustomBlockInput) => CustomBlock` |
| `generateBlockId` | `() => string` — a fresh UUID |

`content` inputs accept either an `InlineNode[]` or a plain `string`. **Types:**
`CreateBlockInput`, `CreateHeadingBlockInput`, `CreateTextBlockInput`, `CreateTableBlockInput`,
`CreateImageBlockInput`, `CreateImageGroupBlockInput`, `CreateImageGroupEntryInput`,
`CreateCustomBlockInput`.

### Image layout

| Export | Signature |
| --- | --- |
| `resolveImageGroupColumnWidths` | `(entries) => number[]` — render/export widths normalized to 100% |

### Built-in separator block

| Export | Signature | Description |
| --- | --- | --- |
| `createSeparatorBlock` | `(input?: CreateSeparatorBlockInput) => CustomBlock` | A horizontal-rule custom block. |
| `SEPARATOR_BLOCK_KIND` | `"separator"` | The `kind` value. |

The React plugin that renders it is `separatorPlugin` (from `/react`). This React-free pair lets
exporters and server code create separators without importing React. **Type:** `CreateSeparatorBlockInput`.

### Serialization

| Export | Signature |
| --- | --- |
| `serializeDocument` | `(document) => string` — validates, then `JSON.stringify` |
| `deserializeDocument` | `(json: string) => WealthyDocument` — `JSON.parse`, then validates |

Both preserve `meta`/`data` bags untouched. `deserializeDocument` throws a `SyntaxError` on
invalid JSON and a validation error on a malformed document.

### Inline utilities

Operate on `InlineNode[]` in inline-unit offsets (an object counts as 1).

| Export | Signature |
| --- | --- |
| `getInlineLength` | `(content: InlineNode[]) => number` |
| `getInlineText` | `(content: InlineNode[]) => string` |
| `splitInlineContent` | `(content, offset) => [left, right]` |
| `concatInlineContent` | `(a, b) => InlineNode[]` |
| `normalizeInlineContent` | `(content) => InlineNode[]` — merges adjacent equal-mark text |
| `marksEqual` | `(a?: InlineMark[], b?: InlineMark[]) => boolean` |
| `INLINE_OBJECT_CHAR` | `string` — the placeholder character objects occupy in text projections |

### Sections (derived)

| Export | Signature |
| --- | --- |
| `getSectionTree` | `(document) => SectionTree` — nested view derived from heading levels |
| `getSection` | `(document, headingId) => Section \| null` |
| `getSectionRange` | `(document, headingId) => { start: number; end: number } \| null` |
| `getImpliedLevelAt` | `(document, index) => number` |

**Types:** `Section`, `SectionTree`.

### Numbering (computed, display-only)

| Export | Signature |
| --- | --- |
| `getHeadingNumbers` | `(document) => Map<string, number[]>` |
| `getHeadingNumberPath` | `(document, headingId) => number[] \| null` |
| `getHeadingNumberLabel` | `(document, headingId) => string \| null` |
| `formatHeadingNumber` | `(path: number[]) => string` — e.g. `[1,2]` → `"1.2"` |
| `getListItemNumbers` | `(document) => Map<string, number>` |
| `getListItemNumber` | `(document, blockId) => number \| null` |

### Transforms (pure)

Pure `(document, …) => document` functions. They throw on invalid input and never mutate. The
engine wraps these as undoable transactions; call them directly only for off-engine work.

`insertBlockAfter`, `updateBlock`, `deleteBlock`, `moveBlock`, `turnInto`, `splitBlock`,
`mergeWithPrevious`, `indentBlock`, `outdentBlock`, `insertInlineNode`, `updateInlineObjectAt`,
`removeInlineNodeAt`, `moveSection`, `deleteSection`, `duplicateSection`, `getInlineNodeLength`,
and the constant `MAX_INDENT`. **Type:** `TurnIntoTarget` (`{ type: "heading"; level }` |
`{ type: "text"; variant }`).

### Patches (D10)

| Export | Signature | Description |
| --- | --- | --- |
| `applyPatches` | `(document, patches: unknown) => ApplyPatchesResult` | Validates & applies an array of patches atomically. |
| `PatchError` | `class extends Error` | Thrown with `patchIndex` on failure. |

A `DocumentPatch` is one of: `update_block`, `insert_block_after`, `delete_block`, `move_block`,
`turn_into`, `move_section`, `delete_section`, `duplicate_section`. Patches are validated with
Zod and applied in order; any failure leaves the document untouched. This is the single entry
point for **external (LLM/server) edits** — see [Headless & server use](./headless.md). **Types:**
`DocumentPatch`, `ApplyPatchesResult`.

### Selection (D7)

| Export | Signature |
| --- | --- |
| `caretAt` | `(blockId, offset) => TextSelection` |
| `isCollapsed` | `(selection) => boolean` |
| `clampSelection` | `(document, selection) => EditorSelection \| null` |
| `getSelectedBlockRange` | `(document, selection) => { start, end } \| null` |
| `selectionsEqual` | `(a, b) => boolean` |

**Types:** `EditorSelection` (= `TextSelection \| BlockSelection`), `TextSelection`
(`{ type: "text"; blockId; anchor; focus }`), `BlockSelection`
(`{ type: "blocks"; anchorBlockId; focusBlockId }`).

### Marks (range operations)

Pure operations over `InlineNode[]` and an inline-unit `[start, end)` range:
`toggleMark`, `applyMark`, `removeMark`, `getActiveMarks`, `rangeHasMark`, `markEquals`.

### Engine

| Export | Signature |
| --- | --- |
| `createEditorEngine` | `(options: EditorEngineOptions) => EditorEngine` |

`EditorEngineOptions`: `{ value, limit?, coalesceWindowMs? }`. The `EditorEngine` owns the
working document and exposes `getDocument`, `setDocument`, `getSelection`, `setSelection`,
`subscribe`, `getSectionTree`, `getSection`, `canUndo`, `canRedo`, and `commands`
(`EditorCommands`). See [Headless & server use](./headless.md). **Types:** `EditorEngine`,
`EditorCommands`, `EditorEngineOptions`, `EngineListener`, `ChangeInfo`, `ChangeOrigin`.

#### `EditorCommands`

Every command runs as one undoable transaction and throws on invalid input.

| Command | Returns | Notes |
| --- | --- | --- |
| `updateBlock(id, patch)` | `void` | Shallow patch, re-validated. Content updates coalesce (typing). |
| `insertBlockAfter(afterId \| null, block)` | `string` | New block id. |
| `deleteBlock(id)` | `void` | |
| `moveBlock(id, afterId \| null)` | `void` | |
| `turnInto(id, target)` | `void` | Heading ⇄ text variants. |
| `splitBlock(id, offset)` | `string` | Id of the new (second) block. |
| `mergeWithPrevious(id)` | `number` | Caret offset in the merged block. |
| `insertInlineNode(id, offset, node)` | `number` | Caret offset after the node. |
| `updateInlineObject(id, offset, { data?, meta? })` | `void` | Edits a chip in place. |
| `removeInlineNode(id, offset)` | `void` | |
| `indent(id)` / `outdent(id)` | `void` | |
| `moveSection(headingId, afterId \| null)` | `void` | Re-levels the subtree (D4). |
| `deleteSection(headingId)` | `void` | |
| `duplicateSection(headingId)` | `string` | New heading id. |
| `applyPatches(patches)` | `DocumentPatch[]` | The applied patches. |
| `undo()` / `redo()` | `boolean` | `false` when nothing to do. |

---

## React — `wealthy-text-editor/react`

Hooks, components, the plugin system, paste, and i18n. Re-exports `createSeparatorBlock` /
`SEPARATOR_BLOCK_KIND` from the root for convenience.

### Hooks

#### `useDocumentEditor(options): DocumentEditorApi`

Headless engine-backed state for a full document. `options`: `{ value, onChange?, onCommit?,
commitIdleMs?, historyLimit?, coalesceWindowMs? }` (`UseDocumentEditorOptions`).
Because the hook is DOM-free, `onCommit` is fired by explicit `commit()` and idle commits; the
React components add commit-on-editor-blur behavior.

`DocumentEditorApi`:

| Member | Type | |
| --- | --- | --- |
| `document` | `WealthyDocument` | Current document. |
| `commands` | `EditorCommands` | Undoable operations. |
| `engine` | `EditorEngine` | Escape hatch to the engine. |
| `selection` / `setSelection` | `EditorSelection \| null` / setter | |
| `sectionTree` | `SectionTree` | |
| `getSection(id)` | `Section \| null` | |
| `canUndo` / `canRedo` | `boolean` | |
| `isDirty` | `boolean` | Changed since last commit. |
| `commit()` | `void` | Force a commit. |
| `collapsedHeadingIds` | `ReadonlySet<string>` | View state (not in the document). |
| `isSectionCollapsed` / `setSectionCollapsed` / `toggleSectionCollapsed` / `expandAllSections` | | Collapse controls. |
| `hiddenBlockIds` | `ReadonlySet<string>` | Blocks hidden by collapsed sections. |

#### `useBlockEditor(options): BlockEditorApi`

Single-block editing on the same engine. `options`: `{ value: Block, onChange?, onCommit?,
commitIdleMs?, historyLimit?, coalesceWindowMs? }`. Returns `{ block, update, turnInto,
selection, setSelection, undo, redo, canUndo, canRedo, isDirty, commit }`.

### Components

#### `DocumentEditor`

The primary multi-block editor. Props (`DocumentEditorProps<TMeta>`):

| Prop | Type |
| --- | --- |
| `value` | `WealthyDocument<TMeta>` |
| `onChange?` | `(document, info: ChangeInfo) => void` |
| `onCommit?` | `(document) => void` |
| `commitIdleMs?` | `number` |
| `readOnly?` | `boolean` |
| `showHeadingNumbers?` | `boolean` |
| `placeholder?` | `string` |
| `locale?` | `"en" \| "pt-BR"` |
| `messages?` | `Partial<EditorMessages>` |
| `className?` | `string` |
| `plugins?` | `EditorPlugin<TMeta>[]` |
| `renderBlock?` | `(props: RenderBlockProps<TMeta>) => ReactNode` |
| `resolveImageSource?` | `(block: ImageBlock<TMeta>) => string \| undefined` |
| `resolveImageContentSource?` | `(entry: ImageGroupEntry<TMeta>) => string \| undefined` |
| `onRequestImage?` | `(context: ImageRequestContext) => ImageInsertionResult<TMeta> \| Promise<ImageInsertionResult<TMeta>>` |
| `onUploadImage?` | `(file: File) => ImageInsertionResult<TMeta> \| Promise<ImageInsertionResult<TMeta>>` |
| `slashItems?` | `CustomSlashItem<TMeta>[]` |
| `inlineTagToNode?` | `(text: string) => InlineNode \| null` \| `false` |
| `ariaLabel?` | `string` |
| `ref?` | `Ref<DocumentEditorApi<TMeta>>` |

`onCommit` fires when focus leaves the editor, after an idle pause (`commitIdleMs`), or when
`commit()` is called through the ref/headless API.

`onRequestImage` enables the built-in `/image` slash item. `onUploadImage` handles pasted/dropped
image files. Both callbacks keep upload/storage host-owned and return an image-block creation
payload, or `null` / `undefined` to cancel.

#### `BlockEditor`

Single-block editor. Props (`BlockEditorProps<TMeta>`): `{ value: Block, onChange?, onCommit?,
commitIdleMs?, readOnly?, placeholder?, locale?, messages?, className?, ariaLabel?,
resolveImageSource?, resolveImageContentSource?, renderBlock? }`.
It has the same commit timing as `DocumentEditor`.

#### `defaultInlineTagToNode`

`(label: string) => InlineNode` — the default `{{label}}` handler; produces a `placeholder`
chip whose `key` is the slugified label.

**Plugin types:** `EditorPlugin`, `BlockTypeRegistration`, `RenderBlockProps`,
`InlineObjectRegistration`, `InlineObjectEditorContext`, `CustomSlashItem`, `SlashItemContext`,
`ToolbarItemRegistration`, `ToolbarItemContext`. See [Plugins](./plugins.md).

### Paste

| Export | Signature |
| --- | --- |
| `parseClipboardToBlocks` | `(payload: ClipboardPayload) => Block[]` — prefers HTML, falls back to text |
| `parseHtmlToBlocks` | `(html: string) => Block[]` |
| `parsePlainTextToBlocks` | `(text: string) => Block[]` |

`ClipboardPayload`: `{ html: string; text: string }`.

### i18n

| Export | Signature / value |
| --- | --- |
| `resolveMessages` | `(locale?, override?: Partial<EditorMessages>) => EditorMessages` |
| `en` / `ptBR` | `EditorMessages` dictionaries |
| `DEFAULT_LOCALE` | `"en"` |
| `MessagesProvider` | React provider for `EditorMessages` |
| `useMessages` | `() => EditorMessages` |

**Types:** `EditorMessages`, `Locale`. See [i18n](./i18n.md).

### Plugins (built-in)

| Export | |
| --- | --- |
| `separatorPlugin` | `EditorPlugin` rendering the separator block + a `/separator` slash item. |
| `createSeparatorBlock`, `SEPARATOR_BLOCK_KIND` | Re-exported from the root. |

---

## export-html

```ts
import { exportHtml } from "wealthy-text-editor/export-html";
```

`exportHtml(document, options?: HtmlExportOptions): string`. `HtmlExportOptions`:
`{ renderCustomBlock?, renderInlineObject?, resolveImageSource?, resolveImageContentSource?, headingNumbers? }`.
Emits semantic HTML; nested lists are grouped by `indent`; tables emit a `<colgroup>` honoring
`column.width`; URL images emit `<figure><img>`; image groups emit a `.wte-image-group` row. See
[Exporters](./exporters.md).

## export-markdown

```ts
import { exportMarkdown } from "wealthy-text-editor/export-markdown";
```

`exportMarkdown(document, options?: MarkdownExportOptions): string`. Marks without a Markdown
equivalent fall back to inline HTML; `color` is dropped. GFM tables always have a header row, so
`showHeader: false` is not faithfully represented. Options include
`{ renderCustomBlock?, renderInlineObject?, resolveImageSource?, resolveImageContentSource?, headingNumbers? }`;
image groups are emitted as stacked portable Markdown images.

## export-docx

```ts
import { exportDocx } from "wealthy-text-editor/export-docx";
import { Packer } from "docx";

const blob = await Packer.toBlob(exportDocx(document));
```

`exportDocx(document, options?: DocxExportOptions): docx.Document`. `DocxExportOptions`:
`{ renderCustomBlock?, renderImageBlock?, renderImageContent?, renderInlineObject? }`. Returns a `docx` `Document` you pack with
`Packer`. `docx` is an **optional peer dependency**. Marks are best-effort (`code` →
monospace, `color` only when a 6-digit hex, `highlight` dropped); `TableColumn.width` is ignored
in v1.0. Image groups export as borderless one-row tables. See [Exporters](./exporters.md).

## styles

```ts
import "wealthy-text-editor/styles.css";
```

The optional default theme (prefixed `.wte-*` classes, `--wte-*` variables). Stable classes and
variables are listed in [Styling](./styling.md).
