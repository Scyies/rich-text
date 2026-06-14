# Plugins

Plugins extend the editor with **custom blocks**, **inline-object chips**, **slash-menu items**,
and **toolbar buttons**. They live entirely on the React side and are passed via the `plugins`
prop. Everything is additive — the core never knows about your domain.

```tsx
import { DocumentEditor, separatorPlugin, type EditorPlugin } from "wealthy-text-editor/react";

<DocumentEditor value={doc} onChange={setDoc} plugins={[separatorPlugin, myPlugin]} />;
```

An `EditorPlugin` has a unique `name` and any combination of the four registrations:

```ts
interface EditorPlugin<TMeta = BlockMeta> {
  name: string;
  blockTypes?: BlockTypeRegistration<TMeta>[];
  inlineObjects?: InlineObjectRegistration[];
  slashItems?: CustomSlashItem<TMeta>[];
  toolbarItems?: ToolbarItemRegistration<TMeta>[];
}
```

## Custom blocks (`blockTypes`)

Render a `CustomBlock` of a given `kind`. The host owns the UI; the core just stores
`block.data` (an opaque bag) and round-trips it.

```tsx
const calloutPlugin: EditorPlugin = {
  name: "callout",
  blockTypes: [
    {
      kind: "callout",
      render: ({ block, readOnly, update }) => (
        <div className="callout">
          💡{" "}
          <input
            readOnly={readOnly}
            value={String(block.data.text ?? "")}
            onChange={(e) => update({ data: { ...block.data, text: e.target.value } })}
          />
        </div>
      ),
    },
  ],
};
```

`render` receives `RenderBlockProps`: `{ block, readOnly, update(patch) }`. A `blockTypes`
registration **takes precedence over** the `renderBlock` prop for the same `kind`. Create the
block with `createCustomBlock({ kind: "callout", data: { text: "" } })`.

## Inline-object chips (`inlineObjects`)

Chips are atomic inline tokens — placeholders, mentions, fields. They render as a single unit
in the contenteditable (native-first, D16); the optional edit UI appears in a click-to-edit
popover owned by the editor.

```tsx
const placeholderPlugin: EditorPlugin = {
  name: "placeholders",
  inlineObjects: [
    {
      kind: "placeholder",
      getLabel: (node) => String(node.data.value ?? node.data.label ?? "field"),
      getClassName: (node) => (node.data.value ? "filled" : "empty"),
      // Omit renderEditor to make the chip non-interactive.
      renderEditor: (node, { update, remove, close }) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("v") as HTMLInputElement;
            update({ data: { ...node.data, value: input.value } });
            close();
          }}
        >
          <input name="v" autoFocus defaultValue={String(node.data.value ?? "")} />
          <button type="button" onClick={remove}>Remove</button>
          <button type="submit">Save</button>
        </form>
      ),
    },
  ],
};
```

`InlineObjectRegistration`:

| Field | Type | Purpose |
| --- | --- | --- |
| `kind` | `string` | Matches `InlineObjectNode.kind`. |
| `getLabel?` | `(node) => string` | Chip text (default: `data.label` ?? `kind`). |
| `getClassName?` | `(node) => string \| undefined` | Extra class (e.g. filled/empty state). |
| `renderEditor?` | `(node, ctx) => ReactNode` | Popover content; omit → non-interactive. |

The popover context (`InlineObjectEditorContext`): `update({ data?, meta? })` replaces the
chip's data/meta (atomic, undoable), `remove()` deletes the chip, `close()` dismisses the
popover. Insert a chip from host UI with
`api.commands.insertInlineNode(blockId, offset, { type: "object", kind: "placeholder", data: {…} })`,
or let users type `{{label}}` (see `inlineTagToNode`).

## Slash items (`slashItems`)

Add entries to the `/` menu. Each has the visual fields plus an `apply` callback.

```ts
const slashPlugin: EditorPlugin = {
  name: "fields",
  slashItems: [
    {
      id: "placeholder",
      label: "Placeholder",
      hint: "{{}}",
      keywords: ["field", "tag"],
      apply: ({ insertInlineNode }) =>
        insertInlineNode({ type: "object", kind: "placeholder", data: { key: "field", label: "Field" } }),
    },
  ],
};
```

`SlashItemContext`: `{ blockId, query, insertInlineNode(node), commands }`.

### Precedence & duplicate ids

Slash items are shown in this order, and this order is frozen:

```
core block types → host `slashItems` prop → plugin `slashItems`
```

If two items share an `id`, the **host prop wins** over a plugin item when applied. (There's
also a standalone `slashItems` prop on `DocumentEditor` for app-level items without a plugin.)

## Toolbar items (`toolbarItems`)

Add buttons after the built-in mark buttons in the floating toolbar.

```ts
const toolbarPlugin: EditorPlugin = {
  name: "highlight",
  toolbarItems: [
    {
      id: "highlight",
      label: "HL",
      title: "Highlight",
      isActive: (activeMarks) => activeMarks.has("highlight"),
      apply: ({ commands, selection }) => {
        /* toggle a highlight mark on the selection */
      },
    },
  ],
};
```

`ToolbarItemContext`: `{ commands, selection }`.

## The built-in separator plugin

`separatorPlugin` renders the separator (horizontal rule) block and adds a `/separator` slash
item. Create separators programmatically with `createSeparatorBlock()` (exported from both the
root and `/react`). It's a complete, minimal example of a custom-block plugin.

## A note on i18n

The core chrome is localized (see [i18n](./i18n.md)), but **plugin-authored strings** — your
slash labels, toolbar titles, popover text — are the plugin author's responsibility. Localize
them yourself if needed.

## See also

- [Concepts: inline content & meta bags](./concepts.md#inline-content)
- [API reference: plugin types](./api-reference.md#components)
