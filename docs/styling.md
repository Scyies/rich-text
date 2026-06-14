# Styling

The editor is **headless**: it ships structure and behavior, and an *optional* default theme you
can take or leave.

```ts
import "wealthy-text-editor/styles.css";
```

The stylesheet uses prefixed `.wte-*` classes and `--wte-*` CSS custom properties. You can:

1. import it and tweak the variables,
2. import it and override classes, or
3. skip it entirely and write your own CSS against the structure.

## Theming with variables

The fastest customization is overriding the CSS variables on a container:

```css
.wte-editor {
  --wte-foreground: #1c2733;
  --wte-muted: #6b7682;
  --wte-border: #d4d9de;
  --wte-accent: #2563eb;
  --wte-accent-soft: rgba(37, 99, 235, 0.12);
  --wte-surface: #ffffff;
  --wte-radius: 6px;
}
```

These seven variables are the **stable theming contract**:

| Variable | Used for |
| --- | --- |
| `--wte-foreground` | Text color |
| `--wte-muted` | Secondary text (hints, markers, placeholders) |
| `--wte-border` | Borders (tables, menus) |
| `--wte-accent` | Selection / active accents |
| `--wte-accent-soft` | Soft accent backgrounds |
| `--wte-surface` | Menu / popover backgrounds |
| `--wte-radius` | Corner radius |

## Stable structural classes

These class names are part of the public contract and safe to target:

| Class | Element |
| --- | --- |
| `.wte-editor` | The editor root container |
| `.wte-block` | A block wrapper |
| `.wte-inline-editor` | A block's editable line |
| `.wte-inline-object` | An inline-object chip |
| `.wte-table` | A table |
| `.wte-separator` | The separator block |

## Internal classes (not stable)

Everything else is an **implementation detail** and may change between minor versions without
notice — don't rely on it. This includes (non-exhaustively):

- `.wte-floating-toolbar`, `.wte-floating-toolbar__*`
- `.wte-slash-menu`, `.wte-slash-menu__*`
- `.wte-chip-popover`
- `.wte-block__gutter`, `.wte-block__handle`, `.wte-block__chevron`, `.wte-block__marker`,
  `.wte-block__number`, `.wte-block__line`
- `.wte-block--*` modifiers (`--heading`, `--paragraph`, `--bullet`, `--numbered`, `--selected`, …)
- `.wte-trailing-line`

If you find yourself needing one of these as a stable hook, open an issue — promoting a class to
the stable set is a non-breaking change.

## Bring your own CSS

Because the model is plain data and the DOM structure is predictable, you can style entirely
from scratch (e.g. with Tailwind) by targeting the stable classes above and ignoring the bundled
stylesheet. The library never inlines visual styles into the document — `color`/`highlight`
marks carry **tokens**, not CSS values, which you map to colors in your own theme.

## See also

- [Stability & versioning](./stability.md)
- [Concepts: marks](./concepts.md#marks)
