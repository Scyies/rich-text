# Exporters

Three exporters turn a document into HTML, Markdown, or a Word (`.docx`) file. Each lives in its
own subpath and consumes the **pure model** — zero React — so they run anywhere, including on a
server.

```ts
import { exportHtml } from "mogul-text-editor/export-html";
import { exportMarkdown } from "mogul-text-editor/export-markdown";
import { exportDocx } from "mogul-text-editor/export-docx";
```

They are separate entries so the root package never pulls in the heavy `docx` dependency unless
you actually export to Word.

## Custom blocks & inline objects

The core can't know how to serialize your plugin blocks/chips, so each exporter accepts per-`kind`
serializers:

```ts
exportHtml(doc, {
  renderCustomBlock: (block) => block.kind === "callout" ? `<aside>${block.data.text}</aside>` : "",
  renderInlineObject: (node) => `[${node.data.label}]`,
});
```

Without serializers, the defaults emit a readable fallback and never throw. The `meta`/`data`
bags are passed through to your serializers untouched.

Image blocks with `{ type: "url" }` export directly to HTML/Markdown. Image blocks with
`{ type: "asset" }` are host-owned; pass `resolveImageSource` to HTML/Markdown exporters, or
`renderImageBlock` to the docx exporter after resolving the asset bytes yourself.
For asset-backed `imageGroup` entries, HTML/Markdown use `resolveImageContentSource`, and docx
can use `renderImageContent` to return paragraph-safe content for each table cell. Empty draft
slots (`source.type === "empty"`) are skipped by every exporter — they never appear in the output,
and an `imageGroup` whose slots are all empty emits nothing.

## HTML

`exportHtml(document, options?): string`

```ts
interface HtmlExportOptions {
  renderCustomBlock?: (block: CustomBlock) => string;
  renderInlineObject?: (node: InlineObjectNode) => string;
  resolveImageSource?: (block: ImageBlock) => string | undefined;
  resolveImageContentSource?: (image: ImageGroupEntry) => string | undefined;
  headingNumbers?: boolean; // prefix headings with 1., 1.1, …
}
```

Produces clean, semantic HTML: headings, paragraphs, nested lists grouped from the flat block
list by `indent`, and tables. Tables emit a `<colgroup>` that honors `column.width`
(`percent`/`px`). Marks map to semantic tags; `color`/`highlight` emit
`wte-color-*` / `wte-highlight-*` classes. Images emit `<figure class="wte-image"><img …>` and
an optional `<figcaption>`. Image groups emit `<figure class="wte-image-group">` containing one
row of child `.wte-image` figures with resolved column widths. For grouped images, `columnWidth`
sets the child figure's share of the row, and percent `size.width` sets the `<img>` width inside
that child figure.

## Markdown

`exportMarkdown(document, options?): string`

```ts
interface MarkdownExportOptions {
  renderCustomBlock?: (block: CustomBlock) => string;
  renderInlineObject?: (node: InlineObjectNode) => string;
  resolveImageSource?: (block: ImageBlock) => string | undefined;
  resolveImageContentSource?: (image: ImageGroupEntry) => string | undefined;
  headingNumbers?: boolean;
}
```

Standard CommonMark/GFM. Limitations to be aware of:

- Marks without a Markdown equivalent (underline, highlight) fall back to **inline HTML**;
  `color` is **dropped**.
- GFM tables **always** render a header row, so `showHeader: false` is not represented
  faithfully — the exporter uses the first row as the header.
- Markdown has no standard caption syntax; image captions are emitted as a following paragraph.
- Image groups are emitted as stacked portable Markdown images; side-by-side GFM tables are not
  used because they lose captions and sizing.

## docx

`exportDocx(document, options?): docx.Document`

```ts
import { Packer } from "docx";

const docxDocument = exportDocx(doc, {
  renderCustomBlock: (block) => /* FileChild | FileChild[] */,
  renderImageBlock: (block) => /* FileChild | FileChild[] */,
  renderInlineObject: (node) => node.data.label as string,
});

const blob = await Packer.toBlob(docxDocument);     // browser
// const buffer = await Packer.toBuffer(docxDocument); // node
```

```ts
interface DocxExportOptions {
  renderCustomBlock?: (block: CustomBlock) => FileChild | FileChild[];
  renderImageBlock?: (block: ImageBlock) => FileChild | FileChild[] | undefined;
  renderImageContent?: (image: ImageContent) => Paragraph[] | undefined;
  renderInlineObject?: (node: InlineObjectNode) => string;
}
```

Notes:

- **`docx` is an optional peer dependency** — install it in your app (you already need it for
  `Packer`). Keeping a single `docx` instance avoids `Packer`/`Document` version mismatches.
- `exportDocx` returns a `docx` `Document`; **you** pack it, so you can inspect or extend it
  first (add a cover page, headers/footers, etc.).
- Mark support is best-effort: `code` → monospace run, `color` applied only when the token is a
  6-digit hex, `highlight` dropped. `TableColumn.width` is ignored in v1.0.
- Image embedding is host-owned. Without `renderImageBlock`, the exporter emits a readable
  fallback paragraph; use `renderImageBlock` to return a `Paragraph` containing docx's
  `ImageRun` after resolving your asset bytes.
- Image groups export as a one-row borderless `docx.Table`. Use `renderImageContent` for content
  that can safely live inside each table cell. For single image blocks, `renderImageBlock` still
  takes precedence over `renderImageContent`.
- Grouped-image sizing in docx is host-owned: `columnWidth` controls the table cell width, but
  `size` only affects real embedded images if your `renderImageContent` implementation applies it.

### Template-grade Word output

The built-in `exportDocx` is intentionally a **minimal, generic** translator. Page setup,
headers/footers, style-by-`meta.role`, placeholder→field mapping, and multilevel numbering are
**not** in the library for v1.0 — build that in your app on top of the pure model
(`getSectionTree`, `getHeadingNumbers`, the inline helpers), or post-process the returned
`Document`. See [Stability & versioning](./stability.md#docx) for the rationale.

## Server-side export

All three exporters are React-free and DOM-free, so you can render a document to a file on the
server straight from stored JSON:

```ts
import { deserializeDocument } from "mogul-text-editor";
import { exportHtml } from "mogul-text-editor/export-html";

const html = exportHtml(deserializeDocument(jsonFromDb));
```

See [Headless & server use](./headless.md).
