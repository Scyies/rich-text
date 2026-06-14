import type { CSSProperties } from "react";
import { en, useMessages, type EditorMessages } from "../i18n";

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

/** Locale-independent shape of the core items; labels come from messages. */
const CORE_SLASH_ITEM_SPECS: Array<{
  id: string;
  label: (m: EditorMessages) => string;
  hint: string;
  keywords: string[];
}> = [
  { id: "heading-1", label: (m) => m.slashHeading1, hint: "#", keywords: ["h1", "title", "titulo"] },
  { id: "heading-2", label: (m) => m.slashHeading2, hint: "##", keywords: ["h2", "subtitle"] },
  { id: "heading-3", label: (m) => m.slashHeading3, hint: "###", keywords: ["h3"] },
  { id: "paragraph", label: (m) => m.slashText, hint: "¶", keywords: ["p", "paragraph", "texto"] },
  { id: "bullet", label: (m) => m.slashBulletedList, hint: "•", keywords: ["ul", "bullet", "lista"] },
  { id: "numbered", label: (m) => m.slashNumberedList, hint: "1.", keywords: ["ol", "ordered", "lista"] },
  { id: "table", label: (m) => m.slashTable, hint: "⊞", keywords: ["table", "tabela", "grid"] },
];

/** Builds the core block-type slash items with localized labels. */
export function buildCoreSlashItems(messages: EditorMessages): SlashMenuItem[] {
  return CORE_SLASH_ITEM_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label(messages),
    hint: spec.hint,
    keywords: spec.keywords,
  }));
}

/** Core slash items with English labels (back-compat; default locale chrome). */
export const CORE_SLASH_ITEMS: SlashMenuItem[] = buildCoreSlashItems(en);

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
  const messages = useMessages();
  return (
    <div className="wte-slash-menu" role="listbox" aria-label={messages.slashMenuAriaLabel} style={style}>
      {items.length === 0 ? (
        <div className="wte-slash-menu__empty">{messages.slashNoResults}</div>
      ) : (
        items.map((item, index) => (
          <button
            key={`${item.id}:${index}`}
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
