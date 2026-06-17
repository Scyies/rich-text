import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { resolveImageGroupColumnWidths } from "../core/image-layout";
import {
  isFilledImageGroupEntry,
  type ImageBlock,
  type ImageContentBase,
  type ImageGroupBlock,
  type ImageGroupEntry,
  type ImageSize,
  type InlineNode,
} from "../core/schema";
import { useMessages } from "../i18n";
import { InlineEditor, type InlineEditorHandle } from "./InlineEditor";

const MIN_WIDTH_PERCENT = 10;
const MAX_WIDTH_PERCENT = 100;

export interface ImageViewProps {
  block: ImageBlock;
  readOnly?: boolean | undefined;
  resolveImageSource?: ((block: ImageBlock) => string | undefined) | undefined;
  onImageChange(patch: { caption?: InlineNode[]; size?: ImageSize }): void;
  /** Registers the caption editor so the host can focus/navigate into it. */
  registerCaptionEditor?: ((handle: InlineEditorHandle | null) => void) | undefined;
  onCaptionSelectionChange?: ((start: number, end: number) => void) | undefined;
  onCaptionFocus?: (() => void) | undefined;
  onCaptionBlur?: (() => void) | undefined;
  /** Enter in the caption (e.g. exit to a new paragraph below the image). */
  onCaptionEnter?: (() => void) | undefined;
  /** Backspace with a collapsed caret at the caption start. */
  onCaptionBackspaceAtStart?: (() => void) | undefined;
  /** Arrow at the caption's top/bottom edge; return true when focus moved away. */
  onCaptionArrowUp?: (() => boolean) | undefined;
  onCaptionArrowDown?: (() => boolean) | undefined;
}

/** Direction an image-row item's arrow key moves focus toward. */
export type ImageItemArrow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export interface ImageGroupViewProps {
  block: ImageGroupBlock;
  readOnly?: boolean | undefined;
  resolveImageContentSource?: ((entry: ImageGroupEntry) => string | undefined) | undefined;
  onImageGroupChange(patch: { images?: ImageGroupBlock["images"] }): void;
  /**
   * Caption editor wiring, addressed per entry so the host can register,
   * focus, and navigate each group caption independently.
   */
  registerCaptionEditor?: ((entryId: string, handle: InlineEditorHandle | null) => void) | undefined;
  onCaptionSelectionChange?: ((entryId: string, start: number, end: number) => void) | undefined;
  onCaptionFocus?: ((entryId: string) => void) | undefined;
  onCaptionBlur?: ((entryId: string) => void) | undefined;
  onCaptionEnter?: ((entryId: string) => void) | undefined;
  onCaptionBackspaceAtStart?: ((entryId: string) => void) | undefined;
  onCaptionArrowUp?: ((entryId: string) => boolean) | undefined;
  onCaptionArrowDown?: ((entryId: string) => boolean) | undefined;
  /** Registers each item's focusable surface so the host can navigate to it. */
  registerItemElement?: ((entryId: string, element: HTMLElement | null) => void) | undefined;
  /** An image was dropped onto the entry's slot/frame (fill or replace). */
  onEntryDrop?: ((entryId: string, dataTransfer: DataTransfer) => void) | undefined;
  /** An image was pasted while the entry's surface held focus. */
  onEntryPaste?: ((entryId: string, dataTransfer: DataTransfer) => void) | undefined;
  /** The entry's surface received focus (not its caption). */
  onItemFocus?: ((entryId: string) => void) | undefined;
  /** Arrow key on a focused item; return true when focus moved away. */
  onItemArrow?: ((entryId: string, key: ImageItemArrow) => boolean) | undefined;
  /** Appends a new empty column to the row. */
  onAddColumn?: (() => void) | undefined;
  /** Removes the entry's column (deleting the block when it was the last). */
  onRemoveColumn?: ((entryId: string) => void) | undefined;
  /** Transient feedback (e.g. an upload error) shown on a single entry. */
  feedbackEntryId?: string | undefined;
  feedbackMessage?: string | undefined;
}

interface DragState {
  startX: number;
  startWidthPx: number;
  containerWidth: number;
  percent: number;
}

