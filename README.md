# wealthy-text-editor

> **"Rich" → "Wealthy"** — a schema-first, headless, block-based rich text editor for React.

A React library for editing structured, block-based documents (Notion-like, with section
structure derived from heading levels). It was extracted from the **Minuta** project as a
standalone, generic library.

## Philosophy

- **Schema-first** — the document is plain JSON. Blocks store **intent** (e.g.
  `{ type: "heading", level: 2 }`), not styling.
- **Headless by design** — an optional stylesheet (`styles.css`, `.wte-*` classes) ships with
  it, but the host owns the look (Tailwind, custom CSS, or the bundled theme).
- **Clear layers** — schema → commands → hooks → components → exporters. Each is usable on its own.
- **Predictable** — explicit operations via `editor.commands.*`, never direct mutation.
- **Native-first input** — the browser paints typing; the model is read back from the DOM, so the
  caret is never disturbed while you type.
- **React-free core** — the root entry is server-safe (apply LLM patches, validate, export
  without React).

## Install

```bash
pnpm add wealthy-text-editor
# only if you use the docx exporter:
pnpm add docx
```

Peer dependencies: `react` and `react-dom` (>= 19). `docx` is an optional peer dependency needed
only by `wealthy-text-editor/export-docx`.

## Quick start

```tsx
import { useState } from "react";
import { createEmptyDocument } from "wealthy-text-editor";
import { DocumentEditor } from "wealthy-text-editor/react";
import "wealthy-text-editor/styles.css";

function App() {
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

`onChange` fires on every transaction; `onCommit` fires when focus leaves the editor, after an
idle pause, or after an explicit commit. Passing a genuinely new `value` swaps the document;
echoing back what you got from `onChange` is a no-op, so controlled usage is safe.

## Features

- Per-line block editing with whole-block multi-select and drag handles.
- `Enter`/`Backspace`/`Tab` structure (split, merge, indent); `Enter` on an empty list item exits the list.
- Markdown input rules (`# `, `- `, `1. `) and a `/` slash menu.
- Floating mark toolbar, hierarchical heading numbering, collapsible sections.
- First-class image blocks with URL or host asset references; images are user-supplied via paste/drop, and the `/image row` command lays out an empty grid of drop slots to fill.
- `{{label}}` → placeholder chips; a full [plugin system](./docs/plugins.md) for custom blocks,
  inline-object chips, slash items, and toolbar buttons.
- Rich paste from Word / Google Docs / the web, including URL-backed `<img>` / `<figure>` content.
- [Exporters](./docs/exporters.md) to HTML, Markdown, and docx.
- [i18n](./docs/i18n.md) (`en` default, `pt-BR` built in) and a headless, server-safe core.

## Entry points

| Entry | Contents |
| --- | --- |
| `wealthy-text-editor` | React-free core: schema, factories, the headless engine, transforms, the patch pipeline (D10), sections, numbering, serialization. Server-safe. |
| `wealthy-text-editor/react` | Hooks (`useDocumentEditor`, `useBlockEditor`), components (`DocumentEditor`, `BlockEditor`), the plugin system, paste, and i18n. |
| `wealthy-text-editor/export-html` | `exportHtml` |
| `wealthy-text-editor/export-markdown` | `exportMarkdown` |
| `wealthy-text-editor/export-docx` | `exportDocx` (needs the `docx` peer dep) |
| `wealthy-text-editor/styles.css` | Optional default theme |

## Documentation

- [Getting started](./docs/getting-started.md)
- [Concepts & data model](./docs/concepts.md)
- [API reference](./docs/api-reference.md)
- [Plugins](./docs/plugins.md)
- [Exporters](./docs/exporters.md)
- [Internationalization](./docs/i18n.md)
- [Headless & server use](./docs/headless.md)
- [Styling](./docs/styling.md)
- [Stability & versioning](./docs/stability.md)

See also [ARCHITECTURE.md](./ARCHITECTURE.md) for the design decisions (D1–D16) and
[ROADMAP.md](./ROADMAP.md) for status.

## Status

`0.x` (alpha): the public API is being finalized toward 1.0. See
[Stability & versioning](./docs/stability.md) for what's covered by semver.

## License

MIT
