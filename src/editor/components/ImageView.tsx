import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { ImageBlock, ImageSize, InlineNode } from "../core/schema";
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

interface DragState {
  startX: number;
  startWidthPx: number;
  containerWidth: number;
  percent: number;
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
  const messages = useMessages();
  const figureRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLSpanElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draftWidthPercent, setDraftWidthPercent] = useState<number | null>(null);

  const src = block.source.type === "url" ? block.source.url : resolveImageSource?.(block);
  const hasImage = src !== undefined && src.length > 0;
  const figureStyle = block.align !== undefined ? { textAlign: block.align } : undefined;
  const showCaption = !readOnly || block.caption !== undefined;
  const resizable = !readOnly && hasImage;
  const { frameStyle, mediaStyle } = sizingStyles(block, draftWidthPercent);

  const handleResizePointerDown = useCallback((event: ReactPointerEvent) => {
    const frame = frameRef.current;
    const figure = figureRef.current;
    if (frame === null || figure === null) {
      return;
    }
    const containerWidth = figure.clientWidth;
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
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

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
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (drag !== null) {
        onImageChange({ size: { width: Math.round(drag.percent), unit: "percent" } });
      }
      setDraftWidthPercent(null);
    },
    [onImageChange],
  );

  return (
    <figure className="wte-image" style={figureStyle} ref={figureRef}>
      {hasImage ? (
        <span className="wte-image__frame" ref={frameRef} style={frameStyle}>
          <img className="wte-image__media" src={src} alt={block.altText ?? ""} style={mediaStyle} draggable={false} />
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
          content={block.caption ?? []}
          readOnly={readOnly}
          placeholder={messages.imageCaptionPlaceholder}
          ariaLabel={messages.imageCaptionAriaLabel}
          onContentChange={(caption) => onImageChange({ caption })}
          onSelectionChange={onCaptionSelectionChange}
          onFocus={onCaptionFocus}
          onBlur={onCaptionBlur}
          onEnter={onCaptionEnter !== undefined ? () => onCaptionEnter() : undefined}
          onBackspaceAtStart={onCaptionBackspaceAtStart}
          onArrowUp={onCaptionArrowUp}
          onArrowDown={onCaptionArrowDown}
        />
      )}
    </figure>
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
  block: ImageBlock,
  draftWidthPercent: number | null,
): { frameStyle: CSSProperties | undefined; mediaStyle: CSSProperties | undefined } {
  if (draftWidthPercent !== null) {
    return { frameStyle: { width: `${draftWidthPercent}%` }, mediaStyle: { width: "100%", height: "auto" } };
  }
  if (block.size === undefined) {
    return { frameStyle: undefined, mediaStyle: undefined };
  }
  if (block.size.unit === "percent") {
    return {
      frameStyle: block.size.width !== undefined ? { width: `${block.size.width}%` } : undefined,
      mediaStyle: { width: "100%", height: "auto" },
    };
  }
  const mediaStyle: CSSProperties = {
    ...(block.size.width !== undefined ? { width: `${block.size.width}px` } : {}),
    ...(block.size.height !== undefined ? { height: `${block.size.height}px` } : {}),
  };
  return { frameStyle: undefined, mediaStyle: Object.keys(mediaStyle).length > 0 ? mediaStyle : undefined };
}
