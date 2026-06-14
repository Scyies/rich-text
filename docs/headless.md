# Headless & server use

The root entry, `wealthy-text-editor`, is **React-free and DOM-free**. It holds the schema, the
headless engine, the pure transforms, the patch pipeline, sections, numbering, and
serialization. You can run all of it on a server or in a worker — to apply LLM-generated edits,
validate stored documents, or export — without ever touching React.

```ts
import {
  createEditorEngine,
  applyPatches,
  validateDocument,
  serializeDocument,
  deserializeDocument,
} from "wealthy-text-editor";
```

## The engine

`createEditorEngine` owns a working document and runs every change through one transaction
pipeline (history + subscriber notification). It's what `useDocumentEditor` is built on, and you
can use it directly.

```ts
const engine = createEditorEngine({ value: deserializeDocument(json) });

const unsubscribe = engine.subscribe((document, info) => {
  // info.origin: "command" | "patches" | "history" | "set-document" | "selection"
  persist(serializeDocument(document));
});

engine.commands.turnInto(headingId, { type: "heading", level: 2 });
engine.commands.undo();

engine.getSectionTree();      // derived structure
engine.getDocument();         // current document
unsubscribe();
```

`EditorEngineOptions`: `{ value, limit?, coalesceWindowMs? }`. The full command set is in the
[API reference](./api-reference.md#editorcommands).

## Applying external edits (LLM / server) — `applyPatches`

`applyPatches` is the **single, validated entry point** for edits that don't come from user
interaction. Patches are plain data, validated with Zod, applied in order, and **atomic** — any
failure leaves the document untouched, and the result is fully re-validated (patch authors are
untrusted).

```ts
import { applyPatches } from "wealthy-text-editor";

const { document, applied } = applyPatches(current, [
  { op: "update_block", blockId, changes: { content: [{ type: "text", text: "Updated" }] } },
  { op: "insert_block_after", afterBlockId: blockId, block: { type: "text", variant: "paragraph", content: [] } },
  { op: "turn_into", blockId, target: { type: "heading", level: 1 } },
]);
```

Patch operations: `update_block`, `insert_block_after`, `delete_block`, `move_block`,
`turn_into`, `move_section`, `delete_section`, `duplicate_section`. Inserted blocks may omit
`id` — one is generated. On the client, the same pipeline is reachable as a single undoable
transaction via `editor.commands.applyPatches(patches)`.

This makes the model a clean target for an AI agent: have the model emit patches, validate &
apply them with `applyPatches`, persist the result.

## Validation & serialization

```ts
serializeDocument(document);          // validates, then JSON.stringify
deserializeDocument(json);            // JSON.parse, then validates (throws on bad input)

validateDocument(unknown);            // throws on invalid
safeValidateDocument(unknown);        // { success, document } | { success, error }
```

`meta`/`data` bags round-trip untouched throughout. Always validate documents arriving from
storage or a model before trusting them.

## Deriving structure for rendering or export

Sections and numbering are pure functions over the document — ideal for server-side rendering,
tables of contents, or feeding a custom exporter:

```ts
import { getSectionTree, getHeadingNumbers, formatHeadingNumber } from "wealthy-text-editor";

const tree = getSectionTree(document);
const numbers = getHeadingNumbers(document); // Map<blockId, number[]>
```

These helpers (plus the inline utilities and `serialize`/`deserialize`) are the stable foundation
a host builds on — for example, a custom Word generator for legal templates. See
[Exporters → Template-grade Word output](./exporters.md#template-grade-word-output).

## See also

- [Concepts: the two entry points](./concepts.md#the-two-entry-points)
- [API reference: root](./api-reference.md#root--wealthy-text-editor)