interface ImageContentViewProps {
  content: ImageContentBase;
  src: string | undefined;
  readOnly: boolean;
  showCaption: boolean;
  honorPercentSize: boolean;
  resizeContainerRef?: RefObject<HTMLElement | null> | undefined;
  onContentChange(patch: { caption?: InlineNode[]; size?: ImageSize }): void;
  registerCaptionEditor?: ((handle: InlineEditorHandle | null) => void) | undefined;
  onCaptionSelectionChange?: ((start: number, end: number) => void) | undefined;
  onCaptionFocus?: (() => void) | undefined;
  onCaptionBlur?: (() => void) | undefined;
  onCaptionEnter?: (() => void) | undefined;
  onCaptionBackspaceAtStart?: (() => void) | undefined;
  onCaptionArrowUp?: (() => boolean) | undefined;
  onCaptionArrowDown?: (() => boolean) | undefined;
}

interface ImageGroupItemViewProps {
  entry: ImageGroupEntry;
  width: number;
  align: CSSProperties["textAlign"] | undefined;
  src: string | undefined;
  readOnly: boolean;
  feedback: string | undefined;
  onEntryChange(patch: { caption?: InlineNode[]; size?: ImageSize }): void;
  registerItemElement?: ((element: HTMLElement | null) => void) | undefined;
  onEntryDrop?: ((dataTransfer: DataTransfer) => void) | undefined;
  onEntryPaste?: ((dataTransfer: DataTransfer) => void) | undefined;
  onItemFocus?: (() => void) | undefined;
  onItemArrow?: ((key: ImageItemArrow) => boolean) | undefined;
  onRemoveColumn?: (() => void) | undefined;
  registerCaptionEditor?: ((handle: InlineEditorHandle | null) => void) | undefined;
  onCaptionSelectionChange?: ((start: number, end: number) => void) | undefined;
  onCaptionFocus?: (() => void) | undefined;
  onCaptionBlur?: (() => void) | undefined;
  onCaptionEnter?: (() => void) | undefined;
  onCaptionBackspaceAtStart?: (() => void) | undefined;
  onCaptionArrowUp?: (() => boolean) | undefined;
  onCaptionArrowDown?: (() => boolean) | undefined;
}

export function ImageView({
  block,
  readOnly = false,
  resolveImageSource,
  onImageChange,
  registerCaptionEditor,
  onCaptionSelectionChange,
  onCaptionFocus,
  onCaptionBlur,
  onCaptionEnter,
  onCaptionBackspaceAtStart,
  onCaptionArrowUp,
  onCaptionArrowDown,
}: ImageViewProps) {
  const figureRef = useRef<HTMLElement | null>(null);

  const src = block.source.type === "url" ? block.source.url : resolveImageSource?.(block);
  const figureStyle = block.align !== undefined ? { textAlign: block.align } : undefined;
  const showCaption = !readOnly || block.caption !== undefined;

  return (
    <figure className="wte-image" style={figureStyle} ref={figureRef}>
      <ImageContentView
        content={block}
        src={src}
        readOnly={readOnly}
        showCaption={showCaption}
        honorPercentSize
        resizeContainerRef={figureRef}
        onContentChange={onImageChange}
        registerCaptionEditor={registerCaptionEditor}
        onCaptionSelectionChange={onCaptionSelectionChange}
        onCaptionFocus={onCaptionFocus}
        onCaptionBlur={onCaptionBlur}
        onCaptionEnter={onCaptionEnter}
        onCaptionBackspaceAtStart={onCaptionBackspaceAtStart}
        onCaptionArrowUp={onCaptionArrowUp}
        onCaptionArrowDown={onCaptionArrowDown}
      />
    </figure>
  );
}

