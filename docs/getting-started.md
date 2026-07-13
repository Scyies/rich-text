# Getting started

## Install

```bash
pnpm add wealthy-text-editor
# only if you use the docx exporter:
pnpm add docx
```

Peer dependencies: `react` and `react-dom` (>= 19). `docx` is an optional peer dependency needed
only by `wealthy-text-editor/export-docx` — install it solely if you export to Word.

## A minimal editor

`DocumentEditor` is a controlled component: you own the document and pass it back on change.

```tsx
import { useState } from "react";
import { createEmptyDocument } from "wealthy-text-editor";
import { DocumentEditor } from "wealthy-text-editor/react";
import "wealthy-text-editor/styles.css"; // optional default theme

function Editor() {
  const [doc, setDoc] = useState(createEmptyDocument());

  return (
    <DocumentEditor
      value={doc}
      onChange={setDoc}
      onCommit={(committed) => save(committed)}
    />
  );
}
```

- **`onChange(document, info)`** fires on every transaction (typing, commands, paste, undo/redo).
  Use it to keep `value` in sync.
- **`onCommit(document)`** fires when focus leaves the editor, on an idle pause
  (`commitIdleMs`), and on an explicit commit. Use it for autosave / persistence.
- Passing a **new `value` reference that isn't the engine's own output** swaps the document
  (a hard reset of history and selection). Echoing back the document you got from `onChange`
  is a no-op, so controlled usage is safe.

## What you get out of the box

- Per-line block editing with partial text selection across heading/text blocks and separate whole-block multi-select (drag handles).
- `Enter` / `Backspace` / `Tab` structure: split, merge, indent/outdent. `Enter` on an empty
  list item exits the list.
- Markdown input rules: `# `, `## `, `- `, `1. `.
- A slash menu (`/`) for block types, extensible via [plugins](./plugins.md).
- A floating toolbar over a text selection (bold/italic/underline/strikethrough/code).
- `{{label}}` → placeholder chip (configurable via `inlineTagToNode`).
- Hierarchical heading numbering (`showHeadingNumbers`) and collapsible sections.
- Rich paste from Word / Google Docs / the web (see [Paste](#paste)).

## Common props

| Prop | Type | Purpose |
| --- | --- | --- |
| `value` | `WealthyDocument<TMeta>` | The controlled document. |
| `onChange` | `(doc, info) => void` | Per-transaction. |
| `onCommit` | `(doc) => void` | Editor blur / idle / explicit. |
| `commitIdleMs` | `number` | Idle window before an auto-commit. |
| `readOnly` | `boolean` | Disables editing. |
| `showHeadingNumbers` | `boolean` | Prefix headings with `1.`, `1.1`, … |
| `plugins` | `EditorPlugin<TMeta>[]` | Custom blocks/inline objects, slash/toolbar items. |
| `slashItems` | `CustomSlashItem<TMeta>[]` | Extra slash items (host-level). |
| `onUploadImage` | `(file) => ImageInsertionInput \| null \| Promise<...>` | Handles pasted/dropped image files; enables the `/image row` slash item. |
| `allowDroppedImageUrls` | `boolean` | Allow dropped/pasted image URLs (default `false`). |
| `inlineTagToNode` | `(text) => InlineNode \| null` \| `false` | `{{…}}` rule; `false` disables it. |
| `locale` | `"en" \| "pt-BR"` | UI language of the built-in chrome (default `en`). |
| `messages` | `Partial<EditorMessages>` | Per-string overrides. |
| `renderBlock` | `(props: RenderBlockProps) => ReactNode` | Fallback custom-block renderer. |
| `ref` | `Ref<DocumentEditorApi<TBlockMeta, TDocMeta>>` | Imperative handle (commands, selection, sections). |

See the full list and types in the [API reference](./api-reference.md#documenteditor).

## Reaching the editor imperatively

`DocumentEditor` exposes its headless API through a React 19 `ref`:

```tsx
import { useRef } from "react";
import type { DocumentEditorApi } from "wealthy-text-editor/react";

function Host() {
  const api = useRef<DocumentEditorApi | null>(null);

  function insertField() {
    const sel = api.current?.selection;
    if (sel?.type === "text") {
      api.current!.commands.insertInlineNode(sel.blockId, sel.anchor, {
        type: "object",
        kind: "placeholder",
        data: { key: "field", label: "Field" },
      });
    }
  }

  return <DocumentEditor ref={api} value={doc} onChange={setDoc} />;
}
```

The same API (`commands`, `selection`, `sectionTree`, …) is available headlessly via
`useDocumentEditor` if you build your own UI.

## Editing a single block

`BlockEditor` edits one block in isolation, on the same engine (validation, undo, commit):

```tsx
import { BlockEditor } from "wealthy-text-editor/react";

<BlockEditor value={block} onChange={setBlock} ariaLabel="Title" />;
```

## Paste

`DocumentEditor` intercepts paste automatically: rich HTML (Word, Google Docs, web) is converted
to schema blocks, falling back to plain text. A single pasted paragraph splices inline into the
current block; multiple blocks insert as one atomic (single-undo) transaction. `<hr>` round-trips
with the separator block, and (when `allowDroppedImageUrls` is on) URL-backed `<img>` / `<figure>`
HTML becomes image blocks.

Images are user-supplied through drop/paste. Image files from paste/drop are not stored directly:
pass `onUploadImage` to upload the file and return a URL or asset-backed image payload. The
`/image row` slash item inserts an empty grid of drop slots (`createEmptyImageGroupBlock`) that you
fill by dropping or pasting images into each column; unfilled slots are pruned when focus leaves the
editor. Set `allowDroppedImageUrls` to also accept dropped/pasted image links.

The parsers are also exported for custom use:

```ts
import { parseClipboardToBlocks } from "wealthy-text-editor/react";

const blocks = parseClipboardToBlocks({ html, text }); // prefers HTML, falls back to text
```

## Styling

The package ships an optional stylesheet (`wealthy-text-editor/styles.css`) using prefixed
`.wte-*` classes and `--wte-*` CSS variables. It's headless by design — bring your own CSS or
override the variables. See [Styling](./styling.md) for the stable surface.

## Next steps

- [Concepts & data model](./concepts.md)
- [Plugins](./plugins.md) — custom blocks, inline-object chips, slash & toolbar items
- [Exporters](./exporters.md) — HTML, Markdown, docx
- [i18n](./i18n.md) · [Headless & server use](./headless.md)
