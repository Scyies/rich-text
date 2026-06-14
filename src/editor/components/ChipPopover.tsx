import type { CSSProperties, ReactNode } from "react";
import { useMessages } from "../i18n";

/**
 * Fixed-position overlay hosting an inline object's click-to-edit/fill UI
 * (the plugin's `renderEditor`). Presentational only — DocumentEditor owns
 * position and lifetime (outside-click / Escape), mirroring SlashMenu.
 */

export interface ChipPopoverProps {
  children: ReactNode;
  style?: CSSProperties | undefined;
}

export function ChipPopover({ children, style }: ChipPopoverProps) {
  const messages = useMessages();
  return (
    <div className="wte-chip-popover" role="dialog" aria-label={messages.chipEditAriaLabel} style={style}>
      {children}
    </div>
  );
}