export function ImageGroupView({
  block,
  readOnly = false,
  resolveImageContentSource,
  onImageGroupChange,
  registerCaptionEditor,
  onCaptionSelectionChange,
  onCaptionFocus,
  onCaptionBlur,
  onCaptionEnter,
  onCaptionBackspaceAtStart,
  onCaptionArrowUp,
  onCaptionArrowDown,
  registerItemElement,
  onEntryDrop,
  onEntryPaste,
  onItemFocus,
  onItemArrow,
  onAddColumn,
  onRemoveColumn,
  feedbackEntryId,
  feedbackMessage,
}: ImageGroupViewProps) {
  const messages = useMessages();
  // Empty draft slots are layout-only: while editing they render as drop
  // targets, but read-only consumers see only the filled images (and nothing
  // at all when every slot is still empty).
  const entries = readOnly ? block.images.filter(isFilledImageGroupEntry) : block.images;
  if (entries.length === 0) {
    return null;
  }

  const widths = resolveImageGroupColumnWidths(entries);
  const figureStyle = block.align !== undefined ? { textAlign: block.align } : undefined;
  const rowStyle: CSSProperties | undefined = block.gap !== undefined ? { gap: `${block.gap}px` } : undefined;

  function updateEntry(entryId: string, patch: { caption?: InlineNode[]; size?: ImageSize }): void {
    onImageGroupChange({
      images: block.images.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    });
  }

  return (
    <figure className="wte-image-group" style={figureStyle}>
      <div className="wte-image-group__row" style={rowStyle}>
        {entries.map((entry, index) => {
          const src = entry.source.type === "url" ? entry.source.url : resolveImageContentSource?.(entry);
          const width = widths[index] ?? 100 / entries.length;
          return (
            <ImageGroupItemView
              key={entry.id}
              entry={entry}
              width={width}
              align={block.align ?? "center"}
              src={src}
              readOnly={readOnly}
              feedback={feedbackEntryId === entry.id ? feedbackMessage : undefined}
              onEntryChange={(patch) => updateEntry(entry.id, patch)}
              registerItemElement={
                registerItemElement !== undefined ? (element) => registerItemElement(entry.id, element) : undefined
              }
              onEntryDrop={onEntryDrop !== undefined ? (dataTransfer) => onEntryDrop(entry.id, dataTransfer) : undefined}
              onEntryPaste={
                onEntryPaste !== undefined ? (dataTransfer) => onEntryPaste(entry.id, dataTransfer) : undefined
              }
              onItemFocus={onItemFocus !== undefined ? () => onItemFocus(entry.id) : undefined}
              onItemArrow={onItemArrow !== undefined ? (key) => onItemArrow(entry.id, key) : undefined}
              onRemoveColumn={onRemoveColumn !== undefined ? () => onRemoveColumn(entry.id) : undefined}
              registerCaptionEditor={
                registerCaptionEditor !== undefined ? (handle) => registerCaptionEditor(entry.id, handle) : undefined
              }
              onCaptionSelectionChange={
                onCaptionSelectionChange !== undefined
                  ? (start, end) => onCaptionSelectionChange(entry.id, start, end)
                  : undefined
              }
              onCaptionFocus={onCaptionFocus !== undefined ? () => onCaptionFocus(entry.id) : undefined}
              onCaptionBlur={onCaptionBlur !== undefined ? () => onCaptionBlur(entry.id) : undefined}
              onCaptionEnter={onCaptionEnter !== undefined ? () => onCaptionEnter(entry.id) : undefined}
              onCaptionBackspaceAtStart={
                onCaptionBackspaceAtStart !== undefined ? () => onCaptionBackspaceAtStart(entry.id) : undefined
              }
              onCaptionArrowUp={onCaptionArrowUp !== undefined ? () => onCaptionArrowUp(entry.id) : undefined}
              onCaptionArrowDown={onCaptionArrowDown !== undefined ? () => onCaptionArrowDown(entry.id) : undefined}
            />
          );
        })}
      </div>
      {!readOnly && onAddColumn !== undefined && (
        <div className="wte-image-group__controls" contentEditable={false}>
          <button
            type="button"
            className="wte-image-group__add"
            aria-label={messages.imageGroupAddColumnAriaLabel}
            // Keep the editor's focus/caret while clicking the control.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onAddColumn}
          >
            + {messages.imageGroupAddColumnAriaLabel}
          </button>
        </div>
      )}
    </figure>
  );
}

