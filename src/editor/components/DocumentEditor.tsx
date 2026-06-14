import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { ChangeInfo } from "../core/commands";
import { getInlineLength, getInlineText, splitInlineContent, concatInlineContent } from "../core/inline";
import { getActiveMarks, toggleMark } from "../core/marks";
import { getHeadingNumbers, getListItemNumbers, formatHeadingNumber } from "../core/numbering";
import { getSelectedBlockRange } from "../core/selection";
import { createTableBlock, createTextBlock } from "../core/factories";
import type {
  Block,
  BlockMeta,
  CustomBlock,
  InlineMark,
  InlineNode,
  TableBlock,
  WealthyDocument,
} from "../core/schema";
import { useDocumentEditor, type DocumentEditorApi } from "../hooks/useDocumentEditor";
import { getInlineNodeLength } from "../core/transforms";
import { buildPluginRegistry } from "../plugins/registry";
import type { CustomSlashItem, EditorPlugin, RenderBlockProps } from "../plugins/types";
import { getCaretViewportX, getOffsetNearViewportX, offsetOfInlineObject, type InlineRenderConfig } from "./dom";
import { matchInputRule } from "./inputRules";
import { parseClipboardToBlocks } from "./paste";
import { ChipPopover } from "./ChipPopover";
import { FloatingToolbar, type FloatingToolbarExtraItem } from "./FloatingToolbar";
import { InlineEditor, type InlineEditorHandle } from "./InlineEditor";
import { CORE_SLASH_ITEMS, filterSlashItems, SlashMenu, type SlashMenuItem } from "./SlashMenu";
import { TableView } from "./TableView";

// Plugin surface types are defined React-side (renderers are React); re-exported
// here for back-compat with existing imports from this module.
export type { CustomSlashItem, RenderBlockProps, SlashItemContext } from "../plugins/types";

/**
 * <DocumentEditor> — the primary multi-block editor (v0.4).
 *
 * Composition of the decided design: flat block list (D1), every line a
 * block (D2), per-block contenteditable with whole-block multi-select
 * (D7), native-first input (D16), markdown input rules + slash menu
 * (D11), drag-and-drop with section re-leveling (D4), and collapse as
 * view state (D3.4).
 */

/**
 * Default `{{label}}` handler: a placeholder chip whose key is the
 * slugified label — `{{Nome do Cliente}}` → key "nome_do_cliente".
 */
export function defaultInlineTagToNode(label: string): InlineNode {
  const key = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return { type: "object", kind: "placeholder", data: { key: key.length > 0 ? key : "campo", label } };
}

export interface DocumentEditorProps<TMeta extends BlockMeta = BlockMeta> {
  value: WealthyDocument<TMeta>;
  onChange?: ((document: WealthyDocument<TMeta>, info: ChangeInfo) => void) | undefined;
  onCommit?: ((document: WealthyDocument<TMeta>) => void) | undefined;
  commitIdleMs?: number | undefined;
  readOnly?: boolean | undefined;
  /** Show computed hierarchical numbers (1., 1.1…) before headings. */
  showHeadingNumbers?: boolean | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
  /** Plugins (D5/D6): custom block + inline-object renderers, slash/toolbar items. */
  plugins?: EditorPlugin<TMeta>[] | undefined;
  /**
   * Renderer for custom (plugin/host) blocks. A plugin `blockTypes`
   * registration for the same `kind` takes precedence over this prop.
   */
  renderBlock?: ((props: RenderBlockProps<TMeta>) => ReactNode) | undefined;
  /** Extra slash menu items (shown after the core block types and plugin items). */
  slashItems?: CustomSlashItem<TMeta>[] | undefined;
  /**
   * Typing `{{text}}` converts it to an inline node (D6 chip). Defaults to
   * a placeholder chip with the text as label; return null to leave the
   * text untouched; pass `false` to disable the rule.
   */
  inlineTagToNode?: ((text: string) => InlineNode | null) | false | undefined;
  ariaLabel?: string | undefined;
  /**
   * Escape hatch to the headless editor API (commands, selection,
   * sections) — e.g. to insert placeholder chips from host UI.
   */
  apiRef?: React.Ref<DocumentEditorApi<TMeta>> | undefined;
}

interface FocusRequest {
  blockId: string;
  offset: number;
  token: number;
}

interface SlashState {
  blockId: string;
  /** Inline offset of the "/" character. */
  slashOffset: number;
  query: string;
  /** Viewport anchor captured when the menu opened (caret position). */
  anchor: { x: number; y: number };
}

interface DropIndicator {
  blockId: string;
  position: "before" | "after";
}

function isTextLike(block: Block): block is Extract<Block, { type: "heading" | "text" }> {
  return block.type === "heading" || block.type === "text";
}

