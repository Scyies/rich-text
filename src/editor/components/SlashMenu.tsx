import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
  { id: "image", label: (m) => m.slashImage, hint: "img", keywords: ["img", "image", "picture", "photo", "imagem"] },
  {
    id: "image-group",
    label: (m) => m.slashImageGroup,
    hint: "img+",
    keywords: ["images", "image row", "image group", "gallery", "side by side", "imagens", "linha"],
  },
];

/** Builds the core block-type slash items with localized labels. */
export function buildCoreSlashItems(
  messages: EditorMessages,
  options: { includeImage?: boolean | undefined; includeImageGroup?: boolean | undefined } = {},
): SlashMenuItem[] {
  return CORE_SLASH_ITEM_SPECS.filter((spec) => {
    if (spec.id === "image") {
      return options.includeImage === true;
    }
    if (spec.id === "image-group") {
      return options.includeImageGroup === true;
    }
    return true;
  }).map((spec) => ({
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

/** Caret-line anchor (viewport coords) the menu positions itself against. */
export interface SlashMenuAnchor {
  x: number;
  /** Top of the caret's line box. */
  top: number;
  /** Bottom of the caret's line box. */
  bottom: number;
}

export interface SlashMenuProps {
  items: SlashMenuItem[];
  highlightedIndex: number;
  onSelect(item: SlashMenuItem): void;
  onHighlight(index: number): void;
  anchor: SlashMenuAnchor;
}

/** Gap between the caret line and the menu; safe margin from the viewport edge. */
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;

export function SlashMenu({ items, highlightedIndex, onSelect, onHighlight, anchor }: SlashMenuProps) {
  const messages = useMessages();
  const menuRef = useRef<HTMLDivElement>(null);
  // Render hidden at a first guess, then measure and place it — flipping above
  // the caret line when there isn't room below (e.g. near the end of the page).
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    top: anchor.bottom + MENU_GAP,
    left: anchor.x,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (element === null || typeof window === "undefined") {
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = element;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - anchor.bottom;
    const spaceAbove = anchor.top;
    const placeAbove = spaceBelow < height + MENU_GAP && spaceAbove > spaceBelow;
    const rawTop = placeAbove ? anchor.top - MENU_GAP - height : anchor.bottom + MENU_GAP;
    const top = Math.max(VIEWPORT_MARGIN, Math.min(rawTop, viewportHeight - height - VIEWPORT_MARGIN));
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, viewportWidth - width - VIEWPORT_MARGIN));
    setStyle({ position: "fixed", top, left, visibility: "visible" });
    // `items` (not just its length): filtering can swap the longest label —
    // changing width/height — without changing the count, which matters for the
    // edge clamps near the right/bottom of the viewport.
  }, [anchor, items]);

  return (
    <div ref={menuRef} className="wte-slash-menu" role="listbox" aria-label={messages.slashMenuAriaLabel} style={style}>
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