function ImageGroupItemView({
  entry,
  width,
  align,
  src,
  readOnly,
  feedback,
  onEntryChange,
  registerItemElement,
  onEntryDrop,
  onEntryPaste,
  onItemFocus,
  onItemArrow,
  onRemoveColumn,
  registerCaptionEditor,
  onCaptionSelectionChange,
  onCaptionFocus,
  onCaptionBlur,
  onCaptionEnter,
  onCaptionBackspaceAtStart,
  onCaptionArrowUp,
  onCaptionArrowDown,
}: ImageGroupItemViewProps) {
  const messages = useMessages();
  const itemRef = useRef<HTMLElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const isEmpty = entry.source.type === "empty";
  const itemStyle: CSSProperties = {
    flexBasis: `${width}%`,
    textAlign: align,
    width: `${width}%`,
  };

  const setItemRef = useCallback(
    (element: HTMLElement | null) => {
      itemRef.current = element;
      registerItemElement?.(element);
    },
    [registerItemElement],
  );

  const interactive = !readOnly && (onEntryDrop !== undefined || onEntryPaste !== undefined);

  const handleDragOver = useCallback(
    (event: ReactDragEvent) => {
      if (onEntryDrop === undefined || readOnly) {
        return;
      }
      // Claim the drop so it fills this slot instead of reordering blocks.
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    },
    [onEntryDrop, readOnly],
  );

  const handleDragLeave = useCallback((event: ReactDragEvent) => {
    // Ignore bubbling from descendants leaving toward children.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: ReactDragEvent) => {
      if (onEntryDrop === undefined || readOnly) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setDragOver(false);
      onEntryDrop(event.dataTransfer);
    },
    [onEntryDrop, readOnly],
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent) => {
      if (onEntryPaste === undefined || readOnly) {
        return;
      }
      // Only act when the item surface itself holds focus — paste inside the
      // caption is a normal text paste handled by its InlineEditor.
      if (event.currentTarget.ownerDocument.activeElement !== itemRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onEntryPaste(event.clipboardData);
    },
    [onEntryPaste, readOnly],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (readOnly || event.currentTarget !== event.target) {
        return; // let caption keys flow through their own editor
      }
      if ((event.key === "Backspace" || event.key === "Delete") && onRemoveColumn !== undefined) {
        event.preventDefault();
        onRemoveColumn();
        return;
      }
      if (
        onItemArrow !== undefined &&
        (event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown")
      ) {
        if (onItemArrow(event.key)) {
          event.preventDefault();
        }
      }
    },
    [readOnly, onRemoveColumn, onItemArrow],
  );

  const showCaption = !isEmpty && (!readOnly || entry.caption !== undefined);

  return (
    <figure
      className={dragOver ? "wte-image wte-image-group__item wte-image-group__item--drag-over" : "wte-image wte-image-group__item"}
      style={itemStyle}
      ref={setItemRef}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "group" : undefined}
      aria-label={
        isEmpty
          ? messages.imageGroupSlotLabel
          : entry.altText !== undefined && entry.altText.length > 0
            ? entry.altText
            : messages.imageCaptionAriaLabel
      }
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          onItemFocus?.();
        }
      }}
    >
      {!readOnly && onRemoveColumn !== undefined && (
        <button
          type="button"
          className="wte-image-group__remove"
          aria-label={messages.imageGroupRemoveColumnAriaLabel}
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveColumn();
          }}
        >
          ×
        </button>
      )}
      {isEmpty ? (
        <div className={dragOver ? "wte-image-slot wte-image-slot--drag-over" : "wte-image-slot"} contentEditable={false}>
          {messages.imageGroupSlotLabel}
        </div>
      ) : (
        <ImageContentView
          content={entry}
          src={src}
          readOnly={readOnly}
          showCaption={showCaption}
          honorPercentSize
          resizeContainerRef={itemRef}
          onContentChange={onEntryChange}
          registerCaptionEditor={registerCaptionEditor}
          onCaptionSelectionChange={onCaptionSelectionChange}
          onCaptionFocus={onCaptionFocus}
          onCaptionBlur={onCaptionBlur}
          onCaptionEnter={onCaptionEnter}
          onCaptionBackspaceAtStart={onCaptionBackspaceAtStart}
          onCaptionArrowUp={onCaptionArrowUp}
          onCaptionArrowDown={onCaptionArrowDown}
        />
      )}
      {feedback !== undefined && (
        <span className="wte-image__feedback" role="status" contentEditable={false}>
          {feedback}
        </span>
      )}
    </figure>
  );
}

