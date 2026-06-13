import type { CSSProperties } from "react";
import type { InlineMark } from "../core/schema";

/**
 * Floating marks toolbar, shown over a non-collapsed text selection inside
 * a block. Purely presentational; DocumentEditor owns position and state.
 */

/** Pre-bound custom toolbar button (DocumentEditor binds active/onClick from plugin items). */
export interface FloatingToolbarExtraItem {
  id: string;
  label: string;
  title?: string | undefined;
  active?: boolean | undefined;
  onClick(): void;
}

export interface FloatingToolbarProps {
  activeMarkTypes: ReadonlySet<InlineMark["type"]>;
  onToggleMark(mark: InlineMark): void;
  /** Extra buttons (from plugins) shown after the mark buttons. */
  extraItems?: FloatingToolbarExtraItem[] | undefined;
  style?: CSSProperties | undefined;
}

const BUTTONS: Array<{ mark: InlineMark; label: string; title: string }> = [
  { mark: { type: "bold" }, label: "B", title: "Bold" },
  { mark: { type: "italic" }, label: "I", title: "Italic" },
  { mark: { type: "underline" }, label: "U", title: "Underline" },
  { mark: { type: "strikethrough" }, label: "S", title: "Strikethrough" },
  { mark: { type: "code" }, label: "</>", title: "Code" },
];

export function FloatingToolbar({ activeMarkTypes, onToggleMark, extraItems, style }: FloatingToolbarProps) {
  return (
    <div className="wte-floating-toolbar" role="toolbar" aria-label="Text formatting" style={style}>
      {BUTTONS.map(({ mark, label, title }) => (
        <button
          key={mark.type}
          type="button"
          title={title}
          aria-pressed={activeMarkTypes.has(mark.type)}
          className={
            activeMarkTypes.has(mark.type)
              ? `wte-floating-toolbar__button wte-floating-toolbar__button--active wte-mark-${mark.type}`
              : `wte-floating-toolbar__button wte-mark-${mark.type}`
          }
          onMouseDown={(event) => {
            event.preventDefault(); // keep the text selection alive
            onToggleMark(mark);
          }}
        >
          {label}
        </button>
      ))}
      {extraItems?.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.title}
          aria-pressed={item.active === true}
          className={
            item.active === true
              ? "wte-floating-toolbar__button wte-floating-toolbar__button--active"
              : "wte-floating-toolbar__button"
          }
          onMouseDown={(event) => {
            event.preventDefault(); // keep the text selection alive
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
