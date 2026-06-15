import { useCallback, useMemo, type FocusEvent as ReactFocusEvent, type ReactNode } from "react";
import type { ChangeInfo } from "../core/commands";
import type { Block, BlockMeta, CustomBlock, ImageBlock, ImageGroupBlock, ImageGroupEntry, TableBlock } from "../core/schema";
import { useBlockEditor } from "../hooks/useBlockEditor";
import { resolveMessages, MessagesProvider, type EditorMessages, type Locale } from "../i18n";
import type { RenderBlockProps } from "../plugins/types";
import { ImageGroupView, ImageView } from "./ImageView";
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
  ariaLabel?: string | undefined;
  /** Resolve host-owned image assets to renderable URLs. URL images do not call this. */
  resolveImageSource?: ((block: ImageBlock<TMeta>) => string | undefined) | undefined;
  /** Resolve host-owned image group entries to renderable URLs. URL entries do not call this. */
  resolveImageContentSource?: ((entry: ImageGroupEntry<TMeta>) => string | undefined) | undefined;
  renderBlock?: ((props: RenderBlockProps<TMeta>) => ReactNode) | undefined;
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
  const handleBlur = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }
      editor.commit();
    },
    [editor],
  );

  return (
    <MessagesProvider messages={messages}>
    <div
      className={["wte-block-editor", props.className].filter(Boolean).join(" ")}
      role="textbox"
      aria-multiline
      aria-label={props.ariaLabel ?? messages.documentAriaLabel}
      onBlur={handleBlur}
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

      {block.type === "image" && (
        <ImageView
          block={block as ImageBlock}
          readOnly={readOnly}
          resolveImageSource={props.resolveImageSource as ((block: ImageBlock) => string | undefined) | undefined}
          onImageChange={(patch) => editor.update(patch)}
        />
      )}

      {block.type === "imageGroup" && (
        <ImageGroupView
          block={block as ImageGroupBlock}
          readOnly={readOnly}
          resolveImageContentSource={props.resolveImageContentSource as ((entry: ImageGroupEntry) => string | undefined) | undefined}
          onImageGroupChange={(patch) => editor.update(patch)}
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