function ImageContentView({
  content,
  src,
  readOnly,
  showCaption,
  honorPercentSize,
  resizeContainerRef,
  onContentChange,
  registerCaptionEditor,
  onCaptionSelectionChange,
  onCaptionFocus,
  onCaptionBlur,
  onCaptionEnter,
  onCaptionBackspaceAtStart,
  onCaptionArrowUp,
  onCaptionArrowDown,
}: ImageContentViewProps) {
  const messages = useMessages();
  const frameRef = useRef<HTMLSpanElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draftWidthPercent, setDraftWidthPercent] = useState<number | null>(null);

  const hasImage = src !== undefined && src.length > 0;
  const resizable = !readOnly && hasImage && resizeContainerRef !== undefined;
  const { frameStyle, mediaStyle } = sizingStyles(content, draftWidthPercent, honorPercentSize);

  const handleResizePointerDown = useCallback((event: ReactPointerEvent) => {
    const frame = frameRef.current;
    const container = resizeContainerRef?.current;
    if (frame === null || container === undefined || container === null) {
      return;
    }
    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startWidthPx = frame.getBoundingClientRect().width;
    dragRef.current = {
      startX: event.clientX,
      startWidthPx,
      containerWidth,
      percent: clampPercent((startWidthPx / containerWidth) * 100),
    };
    setDraftWidthPercent(dragRef.current.percent);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [resizeContainerRef]);

  const handleResizePointerMove = useCallback((event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    const nextPx = drag.startWidthPx + (event.clientX - drag.startX);
    drag.percent = clampPercent((nextPx / drag.containerWidth) * 100);
    setDraftWidthPercent(drag.percent);
  }, []);

  const endResize = useCallback(
    (event: ReactPointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (drag !== null) {
        onContentChange({ size: { width: Math.round(drag.percent), unit: "percent" } });
      }
      setDraftWidthPercent(null);
    },
    [onContentChange],
  );

  return (
    <>
      {hasImage ? (
        <span className="wte-image__frame" ref={frameRef} style={frameStyle}>
          <img className="wte-image__media" src={src} alt={content.altText ?? ""} style={mediaStyle} draggable={false} />
          {resizable && (
            <button
              type="button"
              className="wte-image__resize-handle"
              aria-label={messages.imageResizeAriaLabel}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          )}
        </span>
      ) : (
        <div className="wte-image__missing" contentEditable={false}>
          {messages.imageMissingSource}
        </div>
      )}
      {showCaption && (
        <InlineEditor
          as="figcaption"
          ref={registerCaptionEditor}
          content={content.caption ?? []}
          readOnly={readOnly}
          placeholder={messages.imageCaptionPlaceholder}
          ariaLabel={messages.imageCaptionAriaLabel}
          onContentChange={(caption) => onContentChange({ caption })}
          onSelectionChange={onCaptionSelectionChange}
          onFocus={onCaptionFocus}
          onBlur={onCaptionBlur}
          onEnter={onCaptionEnter !== undefined ? () => onCaptionEnter() : undefined}
          onBackspaceAtStart={onCaptionBackspaceAtStart}
          onArrowUp={onCaptionArrowUp}
          onArrowDown={onCaptionArrowDown}
        />
      )}
    </>
  );
}

function clampPercent(value: number): number {
  return Math.min(MAX_WIDTH_PERCENT, Math.max(MIN_WIDTH_PERCENT, value));
}

/**
 * Percent widths size the frame (relative to the figure/block) so the image
 * fills it; explicit px sizes (e.g. from paste) ride on the image itself and
 * the frame shrink-wraps. While dragging, the draft percent wins for live
 * feedback before it commits to the model on pointer-up.
 */
function sizingStyles(
  content: ImageContentBase,
  draftWidthPercent: number | null,
  honorPercentSize: boolean,
): { frameStyle: CSSProperties | undefined; mediaStyle: CSSProperties | undefined } {
  if (draftWidthPercent !== null) {
    return { frameStyle: { width: `${draftWidthPercent}%` }, mediaStyle: { width: "100%", height: "auto" } };
  }
  if (content.size === undefined) {
    return { frameStyle: undefined, mediaStyle: undefined };
  }
  if (content.size.unit === "percent") {
    if (!honorPercentSize) {
      return { frameStyle: undefined, mediaStyle: undefined };
    }
    return {
      frameStyle: content.size.width !== undefined ? { width: `${content.size.width}%` } : undefined,
      mediaStyle: { width: "100%", height: "auto" },
    };
  }
  const mediaStyle: CSSProperties = {
    ...(content.size.width !== undefined ? { width: `${content.size.width}px` } : {}),
    ...(content.size.height !== undefined ? { height: `${content.size.height}px` } : {}),
  };
  return { frameStyle: undefined, mediaStyle: Object.keys(mediaStyle).length > 0 ? mediaStyle : undefined };
}