export function DocumentEditor<TMeta extends BlockMeta = BlockMeta>(props: DocumentEditorProps<TMeta>) {
  const {
    readOnly = false,
    showHeadingNumbers = false,
    placeholder = "Type / for commands…",
    renderBlock,
  } = props;

  const editor = useDocumentEditor<TMeta>({
    value: props.value,
    onChange: props.onChange,
    onCommit: props.onCommit,
    commitIdleMs: props.commitIdleMs,
  });
  const { commands, engine } = editor;
  const document = editor.document;

  // ---- plugin registry (D5/D6) ----
  const registry = useMemo(() => buildPluginRegistry<TMeta>(props.plugins ?? []), [props.plugins]);
  const inlineRenderers = useMemo<ReadonlyMap<string, InlineRenderConfig>>(() => {
    const map = new Map<string, InlineRenderConfig>();
    for (const [kind, registration] of registry.inlineObjects) {
      map.set(kind, {
        ...(registration.getLabel !== undefined ? { getLabel: registration.getLabel } : {}),
        ...(registration.getClassName !== undefined ? { getClassName: registration.getClassName } : {}),
        interactive: registration.renderEditor !== undefined,
      });
    }
    return map;
  }, [registry]);

  // Expose the headless API to the host (React 19 ref-as-prop).
  useEffect(() => {
    const ref = props.apiRef;
    if (ref === undefined || ref === null) {
      return;
    }
    if (typeof ref === "function") {
      ref(editor);
      return () => {
        ref(null);
      };
    }
    ref.current = editor;
    return () => {
      ref.current = null;
    };
  }, [props.apiRef, editor]);

  // ---- per-block InlineEditor handles + focus requests ----
  const editorsRef = useRef(new Map<string, InlineEditorHandle>());
  const focusTokenRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const appliedFocusTokenRef = useRef(0);

  const requestFocus = useCallback((blockId: string, offset: number) => {
    focusTokenRef.current += 1;
    setFocusRequest({ blockId, offset, token: focusTokenRef.current });
  }, []);

  useLayoutEffect(() => {
    if (focusRequest === null || focusRequest.token === appliedFocusTokenRef.current) {
      return;
    }
    appliedFocusTokenRef.current = focusRequest.token;
    editorsRef.current.get(focusRequest.blockId)?.focus(focusRequest.offset);
  }, [focusRequest]);

  const registerEditor = useCallback((blockId: string, handle: InlineEditorHandle | null) => {
    if (handle === null) {
      editorsRef.current.delete(blockId);
    } else {
      editorsRef.current.set(blockId, handle);
    }
  }, []);

  // ---- slash menu ----
  const getSlashAnchor = useCallback((blockId: string): { x: number; y: number } => {
    if (typeof window !== "undefined") {
      try {
        const selection = window.getSelection();
        if (selection !== null && selection.rangeCount > 0) {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          if (rect.left !== 0 || rect.bottom !== 0) {
            return { x: rect.left, y: rect.bottom };
          }
        }
      } catch {
        // fall through to the block element
      }
    }
    const rect = editorsRef.current.get(blockId)?.getElement()?.getBoundingClientRect();
    return rect !== undefined ? { x: rect.left, y: rect.bottom } : { x: 0, y: 0 };
  }, []);

  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const allSlashItems = useMemo(
    () => [...CORE_SLASH_ITEMS, ...(props.slashItems ?? []), ...registry.slashItems],
    [props.slashItems, registry],
  );
  const slashItems = useMemo(
    () => (slash === null ? [] : filterSlashItems(allSlashItems, slash.query)),
    [slash, allSlashItems],
  );

  const closeSlash = useCallback(() => {
    setSlash(null);
    setSlashIndex(0);
  }, []);

  const applySlashItem = useCallback(
    (item: SlashMenuItem) => {
      if (slash === null) {
        return;
      }
      const current = engine.getDocument().blocks.find((block) => block.id === slash.blockId);
      closeSlash();
      if (current === undefined || !isTextLike(current)) {
        return;
      }
      // Strip "/query" from the content.
      const [head, rest] = splitInlineContent(current.content, slash.slashOffset);
      const [, tail] = splitInlineContent(rest, 1 + slash.query.length);
      const stripped = concatInlineContent(head, tail);
      commands.updateBlock(current.id, { content: stripped });

      // Host- and plugin-provided items take precedence over core ids.
      const customItem =
        props.slashItems?.find((candidate) => candidate.id === item.id) ??
        registry.slashItems.find((candidate) => candidate.id === item.id);
      if (customItem !== undefined) {
        customItem.apply({
          blockId: current.id,
          query: slash.query,
          commands,
          insertInlineNode: (node) => {
            const caret = commands.insertInlineNode(current.id, slash.slashOffset, node);
            requestFocus(current.id, caret);
          },
        });
        return;
      }

      switch (item.id) {
        case "heading-1":
        case "heading-2":
        case "heading-3": {
          const level = Number(item.id.slice(-1)) as 1 | 2 | 3;
          commands.turnInto(current.id, { type: "heading", level });
          break;
        }
        case "paragraph":
          commands.turnInto(current.id, { type: "text", variant: "paragraph" });
          break;
        case "bullet":
          commands.turnInto(current.id, { type: "text", variant: "bullet" });
          break;
        case "numbered":
          commands.turnInto(current.id, { type: "text", variant: "numbered" });
          break;
        case "table":
          commands.insertBlockAfter(current.id, createTableBlock({ columnCount: 3, rowCount: 3 }) as Block<TMeta>);
          break;
        default:
          break;
      }
      requestFocus(current.id, slash.slashOffset);
    },
    [slash, engine, commands, closeSlash, requestFocus, props.slashItems, registry],
  );

  // ---- content change pipeline (input rules + slash detection) ----
  const handleContentChange = useCallback(
    (blockId: string, inline: InlineNode[], caret: number | null) => {
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      if (block === undefined || !isTextLike(block)) {
        return;
      }
      const plain = getInlineText(inline);

      // Markdown input rule (paragraphs only, caret right after the prefix).
      if (block.type === "text" && block.variant === "paragraph" && caret !== null) {
        const match = matchInputRule(plain.slice(0, caret));
        if (match !== null) {
          const [, remainder] = splitInlineContent(inline, match.prefixLength);
          commands.updateBlock(blockId, { content: remainder });
          commands.turnInto(blockId, match.target);
          requestFocus(blockId, 0);
          closeSlash();
          return;
        }
      }

      // Inline tag rule: a just-closed `{{label}}` becomes an inline chip.
      if (props.inlineTagToNode !== false && caret !== null) {
        const tagMatch = /\{\{([^{}]+)\}\}$/.exec(plain.slice(0, caret));
        if (tagMatch !== null) {
          const node = (props.inlineTagToNode ?? defaultInlineTagToNode)(tagMatch[1]!.trim());
          if (node !== null) {
            const start = caret - tagMatch[0].length;
            const [left, rest] = splitInlineContent(inline, start);
            const [, right] = splitInlineContent(rest, tagMatch[0].length);
            commands.updateBlock(blockId, {
              content: concatInlineContent(concatInlineContent(left, [node]), right),
            });
            requestFocus(blockId, start + getInlineNodeLength(node));
            closeSlash();
            return;
          }
        }
      }

      // Slash menu: open on a just-typed "/", track the query while open.
      if (slash !== null && slash.blockId === blockId) {
        if (plain[slash.slashOffset] !== "/" || caret === null || caret <= slash.slashOffset) {
          closeSlash();
        } else {
          setSlash({ ...slash, query: plain.slice(slash.slashOffset + 1, caret) });
          setSlashIndex(0);
        }
      } else if (!readOnly && caret !== null && caret > 0 && plain[caret - 1] === "/") {
        setSlash({ blockId, slashOffset: caret - 1, query: "", anchor: getSlashAnchor(blockId) });
        setSlashIndex(0);
      }

      commands.updateBlock(blockId, { content: inline });
    },
    [engine, commands, slash, closeSlash, requestFocus, readOnly, getSlashAnchor, props.inlineTagToNode],
  );

  // ---- focused-block tracking (placeholder display, slash lifetime) ----
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

  const handleEditorFocus = useCallback((blockId: string) => {
    setFocusedBlockId(blockId);
  }, []);

  /** Closes the slash menu when its block loses focus (outside click, tabbing away). */
  const handleEditorBlur = useCallback(
    (blockId: string) => {
      setFocusedBlockId((current) => (current === blockId ? null : current));
      if (slash !== null && slash.blockId === blockId) {
        closeSlash();
      }
    },
    [slash, closeSlash],
  );

  // Blur events are unreliable in some environments (and don't cover every
  // outside-click path) — while the menu is open, any mousedown outside the
  // menu and its block closes it.
  useEffect(() => {
    if (slash === null || typeof window === "undefined") {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".wte-slash-menu") != null) {
        return;
      }
      const blockElement = target?.closest("[data-block-id]");
      if (!(blockElement instanceof HTMLElement) || blockElement.dataset["blockId"] !== slash.blockId) {
        closeSlash();
      }
    };
    window.document.addEventListener("mousedown", handleMouseDown, true);
    return () => window.document.removeEventListener("mousedown", handleMouseDown, true);
  }, [slash, closeSlash]);

  // ---- inline-object chip editing (D6, popover-on-click) ----
  const [chipEdit, setChipEdit] = useState<{ blockId: string; offset: number; anchor: { x: number; y: number } } | null>(
    null,
  );
  const closeChipEdit = useCallback(() => setChipEdit(null), []);

  // A click on an interactive chip (a kind with renderEditor) opens its
  // popover. preventDefault stops a caret from landing on the atomic chip.
  const handleEditorMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const chip = target?.closest("[data-wte-object]");
      if (!(chip instanceof HTMLElement)) {
        return;
      }
      const kind = chip.dataset["wteObject"];
      const registration = kind !== undefined ? registry.inlineObjects.get(kind) : undefined;
      if (registration?.renderEditor === undefined || readOnly) {
        return; // non-interactive chip — leave the click to the browser
      }
      const blockElement = chip.closest("[data-block-id]");
      const blockId = blockElement instanceof HTMLElement ? blockElement.dataset["blockId"] : undefined;
      const rootElement = blockId !== undefined ? editorsRef.current.get(blockId)?.getElement() : undefined;
      if (blockId === undefined || rootElement == null) {
        return;
      }
      const offset = offsetOfInlineObject(rootElement, chip);
      if (offset === null) {
        return;
      }
      event.preventDefault();
      const rect = chip.getBoundingClientRect();
      setChipEdit({ blockId, offset, anchor: { x: rect.left, y: rect.bottom } });
    },
    [registry, readOnly],
  );

  // Outside-click / Escape close the popover — block blur does NOT, since the
  // user is interacting with the popover (which lives outside the block).
  useEffect(() => {
    if (chipEdit === null || typeof window === "undefined") {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".wte-chip-popover") == null) {
        setChipEdit(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChipEdit(null);
      }
    };
    window.document.addEventListener("mousedown", handleMouseDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("mousedown", handleMouseDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [chipEdit]);

  // ---- rich paste (D11) ----
  const handlePaste = useCallback(
    (event: ReactClipboardEvent) => {
      if (readOnly) {
        return;
      }
      const selection = engine.getSelection();
      if (selection?.type !== "text") {
        return;
      }
      const currentDocument = engine.getDocument();
      const block = currentDocument.blocks.find((candidate) => candidate.id === selection.blockId);
      if (block === undefined || !isTextLike(block)) {
        return;
      }
      // Only intercept when a top-level block editor is focused — paste inside
      // a table cell falls through to the browser's default for now.
      const targetElement = editorsRef.current.get(block.id)?.getElement();
      if (targetElement == null || targetElement.ownerDocument.activeElement !== targetElement) {
        return;
      }

      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      if (html.trim().length === 0 && text.length === 0) {
        return;
      }
      const pasted = parseClipboardToBlocks({ html, text });
      if (pasted.length === 0) {
        return;
      }
      event.preventDefault();
      closeSlash();

      const start = Math.min(selection.anchor, selection.focus);
      const end = Math.max(selection.anchor, selection.focus);
      const [left] = splitInlineContent(block.content, start);
      const [, right] = splitInlineContent(block.content, end);

      // Inline paste: a single paragraph splices into the current block (keeps its type).
      const only = pasted.length === 1 ? pasted[0] : undefined;
      if (only !== undefined && only.type === "text" && only.variant === "paragraph") {
        const merged = concatInlineContent(concatInlineContent(left, only.content), right);
        commands.updateBlock(block.id, { content: merged });
        requestFocus(block.id, getInlineLength(left) + getInlineLength(only.content));
        return;
      }

      // Block paste: split the current line, splice the blocks between, as one
      // atomic (single-undo) transaction through the patch pipeline.
      const index = currentDocument.blocks.findIndex((candidate) => candidate.id === block.id);
      const previousId = index > 0 ? currentDocument.blocks[index - 1]!.id : null;
      const rightBlock = getInlineLength(right) > 0 ? createTextBlock({ content: right }) : null;
      const patches: unknown[] = [];

      if (getInlineLength(left) === 0 && rightBlock === null) {
        // Pasting into an empty line replaces it.
        pasted.forEach((pastedBlock, position) =>
          patches.push({
            op: "insert_block_after",
            afterBlockId: position === 0 ? previousId : pasted[position - 1]!.id,
            block: pastedBlock,
          }),
        );
        patches.push({ op: "delete_block", blockId: block.id });
      } else {
        patches.push({ op: "update_block", blockId: block.id, changes: { content: left } });
        pasted.forEach((pastedBlock, position) =>
          patches.push({
            op: "insert_block_after",
            afterBlockId: position === 0 ? block.id : pasted[position - 1]!.id,
            block: pastedBlock,
          }),
        );
        if (rightBlock !== null) {
          patches.push({ op: "insert_block_after", afterBlockId: pasted[pasted.length - 1]!.id, block: rightBlock });
        }
      }
      commands.applyPatches(patches);

      // Caret goes to the remainder, else the end of the last text-like pasted block.
      if (rightBlock !== null) {
        requestFocus(rightBlock.id, 0);
      } else {
        const lastTextLike = [...pasted].reverse().find((candidate) => isTextLike(candidate));
        if (lastTextLike !== undefined && isTextLike(lastTextLike)) {
          requestFocus(lastTextLike.id, getInlineLength(lastTextLike.content));
        }
      }
    },
    [readOnly, engine, commands, requestFocus, closeSlash],
  );

  // ---- keyboard structure ----
  const handleEnter = useCallback(
    (blockId: string, offset: number) => {
      const newBlockId = commands.splitBlock(blockId, offset);
      requestFocus(newBlockId, 0);
    },
    [commands, requestFocus],
  );

  const handleBackspaceAtStart = useCallback(
    (blockId: string) => {
      const blocks = engine.getDocument().blocks;
      const index = blocks.findIndex((candidate) => candidate.id === blockId);
      const block = index === -1 ? undefined : blocks[index];
      if (block === undefined || !isTextLike(block)) {
        return;
      }
      if (block.type === "text" && (block.indent ?? 0) > 0) {
        commands.outdent(blockId);
        return;
      }
      if (block.type === "text" && block.variant !== "paragraph") {
        commands.turnInto(blockId, { type: "text", variant: "paragraph" });
        return;
      }
      if (block.type === "heading") {
        commands.turnInto(blockId, { type: "text", variant: "paragraph" });
        return;
      }
      if (index === 0) {
        return;
      }
      const previous = blocks[index - 1]!;
      if (!isTextLike(previous)) {
        return;
      }
      const offset = commands.mergeWithPrevious(blockId);
      requestFocus(previous.id, offset);
    },
    [engine, commands, requestFocus],
  );

  const handleTab = useCallback(
    (blockId: string, shift: boolean) => {
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      if (block?.type !== "text") {
        return;
      }
      if (shift) {
        commands.outdent(blockId);
      } else {
        commands.indent(blockId);
      }
    },
    [engine, commands],
  );

  // Adds an empty paragraph at the very end of the document and focuses it —
  // the on-demand way out of a trailing non-editable block (separator, table,
  // custom), which has no caret position after it.
  const addTrailingParagraph = useCallback(() => {
    const blocks = engine.getDocument().blocks;
    const last = blocks[blocks.length - 1];
    const newId = commands.insertBlockAfter(last?.id ?? null, createTextBlock({ content: [] }) as Block<TMeta>);
    requestFocus(newId, 0);
  }, [engine, commands, requestFocus]);

  const moveFocus = useCallback(
    (blockId: string, direction: -1 | 1): boolean => {
      const blocks = engine.getDocument().blocks;
      const index = blocks.findIndex((candidate) => candidate.id === blockId);
      if (index === -1) {
        return false;
      }
      // Preserve the caret's column across the jump (like native editors).
      const sourceElement = editorsRef.current.get(blockId)?.getElement();
      const caretX = sourceElement != null ? getCaretViewportX(sourceElement) : null;

      for (let cursor = index + direction; cursor >= 0 && cursor < blocks.length; cursor += direction) {
        const candidate = blocks[cursor]!;
        const handle = editorsRef.current.get(candidate.id);
        if (isTextLike(candidate) && handle !== undefined) {
          let offset: number | null = null;
          const targetElement = handle.getElement();
          if (caretX !== null && targetElement !== null) {
            offset = getOffsetNearViewportX(targetElement, caretX, direction === -1 ? "last" : "first");
          }
          requestFocus(candidate.id, offset ?? (direction === -1 ? Number.MAX_SAFE_INTEGER : 0));
          return true;
        }
      }
      // Going down with no editable block below: if a non-editable block sits at
      // the end of the document, add a fresh trailing line and land in it.
      if (direction === 1) {
        const last = blocks[blocks.length - 1];
        if (last !== undefined && !editor.hiddenBlockIds.has(last.id) && !isTextLike(last)) {
          addTrailingParagraph();
          return true;
        }
      }
      return false;
    },
    [engine, editor.hiddenBlockIds, requestFocus, addTrailingParagraph],
  );

  // ---- selection: inline tracking + block multi-select ----
  const handleSelectionChange = useCallback(
    (blockId: string, start: number, end: number) => {
      editor.setSelection({ type: "text", blockId, anchor: start, focus: end });
    },
    [editor],
  );

  const selectedBlockIds = useMemo<ReadonlySet<string>>(() => {
    if (editor.selection?.type !== "blocks") {
      return new Set();
    }
    const range = getSelectedBlockRange(document, editor.selection);
    if (range === null) {
      return new Set();
    }
    return new Set(document.blocks.slice(range.start, range.end + 1).map((block) => block.id));
  }, [editor.selection, document]);

  const handleHandleClick = useCallback(
    (blockId: string, shiftKey: boolean) => {
      const current = engine.getSelection();
      if (shiftKey && current?.type === "blocks") {
        editor.setSelection({ ...current, focusBlockId: blockId });
      } else {
        editor.setSelection({ type: "blocks", anchorBlockId: blockId, focusBlockId: blockId });
      }
    },
    [engine, editor],
  );

  const handleContainerKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      // Engine-owned history (D8): browser-native undo must never run
      // inside the contenteditables.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          commands.redo();
        } else {
          commands.undo();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        commands.redo();
        return;
      }
      const selection = engine.getSelection();
      if (selection?.type !== "blocks") {
        return;
      }
      if (event.key === "Escape") {
        editor.setSelection(null);
        event.preventDefault();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const range = getSelectedBlockRange(engine.getDocument(), selection);
        if (range !== null) {
          const ids = engine
            .getDocument()
            .blocks.slice(range.start, range.end + 1)
            .map((block) => block.id);
          // One atomic, single-undo deletion through the patch pipeline.
          commands.applyPatches(ids.map((blockId) => ({ op: "delete_block", blockId })));
          editor.setSelection(null);
        }
        event.preventDefault();
      }
    },
    [engine, editor, commands],
  );

  // ---- drag and drop (blocks and sections, D4) ----
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const handleDrop = useCallback(
    (targetBlockId: string, position: "before" | "after", draggedBlockId: string) => {
      setDropIndicator(null);
      if (draggedBlockId === targetBlockId) {
        return;
      }
      const blocks = engine.getDocument().blocks;
      const dragged = blocks.find((candidate) => candidate.id === draggedBlockId);
      const targetIndex = blocks.findIndex((candidate) => candidate.id === targetBlockId);
      if (dragged === undefined || targetIndex === -1) {
        return;
      }
      const afterBlockId =
        position === "after" ? targetBlockId : targetIndex === 0 ? null : blocks[targetIndex - 1]!.id;
      if (afterBlockId === draggedBlockId) {
        return;
      }
      try {
        if (dragged.type === "heading") {
          commands.moveSection(draggedBlockId, afterBlockId);
        } else {
          commands.moveBlock(draggedBlockId, afterBlockId);
        }
      } catch {
        // Invalid drop (e.g. a section into itself) — ignore.
      }
    },
    [engine, commands],
  );

  // ---- floating toolbar ----
  const textSelection = editor.selection?.type === "text" ? editor.selection : null;
  const toolbarTarget =
    textSelection !== null && textSelection.anchor !== textSelection.focus
      ? document.blocks.find((candidate) => candidate.id === textSelection.blockId)
      : undefined;

  const activeMarkTypes = useMemo<ReadonlySet<InlineMark["type"]>>(() => {
    if (toolbarTarget === undefined || !isTextLike(toolbarTarget) || textSelection === null) {
      return new Set();
    }
    const start = Math.min(textSelection.anchor, textSelection.focus);
    const end = Math.max(textSelection.anchor, textSelection.focus);
    return new Set(getActiveMarks(toolbarTarget.content, start, end).map((mark) => mark.type));
  }, [toolbarTarget, textSelection]);

  const handleToggleMark = useCallback(
    (mark: InlineMark) => {
      const selection = engine.getSelection();
      if (selection?.type !== "text" || selection.anchor === selection.focus) {
        return;
      }
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === selection.blockId);
      if (block === undefined || !isTextLike(block)) {
        return;
      }
      const start = Math.min(selection.anchor, selection.focus);
      const end = Math.max(selection.anchor, selection.focus);
      commands.updateBlock(block.id, { content: toggleMark(block.content, start, end, mark) });
    },
    [engine, commands],
  );

  const toolbarStyle = useMemo<CSSProperties | undefined>(() => {
    if (toolbarTarget === undefined || typeof window === "undefined") {
      return undefined;
    }
    try {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return undefined;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return undefined;
      }
      return { position: "fixed", top: rect.top - 40, left: rect.left };
    } catch {
      return undefined;
    }
  }, [toolbarTarget, textSelection]);

  // ---- numbering + visibility ----
  const headingNumbers = useMemo(
    () => (showHeadingNumbers ? getHeadingNumbers(document) : null),
    [showHeadingNumbers, document],
  );
  const listNumbers = useMemo(() => getListItemNumbers(document), [document]);
  const visibleBlocks = useMemo(
    () => document.blocks.filter((block) => !editor.hiddenBlockIds.has(block.id)),
    [document, editor.hiddenBlockIds],
  );

  // Resolve the chip under edit from (blockId, offset) every render so the
  // popover tracks the live model (and closes if the object went away).
  const chipEditState = useMemo(() => {
    if (chipEdit === null) {
      return null;
    }
    const block = document.blocks.find((candidate) => candidate.id === chipEdit.blockId);
    if (block === undefined || !isTextLike(block) || chipEdit.offset > getInlineLength(block.content)) {
      return null;
    }
    const [, rest] = splitInlineContent(block.content, chipEdit.offset);
    const node = rest[0];
    if (node === undefined || node.type !== "object") {
      return null;
    }
    const renderEditor = registry.inlineObjects.get(node.kind)?.renderEditor;
    if (renderEditor === undefined) {
      return null;
    }
    return { node, renderEditor, blockId: chipEdit.blockId, offset: chipEdit.offset, anchor: chipEdit.anchor };
  }, [chipEdit, document, registry]);

  const toolbarExtraItems = useMemo<FloatingToolbarExtraItem[]>(
    () =>
      registry.toolbarItems.map((item) => ({
        id: item.id,
        label: item.label,
        ...(item.title !== undefined ? { title: item.title } : {}),
        active: item.isActive?.(activeMarkTypes) ?? false,
        onClick: () => item.apply({ commands, selection: engine.getSelection() }),
      })),
    [registry, activeMarkTypes, commands, engine],
  );

  // ---- slash menu keyboard interception ----
  const interceptKeyDown = useCallback(
    (blockId: string, event: ReactKeyboardEvent): boolean => {
      if (slash === null || slash.blockId !== blockId) {
        return false;
      }
      if (event.key === "ArrowDown") {
        setSlashIndex((index) => (slashItems.length === 0 ? 0 : (index + 1) % slashItems.length));
        return true;
      }
      if (event.key === "ArrowUp") {
        setSlashIndex((index) => (slashItems.length === 0 ? 0 : (index - 1 + slashItems.length) % slashItems.length));
        return true;
      }
      if (event.key === "Enter") {
        const item = slashItems[slashIndex];
        if (item !== undefined) {
          applySlashItem(item);
        } else {
          closeSlash();
        }
        return true;
      }
      if (event.key === "Escape") {
        closeSlash();
        return true;
      }
      return false;
    },
    [slash, slashItems, slashIndex, applySlashItem, closeSlash],
  );

  // A non-editable block at the end of the document has no caret position after
  // it — offer a click target to add (and focus) a trailing line.
  const lastBlock = document.blocks[document.blocks.length - 1];
  const showTrailingAdd =
    !readOnly && lastBlock !== undefined && !editor.hiddenBlockIds.has(lastBlock.id) && !isTextLike(lastBlock);

  // ---- render ----
  return (
    <div
      className={["wte-editor", props.className].filter(Boolean).join(" ")}
      role="textbox"
      aria-multiline
      aria-label={props.ariaLabel ?? "Document editor"}
      onKeyDown={handleContainerKeyDown}
      onMouseDown={handleEditorMouseDown}
      onPaste={handlePaste}
    >
      {visibleBlocks.map((block) => (
        <BlockRow
          key={block.id}
          block={block as Block}
          editor={editor as unknown as DocumentEditorApi}
          readOnly={readOnly}
          placeholder={focusedBlockId === block.id ? placeholder : undefined}
          selected={selectedBlockIds.has(block.id)}
          collapsed={block.type === "heading" && editor.isSectionCollapsed(block.id)}
          dropIndicator={dropIndicator?.blockId === block.id ? dropIndicator.position : null}
          headingNumber={
            block.type === "heading" && headingNumbers !== null
              ? (headingNumbers.get(block.id) ?? null)
              : null
          }
          listNumber={listNumbers.get(block.id) ?? null}
          registerEditor={registerEditor}
          onContentChange={handleContentChange}
          onSelectionChange={handleSelectionChange}
          onEnter={handleEnter}
          onBackspaceAtStart={handleBackspaceAtStart}
          onTab={handleTab}
          onEditorFocus={handleEditorFocus}
          onEditorBlur={handleEditorBlur}
          onMoveFocus={moveFocus}
          onHandleClick={handleHandleClick}
          onToggleCollapsed={editor.toggleSectionCollapsed}
          onDropIndicatorChange={setDropIndicator}
          onDropBlock={handleDrop}
          onInterceptKeyDown={interceptKeyDown}
          inlineRenderers={inlineRenderers}
          blockRenderers={
            registry.blockRenderers as unknown as ReadonlyMap<string, (props: RenderBlockProps) => ReactNode>
          }
          renderBlock={renderBlock as DocumentEditorProps["renderBlock"]}
          commandsUpdateBlock={commands.updateBlock}
        />
      ))}

      {showTrailingAdd && (
        <div
          className="wte-trailing-line"
          role="button"
          tabIndex={-1}
          aria-label="Add a line below"
          onMouseDown={(event) => {
            event.preventDefault();
            addTrailingParagraph();
          }}
        />
      )}

      {slash !== null && (
        <SlashMenu
          items={slashItems}
          highlightedIndex={slashIndex}
          onSelect={applySlashItem}
          onHighlight={setSlashIndex}
          style={{
            top: slash.anchor.y + 6,
            left: Math.max(
              8,
              Math.min(slash.anchor.x, (typeof window !== "undefined" ? window.innerWidth : 1280) - 248),
            ),
          }}
        />
      )}

      {toolbarTarget !== undefined && !readOnly && (
        <FloatingToolbar
          activeMarkTypes={activeMarkTypes}
          onToggleMark={handleToggleMark}
          extraItems={toolbarExtraItems}
          style={toolbarStyle}
        />
      )}

      {chipEditState !== null && (
        <ChipPopover
          style={{
            top: chipEditState.anchor.y + 6,
            left: Math.max(
              8,
              Math.min(chipEditState.anchor.x, (typeof window !== "undefined" ? window.innerWidth : 1280) - 248),
            ),
          }}
        >
          {chipEditState.renderEditor(chipEditState.node, {
            update: (patch) => commands.updateInlineObject(chipEditState.blockId, chipEditState.offset, patch),
            remove: () => {
              commands.removeInlineNode(chipEditState.blockId, chipEditState.offset);
              closeChipEdit();
            },
            close: closeChipEdit,
          })}
        </ChipPopover>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BlockRow
// ---------------------------------------------------------------------------

interface BlockRowProps {
  block: Block;
  editor: DocumentEditorApi;
  readOnly: boolean;
  placeholder: string | undefined;
  selected: boolean;
  collapsed: boolean;
  dropIndicator: "before" | "after" | null;
  headingNumber: number[] | null;
  listNumber: number | null;
  registerEditor(blockId: string, handle: InlineEditorHandle | null): void;
  onContentChange(blockId: string, content: InlineNode[], caret: number | null): void;
  onSelectionChange(blockId: string, start: number, end: number): void;
  onEnter(blockId: string, offset: number): void;
  onBackspaceAtStart(blockId: string): void;
  onTab(blockId: string, shift: boolean): void;
  onEditorFocus(blockId: string): void;
  onEditorBlur(blockId: string): void;
  onMoveFocus(blockId: string, direction: -1 | 1): boolean;
  onHandleClick(blockId: string, shiftKey: boolean): void;
  onToggleCollapsed(headingId: string): void;
  onDropIndicatorChange(indicator: DropIndicator | null): void;
  onDropBlock(targetBlockId: string, position: "before" | "after", draggedBlockId: string): void;
  onInterceptKeyDown(blockId: string, event: ReactKeyboardEvent): boolean;
  inlineRenderers: ReadonlyMap<string, InlineRenderConfig>;
  blockRenderers: ReadonlyMap<string, (props: RenderBlockProps) => ReactNode>;
  renderBlock: DocumentEditorProps["renderBlock"];
  commandsUpdateBlock(blockId: string, patch: Record<string, unknown>): void;
}

function BlockRow({
  block,
  readOnly,
  placeholder,
  selected,
  collapsed,
  dropIndicator,
  headingNumber,
  listNumber,
  registerEditor,
  onContentChange,
  onSelectionChange,
  onEnter,
  onBackspaceAtStart,
  onTab,
  onEditorFocus,
  onEditorBlur,
  onMoveFocus,
  onHandleClick,
  onToggleCollapsed,
  onDropIndicatorChange,
  onDropBlock,
  onInterceptKeyDown,
  inlineRenderers,
  blockRenderers,
  renderBlock,
  commandsUpdateBlock,
}: BlockRowProps) {
  const customRenderer =
    block.type === "custom" ? (blockRenderers.get(block.kind) ?? renderBlock) : undefined;

  const classes = [
    "wte-block",
    `wte-block--${block.type}`,
    block.type === "text" ? `wte-block--${block.variant}` : null,
    selected ? "wte-block--selected" : null,
    dropIndicator === "before" ? "wte-block--drop-before" : null,
    dropIndicator === "after" ? "wte-block--drop-after" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const indent = block.type === "text" ? (block.indent ?? 0) : 0;

  return (
    <div
      className={classes}
      data-block-id={block.id}
      style={indent > 0 ? { marginLeft: `${indent * 24}px` } : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        onDropIndicatorChange({ blockId: block.id, position });
      }}
      onDragLeave={() => onDropIndicatorChange(null)}
      onDrop={(event) => {
        event.preventDefault();
        const draggedId = event.dataTransfer.getData("text/wte-block");
        if (draggedId.length > 0) {
          const rect = event.currentTarget.getBoundingClientRect();
          const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
          onDropBlock(block.id, position, draggedId);
        }
      }}
    >
      <div className="wte-block__gutter" contentEditable={false}>
        {!readOnly && (
          <span
            className="wte-block__handle"
            draggable
            title="Drag to move; click to select"
            onClick={(event) => onHandleClick(block.id, event.shiftKey)}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/wte-block", block.id);
              event.dataTransfer.effectAllowed = "move";
            }}
          >
            ⠿
          </span>
        )}
        {block.type === "heading" && (
          <button
            type="button"
            className="wte-block__chevron"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand section" : "Collapse section"}
            onClick={() => onToggleCollapsed(block.id)}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        )}
      </div>

      <div className="wte-block__body">
        {block.type === "heading" && (
          <div className="wte-block__line">
            {headingNumber !== null && (
              <span className="wte-block__number">{formatHeadingNumber(headingNumber)}.</span>
            )}
            <InlineEditor
              ref={(handle) => registerEditor(block.id, handle)}
              as={`h${block.level}` as "h1"}
              content={block.content}
              readOnly={readOnly}
              ariaLabel={`Heading ${block.level}`}
              style={block.align !== undefined ? { textAlign: block.align } : undefined}
              onContentChange={(nodes, caret) => onContentChange(block.id, nodes, caret)}
              onSelectionChange={(start, end) => onSelectionChange(block.id, start, end)}
              onFocus={() => onEditorFocus(block.id)}
              onBlur={() => onEditorBlur(block.id)}
              onEnter={(offset) => onEnter(block.id, offset)}
              onBackspaceAtStart={() => onBackspaceAtStart(block.id)}
              onTab={(shift) => onTab(block.id, shift)}
              onArrowUp={() => onMoveFocus(block.id, -1)}
              onArrowDown={() => onMoveFocus(block.id, 1)}
              onInterceptKeyDown={(event) => onInterceptKeyDown(block.id, event)}
              inlineRenderers={inlineRenderers}
            />
          </div>
        )}

        {block.type === "text" && (
          <div className="wte-block__line">
            {block.variant === "bullet" && <span className="wte-block__marker">•</span>}
            {block.variant === "numbered" && (
              <span className="wte-block__marker">{listNumber ?? "•"}.</span>
            )}
            <InlineEditor
              ref={(handle) => registerEditor(block.id, handle)}
              as="p"
              content={block.content}
              readOnly={readOnly}
              ariaLabel="Text block"
              placeholder={block.variant === "paragraph" ? placeholder : undefined}
              style={block.align !== undefined ? { textAlign: block.align } : undefined}
              onContentChange={(nodes, caret) => onContentChange(block.id, nodes, caret)}
              onSelectionChange={(start, end) => onSelectionChange(block.id, start, end)}
              onFocus={() => onEditorFocus(block.id)}
              onBlur={() => onEditorBlur(block.id)}
              onEnter={(offset) => onEnter(block.id, offset)}
              onBackspaceAtStart={() => onBackspaceAtStart(block.id)}
              onTab={(shift) => onTab(block.id, shift)}
              onArrowUp={() => onMoveFocus(block.id, -1)}
              onArrowDown={() => onMoveFocus(block.id, 1)}
              onInterceptKeyDown={(event) => onInterceptKeyDown(block.id, event)}
              inlineRenderers={inlineRenderers}
            />
          </div>
        )}

        {block.type === "table" && (
          <TableView
            block={block as TableBlock}
            readOnly={readOnly}
            onTableChange={(patch) => commandsUpdateBlock(block.id, patch)}
          />
        )}

        {block.type === "custom" &&
          (customRenderer !== undefined ? (
            customRenderer({
              block: block as CustomBlock,
              readOnly,
              update: (patch) => commandsUpdateBlock(block.id, patch),
            })
          ) : (
            <div className="wte-block__custom-fallback">
              <span className="wte-block__custom-kind">{block.kind}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
