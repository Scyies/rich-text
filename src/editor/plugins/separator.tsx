import { createSeparatorBlock, SEPARATOR_BLOCK_KIND } from "./separator-core";
import type { EditorPlugin } from "./types";

export const separatorPlugin: EditorPlugin = {
  name: "wte-separator",
  blockTypes: [
    {
      kind: SEPARATOR_BLOCK_KIND,
      render: () => <div className="wte-separator" role="separator" aria-orientation="horizontal" />,
    },
  ],
  slashItems: [
    {
      id: "separator",
      label: "Separator",
      hint: "---",
      keywords: ["divider", "rule", "hr", "linha", "divisor", "separador"],
      apply: ({ blockId, commands }) => {
        commands.insertBlockAfter(blockId, createSeparatorBlock());
      },
    },
  ],
};
