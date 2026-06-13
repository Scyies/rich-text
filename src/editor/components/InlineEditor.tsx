import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type KeyboardEvent,
} from "react";
import { getInlineLength } from "../core/inline";
import type { InlineNode } from "../core/schema";
import {
  domToInlineNodes,
  getCaretOffset,
  getSelectionOffsets,
  inlineNodesToHtml,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  setCaretOffset,
  setSelectionOffsets,
  type InlineRenderConfig,
} from "./dom";

/**
 * Per-block contenteditable (D7) following the native-first pipeline (D16):
 * the browser paints typing itself; `input` events read the DOM back into
 * InlineNode[] and emit upward. Model echoes are recognized by reference
 * and never rewrite the DOM, so the caret is untouched while typing.
 * External model changes (undo, patches) DO rewrite the DOM, preserving
 * the caret offset when focused. During IME composition the model sync is
 * deferred to compositionend.
 */

export interface InlineEditorHandle {
  focus(offset?: number): void;
  getElement(): HTMLElement | null;
}

export interface InlineEditorProps {
  content: InlineNode[];
  onContentChange(content: InlineNode[], caretOffset: number | null): void;
  /** Fires on caret/selection movement inside the block. */
  onSelectionChange?: ((start: number, end: number) => void) | undefined;
  /** Fires when the block gains focus. */
  onFocus?: (() => void) | undefined;
  /** Fires when the block loses focus. */
  onBlur?: (() => void) | undefined;
  /** Enter (without Shift). Offset = caret position at the keypress. */
  onEnter?: ((offset: number) => void) | undefined;
  /** Backspace with a collapsed caret at offset 0. */
  onBackspaceAtStart?: (() => void) | undefined;
  onTab?: ((shift: boolean) => void) | undefined;
  /** Arrow at the block boundary; return true when focus moved away. */
  onArrowUp?: (() => boolean) | undefined;
  onArrowDown?: (() => boolean) | undefined;
  /** Intercepts keys (slash menu navigation); return true to swallow. */
  onInterceptKeyDown?: ((event: KeyboardEvent) => boolean) | undefined;
  /** Per-kind chip rendering (from the plugin registry). */
  inlineRenderers?: ReadonlyMap<string, InlineRenderConfig> | undefined;
  as?: ElementType | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  placeholder?: string | undefined;
  readOnly?: boolean | undefined;
  ariaLabel?: string | undefined;
}

export const InlineEditor = forwardRef<InlineEditorHandle, InlineEditorProps>(function InlineEditor(
  {
    content,
    onContentChange,
    onSelectionChange,
    onFocus,
    onBlur,
    onEnter,
    onBackspaceAtStart,
    onTab,
    onArrowUp,
    onArrowDown,
    onInterceptKeyDown,
    inlineRenderers,
    as: Tag = "div",
    className,
    style,
    placeholder,
    readOnly = false,
    ariaLabel,
  },
  ref,
) {
  const elementRef = useRef<HTMLElement | null>(null);
  /** Last content emitted by this editor — its echo must not touch the DOM. */
  const lastEmittedRef = useRef<InlineNode[] | null>(null);
  const composingRef = useRef(false);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (element === null || content === lastEmittedRef.current) {
      return;
    }
    const html = inlineNodesToHtml(content, inlineRenderers);
    if (element.innerHTML === html) {
      return;
    }
    const isFocused = element.ownerDocument.activeElement === element;
    const offsets = isFocused ? getSelectionOffsets(element) : null;
    element.innerHTML = html;
    if (isFocused && offsets !== null) {
      const length = getInlineLength(content);
      setSelectionOffsets(element, Math.min(offsets.start, length), Math.min(offsets.end, length));
    }
  }, [content, inlineRenderers]);

  useImperativeHandle(
    ref,
    () => ({
      focus(offset) {
        const element = elementRef.current;
        if (element === null) {
          return;
        }
        element.focus();
        setCaretOffset(element, offset ?? getInlineLength(domToInlineNodes(element)));
      },
      getElement: () => elementRef.current,
    }),
    [],
  );

  function emitFromDom(): void {
    const element = elementRef.current;
    if (element === null) {
      return;
    }
    const nodes = domToInlineNodes(element);
    lastEmittedRef.current = nodes;
    onContentChange(nodes, getCaretOffset(element));
  }

  function reportSelection(): void {
    const element = elementRef.current;
    if (element === null || onSelectionChange === undefined) {
      return;
    }
    const offsets = getSelectionOffsets(element);
    if (offsets !== null) {
      onSelectionChange(offsets.start, offsets.end);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (readOnly) {
      return;
    }
    if (onInterceptKeyDown?.(event) === true) {
      event.preventDefault();
      return;
    }
    const element = elementRef.current;
    if (element === null) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!composingRef.current) {
        const offset = getCaretOffset(element);
        onEnter?.(offset ?? getInlineLength(domToInlineNodes(element)));
      }
      return;
    }

    if (event.key === "Backspace") {
      const offsets = getSelectionOffsets(element);
      if (offsets !== null && offsets.start === 0 && offsets.end === 0) {
        event.preventDefault();
        onBackspaceAtStart?.();
      }
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      onTab?.(event.shiftKey);
      return;
    }

    // Arrow at a block boundary jumps to the neighboring block in ONE
    // keypress: the trigger is being on the first/last VISUAL line (not at
    // offset 0/end), so wrapped paragraphs still navigate internally.
    if (event.key === "ArrowUp" && onArrowUp !== undefined) {
      if (isCaretOnFirstLine(element) && onArrowUp()) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowDown" && onArrowDown !== undefined) {
      if (isCaretOnLastLine(element) && onArrowDown()) {
        event.preventDefault();
      }
    }
  }

  const isEmpty = content.length === 0;

  return (
    <Tag
      ref={elementRef}
      className={["wte-inline-editor", className].filter(Boolean).join(" ")}
      style={style}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline={false}
      spellCheck
      data-empty={isEmpty ? "true" : undefined}
      data-placeholder={placeholder}
      onInput={() => {
        if (!composingRef.current) {
          emitFromDom();
        }
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        emitFromDom();
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={reportSelection}
      onMouseUp={reportSelection}
      onFocus={() => {
        onFocus?.();
        reportSelection();
      }}
      onBlur={() => onBlur?.()}
    />
  );
});
