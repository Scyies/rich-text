# Concepts & data model

Mogul Text Editor is **schema-first**: the document is plain JSON, and everything
else — sections, numbering, the React UI, the exporters — is derived from it. Understanding
the model is most of understanding the library.

## The document

```ts
interface MogulDocument<TBlockMeta = BlockMeta, TDocMeta = BlockMeta> {
  schemaVersion: 1;
  blocks: Block<TBlockMeta>[];
  meta?: TDocMeta;
}
```

A document is a **flat array of blocks** — one block per visual line. There is no nesting in
the data: no `children`, no `parentId`. Containment (a heading and the blocks under it) is
*derived* from heading levels at read time, never stored (see [Sections](#sections)).

`schemaVersion` is `1` and frozen for the 1.x line. `meta` is an opaque bag for host data
(see [Meta bags](#meta-bags)).

> The two generics let a host type block-level and document-level metadata independently
> (`{ role }` on blocks vs. `{ caseId, court }` on the document). Both default to an open
> record, so `MogulDocument` with no type arguments is fully usable.

## Blocks

`Block` is a discriminated union on `type`:

| `type` | Shape | Notes |
| --- | --- | --- |
| `heading` | `{ id, type, level: 1–6, align?, content, meta? }` | `level` drives section structure. |
| `text` | `{ id, type, variant, indent?, align?, content, meta? }` | `variant`: `paragraph` \| `bullet` \| `numbered`. |
| `table` | `{ id, type, columns, rows, showHeader, meta? }` | Cells hold text blocks only (below). |
| `image` | `{ id, type, source, altText?, caption?, size?, align?, meta? }` | Binary/upload storage is host-owned. |
| `imageGroup` | `{ id, type, images, align?, gap?, meta? }` | Side-by-side image row; docx exports as a borderless table. |
| `custom` | `{ id, type, kind, data, meta? }` | Host/plugin-defined; `data` is opaque. |

- `id` is a UUID, stable for the block's lifetime and never reused.
- `align` is `left | center | right | justify`. `indent` is a non-negative integer (list nesting).
- Headings support levels **1–6** in the model; the built-in chrome (slash menu, markdown
  input rules) only *creates* 1–3, but 4–6 are valid and render.

### Tables

```ts
interface TableColumn { id: string; align?: "left" | "center" | "right"; width?: { value: number; unit: "percent" | "px" } }
interface TableRow { id: string; cells: TableCell[] }
interface TableCell { columnId: string; blocks: TextBlock[] }
```

Cells are addressed **by column id**, and hold a restricted list of **text blocks only** — no
nested headings, tables, or custom blocks (deliberate; widening this later is non-breaking).
`column.width` is honored by the editor UI and the HTML exporter; the docx exporter ignores
it in v1.0.

### Images

```ts
type ImageSource = { type: "url"; url: string } | { type: "asset"; id: string };
// Group entries widen the source with an empty draft slot:
type ImageGroupEntrySource = ImageSource | { type: "empty" };

interface ImageBlock {
  type: "image";
  source: ImageSource; // never "empty" — a single image always has a real source
  altText?: string;
  caption?: InlineNode[];
  size?: { width?: number; height?: number; unit: "px" | "percent" };
  align?: "left" | "center" | "right";
}

interface ImageGroupBlock {
  type: "imageGroup";
  images: ImageGroupEntry[];
  align?: "left" | "center" | "right";
  gap?: number;
}

interface ImageGroupEntry {
  id: string;
  source: ImageGroupEntrySource; // may be an empty slot while the row is being filled
  altText?: string;
  caption?: InlineNode[];
  size?: { width?: number; height?: number; unit: "px" | "percent" };
  columnWidth?: { value: number; unit: "percent" };
  meta?: BlockMeta;
}
```

The core stores only a URL or a host asset id. It does **not** store `File`, `Blob`,
object URLs, or base64 image data. Hosts that use `{ type: "asset" }` provide a resolver to
the React components and exporters. Clipboard/drop image files go through host upload callbacks;
URL-backed pasted/dropped images become ordinary image blocks when `allowDroppedImageUrls` is set.

Only **group entries** can carry `{ type: "empty" }` — the persistable draft state behind the
"image row" layout. `createEmptyImageGroupBlock({ columns })` builds a row of empty slots; the
editor renders each as a drop/paste target and prunes any still empty when focus leaves the editor
(`pruneEmptyImageSlots`): a one-image group collapses to a plain `image`, an all-empty group is
deleted. Empty slots are omitted from read-only rendering and every exporter. A single `ImageBlock`
is never empty, so consumers handling `ImageBlock.source` need no empty case.

`imageGroup` uses the same image content shape for each entry, but it has two percent-based
layout controls: `columnWidth` is the entry's share of the row, while `size.width` with
`unit: "percent"` is the image's share of its own column. Pixel `size` values are still
honored. Missing `columnWidth` values split the remaining width, and fully explicit rows below
100% are normalized to fill the row at render/export time without mutating the model.
The optional default stylesheet applies an 8px visual gap when `gap` is unset; set `gap: 0` to
explicitly remove that spacing in the built-in UI/HTML output.

## Inline content

A block's `content` is an array of inline nodes:

```ts
type InlineNode = TextNode | InlineObjectNode;

interface TextNode { type: "text"; text: string; marks?: InlineMark[] }
interface InlineObjectNode { type: "object"; kind: string; data: Record<string, unknown>; meta? }
```

- **Text nodes** carry a string and an optional set of marks.
- **Inline objects** are atomic "chips" — placeholders, mentions, fields. The caret treats
  each as a **single unit** (offset width 1). Their `kind` selects a plugin renderer; their
  `data`/`meta` are opaque to the core.

### Marks

`InlineMark` is a discriminated union: `bold`, `italic`, `underline`, `strikethrough`,
`code`, `link { href }`, `color { token }`, `highlight { token }`. `color`/`highlight` carry a
**token** (a theme key), not a raw CSS value — the host maps tokens to colors.
The five boolean marks accept optional `enabled`; omitted means on, while `enabled: false`
is a direct-formatting override that turns inherited host/template formatting off.

### Offsets

Selection and caret offsets are measured in **inline units**: each character counts as 1, and
each inline object counts as 1. Helpers like `splitInlineContent`, `getInlineLength`, and
`getInlineText` operate in these units.

## Sections

Sections are **computed from heading levels**, never stored (decisions D1/D3). A heading owns
the blocks that follow it until the next heading of an equal-or-higher level; a deeper heading
starts a nested subsection.

```ts
const tree = getSectionTree(document);   // SectionTree — nested view
const section = getSection(document, headingId);
const range = getSectionRange(document, headingId); // { start, end } indices into blocks
```

Because containment is derived, structural edits stay simple: changing a heading's `level`, or
moving a heading with `moveSection`, re-levels the affected blocks automatically.

## Numbering

Hierarchical numbers (`1.`, `1.1`, `1.1.1`) and list item numbers are **computed, display-only**
— they are never written into the document.

```ts
const headingNumbers = getHeadingNumbers(document);     // Map<blockId, number[]>  e.g. [1, 2] → "1.2"
const label = formatHeadingNumber([1, 2]);              // "1.2"
const listNumbers = getListItemNumbers(document);       // Map<blockId, number> for numbered lists
```

## Meta bags

Every block, the document, and every inline object can carry a `meta` (and custom blocks /
inline objects also a `data`) bag. These are **opaque** `Record<string, unknown>`: the core
**never reads, interprets, or strips** them, and they **round-trip untouched** through
validation, serialization, and transforms. Exporters pass them to your custom serializers;
paste creates fresh blocks from clipboard content instead of preserving arbitrary host metadata.
This is the host's extension point for domain data (e.g. Minuta's `meta.role`).

## The two entry points

The package ships a **React-free core** and a separate **React surface**:

- **`mogul-text-editor`** (root) — schema, factories, the headless engine, pure transforms,
  the patch pipeline, sections, numbering, serialization. **Zero React**, safe to run on a
  server (e.g. apply LLM-generated patches, export a document). See [Headless & server use](./headless.md).
- **`mogul-text-editor/react`** — hooks and components (`DocumentEditor`, `BlockEditor`),
  the plugin system, paste, and i18n.

Exporters live in their own subpaths (`/export-html`, `/export-markdown`, `/export-docx`) so
the root entry never pulls in React or the heavy `docx` dependency.

## Native-first input

The editor follows a **native-first** model (D16): the browser paints typing into the
per-block `contenteditable`; an `input` handler reads the DOM back into `InlineNode[]`. Model
echoes are recognized by reference and never rewrite the focused block, so the caret is never
disturbed while typing. External changes (undo, patches) *do* rewrite the DOM, preserving the
caret offset.

## See also

- [Getting started](./getting-started.md)
- [API reference](./api-reference.md)
- [Plugins](./plugins.md) · [Exporters](./exporters.md) · [i18n](./i18n.md)
- [Headless & server use](./headless.md)
- [Styling](./styling.md) · [Stability & versioning](./stability.md)
