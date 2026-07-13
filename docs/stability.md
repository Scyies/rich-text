# Stability & versioning

## Versioning policy

The library follows [Semantic Versioning](https://semver.org). From **1.0**, the public surface
is a contract:

- **Breaking changes** → major version. Renaming/removing an export, changing a signature or a
  documented behavior.
- **Additive changes** → minor version. New optional props, new commands, new exports, a third
  locale.
- **Fixes** → patch version.

The package is currently `0.x` (alpha): the surface is being finalized, so it may still change
before 1.0. Once 1.0 ships, the guarantees above apply.

## What is public

The public API is exactly what's exported from the documented entry points:

- `wealthy-text-editor` (root, React-free)
- `wealthy-text-editor/react`
- `wealthy-text-editor/export-html`, `/export-markdown`, `/export-docx`
- `wealthy-text-editor/styles.css` — the [stable classes & variables](./styling.md) only

See the [API reference](./api-reference.md) for the full enumeration.

## What is intentionally *not* public

These exist in the codebase but are **not exported** and not covered by semver. Relying on them
(via deep imports) is unsupported. Each could be promoted later — adding an export is
non-breaking — so open an issue if you have a real need.

- **Raw Zod schemas** (`documentSchema`, `blockSchema`, `documentPatchSchema`, …). The library
  doesn't make Zod part of its contract; use `validateDocument` / `safeValidateDocument` and the
  `DocumentPatch` type instead.
- **History internals** (`createHistory`, `History`, `HistoryEntry`). The engine manages history.
- **Low-level UI primitives** (`InlineEditor`, `TableView`, `SlashMenu`, `FloatingToolbar`) and
  **DOM helpers** (`domToInlineNodes`, caret/selection utilities). Build custom UI on the hooks
  and the model instead.

## Intentional contracts

Deliberate design choices you can depend on:

- **`schemaVersion: 1` is frozen** for the 1.x line. Future wire-format changes will bump the
  version and ship explicit migration tooling; `deserializeDocument` rejects unknown versions.
- **Opaque bags.** `CustomBlock.data`, `InlineObjectNode.data`, `InlineObjectNode.meta`, and the
  block/document `meta` are `Record<string, unknown>`. The core **never** reads, interprets, or
  strips them; they round-trip untouched. This is your domain extension point.
- **Heading levels 1–6** are valid in the model; the built-in chrome (slash menu, markdown input
  rules) only *creates* 1–3. Levels 4–6 render fine.
- **Loose patches by design.** `updateBlock(patch)` (and the equivalent APIs) accept
  `Record<string, unknown>`; validation happens in the schema/transform layer, not in the type.
- **Markdown:** GFM tables always have a header row, so `showHeader: false` is not represented
  faithfully (the first row becomes the header). Marks without a Markdown equivalent fall back to
  inline HTML; `color` is dropped.
- **Images:** the document stores image URLs or host asset ids, never binary data. Hosts resolve
  asset ids for rendering/export and own upload/storage, including pasted/dropped image files.
- **Image groups:** side-by-side images are semantic `imageGroup` blocks in the model. DOCX
  represents them with borderless tables as an exporter detail, not as nested editor tables.
- **Two generics on `WealthyDocument`** (`<TBlockMeta, TDocMeta>`), both defaulted, so existing
  single-argument and zero-argument uses keep working.

## Plugin lifecycle (forward-compatible)

Plugins currently register `blockTypes`, `inlineObjects`, `slashItems`, and `toolbarItems`.
Lifecycle hooks (e.g. `commands`, `onInit`) are deliberately **out of scope for now** and will
be added **additively** later, without changing the existing `EditorPlugin` shape.

## docx

The bundled `exportDocx` is intentionally a **minimal, generic** translator (blocks/marks/lists/
tables → `docx`). Rich, template-grade Word output — page setup, headers/footers,
style-by-`meta.role`, placeholder→field mapping, native numbering — is **not** in the library for
1.0.

Rationale: those needs aren't yet well understood from real use, and freezing a large,
speculative options API at 1.0 would risk locking in the wrong contract. The reusable foundation
(the model plus `getSectionTree`/`getHeadingNumbers`/inline helpers, and the returned `docx`
`Document` you can post-process) is stable; build template-grade output on top of it in your app.
Generic pieces can be extracted back into the library later as additive features once the
boundary is clear. `docx` is an **optional peer dependency** so the host controls its version.

## Non-goals (v1)

Out of scope for 1.0 by design:

- Real-time collaboration
- Text ranges that cross into captions, table cells, or custom editable regions (top-level heading/text ranges are supported)
- Nested tables
- Markdown *paste* (HTML paste is supported)

## See also

- [API reference](./api-reference.md)
- [Styling](./styling.md)
