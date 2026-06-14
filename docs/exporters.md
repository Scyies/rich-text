# Exporters

Three exporters turn a document into HTML, Markdown, or a Word (`.docx`) file. Each lives in its
own subpath and consumes the **pure model** — zero React — so they run anywhere, including on a
server.

```ts
import { exportHtml } from "wealthy-text-editor/export-html";
import { exportMarkdown } from "wealthy-text-editor/export-markdown";
import { exportDocx } from "wealthy-text-editor/export-docx";
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

## HTML

`exportHtml(document, options?): string`

```ts
interface HtmlExportOptions {
  renderCustomBlock?: (block: CustomBlock) => string;
  renderInlineObject?: (node: InlineObjectNode) => string;
  headingNumbers?: boolean; // prefix headings with 1., 1.1, …
}
```

Produces clean, semantic HTML: headings, paragraphs, nested lists grouped from the flat block
list by `indent`, and tables. Tables emit a `<colgroup>` that honors `column.width`
(`percent`/`px`). Marks map to semantic tags; `color`/`highlight` emit
`wte-color-*` / `wte-highlight-*` classes.

## Markdown

`exportMarkdown(document, options?): string`

```ts
interface MarkdownExportOptions {
  renderCustomBlock?: (block: CustomBlock) => string;
  renderInlineObject?: (node: InlineObjectNode) => string;
  headingNumbers?: boolean;
}
```

Standard CommonMark/GFM. Limitations to be aware of:

- Marks without a Markdown equivalent (underline, highlight) fall back to **inline HTML**;
  `color` is **dropped**.
- GFM tables **always** render a header row, so `showHeader: false` is not represented
  faithfully — the exporter uses the first row as the header.

## docx

`exportDocx(document, options?): docx.Document`

```ts
import { Packer } from "docx";

const docxDocument = exportDocx(doc, {
  renderCustomBlock: (block) => /* FileChild | FileChild[] */,
  renderInlineObject: (node) => node.data.label as string,
});

const blob = await Packer.toBlob(docxDocument);     // browser
// const buffer = await Packer.toBuffer(docxDocument); // node
```

```ts
interface DocxExportOptions {
  renderCustomBlock?: (block: CustomBlock) => FileChild | FileChild[];
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
import { deserializeDocument } from "wealthy-text-editor";
import { exportHtml } from "wealthy-text-editor/export-html";

const html = exportHtml(deserializeDocument(jsonFromDb));
```

See [Headless & server use](./headless.md).
