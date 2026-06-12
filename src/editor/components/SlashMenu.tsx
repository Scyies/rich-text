import type { CSSProperties } from "react";

/**
 * Slash command menu (D11). Opened by typing "/" in a text block; the
 * query is the text typed after the slash. Filtering, highlight movement,
 * and application are controlled by DocumentEditor — this component is
 * purely presentational.
 */

export interface SlashMenuItem {
  id: string;
  label: string;
  /** Short hint shown right of the label, e.g. "#" or "1." */
  hint?: string;
  keywords?: string[];
}

export const CORE_SLASH_ITEMS: SlashMenuItem[] = [
  { id: "heading-1", label: "Heading 1", hint: "#", keywords: ["h1", "title", "titulo"] },
  { id: "heading-2", label: "Heading 2", hint: "##", keywords: ["h2", "subtitle"] },
  { id: "heading-3", label: "Heading 3", hint: "###", keywords: ["h3"] },
  { id: "paragraph", label: "Text", hint: "¶", keywords: ["p", "paragraph", "texto"] },
  { id: "bullet", label: "Bulleted list", hint: "•", keywords: ["ul", "bullet", "lista"] },
  { id: "numbered", label: "Numbered list", hint: "1.", keywords: ["ol", "ordered", "lista"] },
  { id: "table", label: "Table", hint: "⊞", keywords: ["table", "tabela", "grid"] },
];

export function filterSlashItems(items: SlashMenuItem[], query: string): SlashMenuItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return items;
  }
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) ||
      (item.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle)),
  );
}

export interface SlashMenuProps {
  items: SlashMenuItem[];
  highlightedIndex: number;
  onSelect(item: SlashMenuItem): void;
  onHighlight(index: number): void;
  style?: CSSProperties | undefined;
}

export function SlashMenu({ items, highlightedIndex, onSelect, onHighlight, style }: SlashMenuProps) {
  return (
    <div className="wte-slash-menu" role="listbox" aria-label="Block types" style={style}>
      {items.length === 0 ? (
        <div className="wte-slash-menu__empty">No results</div>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === highlightedIndex}
            className={
              index === highlightedIndex
                ? "wte-slash-menu__item wte-slash-menu__item--active"
                : "wte-slash-menu__item"
            }
            onMouseEnter={() => onHighlight(index)}
            onMouseDown={(event) => {
              event.preventDefault(); // keep focus in the block
              onSelect(item);
            }}
          >
            <span className="wte-slash-menu__label">{item.label}</span>
            {item.hint !== undefined && <span className="wte-slash-menu__hint">{item.hint}</span>}
          </button>
        ))
      )}
    </div>
  );
}
