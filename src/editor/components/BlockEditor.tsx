import { useMemo, type ReactNode } from "react";
import type { ChangeInfo } from "../core/commands";
import type { Block, BlockMeta, CustomBlock, TableBlock } from "../core/schema";
import { useBlockEditor } from "../hooks/useBlockEditor";
import { resolveMessages, MessagesProvider, type EditorMessages, type Locale } from "../i18n";
import { InlineEditor } from "./InlineEditor";
import { TableView } from "./TableView";

/**
 * <BlockEditor> — secondary API: edits one block in isolation (same
 * validation and undo pipeline as the full editor, via useBlockEditor).
 * No slash menu, no drag-and-drop, no sections — just the block.
 */

export interface BlockEditorProps<TMeta extends BlockMeta = BlockMeta> {
  value: Block<TMeta>;
  onChange?: ((block: Block<TMeta>, info: ChangeInfo) => void) | undefined;
  onCommit?: ((block: Block<TMeta>) => void) | undefined;
  commitIdleMs?: number | undefined;
  readOnly?: boolean | undefined;
  placeholder?: string | undefined;
  /** UI locale for built-in chrome (default `en`). */
  locale?: Locale | undefined;
  /** Per-string overrides on top of the resolved `locale`. */
  messages?: Partial<EditorMessages> | undefined;
  className?: string | undefined;
  renderBlock?:
    | ((props: { block: CustomBlock<TMeta>; readOnly: boolean; update(patch: Record<string, unknown>): void }) => ReactNode)
    | undefined;
}

export function BlockEditor<TMeta extends BlockMeta = BlockMeta>(props: BlockEditorProps<TMeta>) {
  const { readOnly = false } = props;
  const messages = useMemo(
    () => resolveMessages(props.locale, props.messages),
    [props.locale, props.messages],
  );
  const editor = useBlockEditor<TMeta>({
    value: props.value,
    onChange: props.onChange,
    onCommit: props.onCommit,
    commitIdleMs: props.commitIdleMs,
  });
  const block = editor.block;

  return (
    <MessagesProvider messages={messages}>
    <div
      className={["wte-block-editor", props.className].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            editor.redo();
          } else {
            editor.undo();
          }
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
          event.preventDefault();
          editor.redo();
        }
      }}
    >
      {(block.type === "heading" || block.type === "text") && (
        <InlineEditor
          as={block.type === "heading" ? (`h${block.level}` as "h1") : "p"}
          content={block.content}
          readOnly={readOnly}
          placeholder={props.placeholder}
          ariaLabel={
            block.type === "heading" ? messages.headingAriaLabel(block.level) : messages.textBlockAriaLabel
          }
          style={block.align !== undefined ? { textAlign: block.align } : undefined}
          onContentChange={(content) => editor.update({ content })}
          onSelectionChange={(start, end) =>
            editor.setSelection({ type: "text", blockId: block.id, anchor: start, focus: end })
          }
        />
      )}

      {block.type === "table" && (
        <TableView
          block={block as TableBlock}
          readOnly={readOnly}
          onTableChange={(patch) => editor.update(patch)}
        />
      )}

      {block.type === "custom" &&
        (props.renderBlock !== undefined ? (
          props.renderBlock({
            block: block as CustomBlock<TMeta>,
            readOnly,
            update: editor.update,
          })
        ) : (
          <div className="wte-block__custom-fallback">
            <span className="wte-block__custom-kind">{(block as CustomBlock<TMeta>).kind}</span>
          </div>
        ))}
    </div>
    </MessagesProvider>
  );
}
