import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type ReactNode,
} from "react";
import type { ChangeInfo } from "../core/commands";
import { getInlineLength, getInlineText, splitInlineContent, concatInlineContent } from "../core/inline";
import { getActiveMarks, toggleMark } from "../core/marks";
import { getHeadingNumbers, getListItemNumbers, formatHeadingNumber } from "../core/numbering";
import { getSelectedBlockRange } from "../core/selection";
import {
  createEmptyImageGroupBlock,
  createImageBlock,
  createImageGroupBlock,
  createTableBlock,
  createTextBlock,
  generateBlockId,
  type CreateImageBlockInput,
  type CreateImageGroupEntryInput,
} from "../core/factories";
import { isDurableImageUrl } from "../core/schema";
import type {
  Block,
  BlockMeta,
  CustomBlock,
  ImageBlock,
  ImageGroupBlock,
  ImageGroupEntry,
  InlineMark,
  InlineNode,
  TableBlock,
  WealthyDocument,
} from "../core/schema";
import { useDocumentEditor, type DocumentEditorApi } from "../hooks/useDocumentEditor";
import { getInlineNodeLength } from "../core/transforms";
import { buildPluginRegistry } from "../plugins/registry";
import type { CustomSlashItem, EditorPlugin, RenderBlockProps } from "../plugins/types";
import {
  getCaretLineRect,
  getCaretViewportX,
  getOffsetNearViewportX,
  offsetOfInlineObject,
  type InlineRenderConfig,
} from "./dom";
import { matchInputRule } from "./inputRules";
import { parseClipboardToBlocks, parseHtmlToBlocks } from "./paste";
import { resolveMessages, MessagesProvider, useMessages, type EditorMessages, type Locale } from "../i18n";
import { ChipPopover } from "./ChipPopover";
import { FloatingToolbar, type FloatingToolbarExtraItem } from "./FloatingToolbar";
import { ImageGroupView, ImageView, type ImageItemArrow } from "./ImageView";
import { InlineEditor, type InlineEditorHandle } from "./InlineEditor";
import { buildCoreSlashItems, filterSlashItems, SlashMenu, type SlashMenuItem } from "./SlashMenu";
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

export type ImageInsertionInput<TMeta extends BlockMeta = BlockMeta> = CreateImageBlockInput<TMeta>;

export type ImageInsertionResult<TMeta extends BlockMeta = BlockMeta> =
  | ImageInsertionInput<TMeta>
  | null
  | undefined;

export interface DocumentEditorProps<TMeta extends BlockMeta = BlockMeta> {
  value: WealthyDocument<TMeta>;
  onChange?: ((document: WealthyDocument<TMeta>, info: ChangeInfo) => void) | undefined;
  onCommit?: ((document: WealthyDocument<TMeta>) => void) | undefined;
  commitIdleMs?: number | undefined;
  readOnly?: boolean | undefined;
  /** Show computed hierarchical numbers (1., 1.1…) before headings. */
  showHeadingNumbers?: boolean | undefined;
  placeholder?: string | undefined;
  /** UI locale for built-in chrome (default `en`). */
  locale?: Locale | undefined;
  /** Per-string overrides on top of the resolved `locale`. */
  messages?: Partial<EditorMessages> | undefined;
  className?: string | undefined;
  /** Plugins (D5/D6): custom block + inline-object renderers, slash/toolbar items. */
  plugins?: EditorPlugin<TMeta>[] | undefined;
  /**
   * Renderer for custom (plugin/host) blocks. A plugin `blockTypes`
   * registration for the same `kind` takes precedence over this prop.
   */
  renderBlock?: ((props: RenderBlockProps<TMeta>) => ReactNode) | undefined;
  /** Resolve host-owned image assets to renderable URLs. URL images do not call this. */
  resolveImageSource?: ((block: ImageBlock<TMeta>) => string | undefined) | undefined;
  /** Resolve host-owned image group entries to renderable URLs. URL entries do not call this. */
  resolveImageContentSource?: ((entry: ImageGroupEntry<TMeta>) => string | undefined) | undefined;
  /**
   * Called for pasted/dropped image files (including into an image-row slot).
   * Upload/storage stays host-owned; the returned payload becomes the image.
   */
  onUploadImage?:
    | ((file: File) => ImageInsertionResult<TMeta> | Promise<ImageInsertionResult<TMeta>>)
    | undefined;
  /**
   * Allow dropped/pasted image *URLs* (http(s) links and dragged web images) to
   * become images, both at block level and into image-row slots. File uploads
   * via `onUploadImage` are independent of this. Defaults to false.
   */
  allowDroppedImageUrls?: boolean | undefined;
  /**
   * When true, pasting/dropping two or more image files at once inserts a
   * single side-by-side `imageGroup` instead of separate image blocks. A single
   * file is always inserted as a plain image. Defaults to false (back-compat).
   */
  groupUploadedImages?: boolean | undefined;
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
  ref?: Ref<DocumentEditorApi<TMeta>> | undefined;
}

/**
 * Addresses one editable InlineEditor in the document. `block` covers a
 * heading/text primary editor; `imageCaption` a single image's caption;
 * `imageGroupCaption` one caption inside an image group. The first two share a
 * block id (a block is never both), so they serialize to the same registry id;
 * group captions need the entry id to disambiguate siblings.
 */
type EditorKey =
  | { kind: "block"; blockId: string }
  | { kind: "imageCaption"; blockId: string }
  | { kind: "imageGroupCaption"; blockId: string; entryId: string };

function editorKeyId(key: EditorKey): string {
  return key.kind === "imageGroupCaption" ? `${key.blockId}::${key.entryId}` : key.blockId;
}

function blockKey(blockId: string): EditorKey {
  return { kind: "block", blockId };
}

/** Maps an uploaded image payload to a group entry input (entries have no `align`). */
function imageInputToGroupEntry<TMeta extends BlockMeta>(
  input: CreateImageBlockInput<TMeta>,
): CreateImageGroupEntryInput<TMeta> {
  const { align: _align, ...entry } = input;
  return entry;
}

interface FocusRequest {
  key: EditorKey;
  offset: number;
  token: number;
}

interface SlashState {
  blockId: string;
  /** Inline offset of the "/" character. */
  slashOffset: number;
  query: string;
  /** Caret-line anchor (viewport coords) captured when the menu opened. */
  anchor: { x: number; top: number; bottom: number };
}

interface DropIndicator {
  blockId: string;
  position: "before" | "after";
}

function isTextLike(block: Block): block is Extract<Block, { type: "heading" | "text" }> {
  return block.type === "heading" || block.type === "text";
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files ?? []).filter(isImageFile);
  if (files.length > 0) {
    return files;
  }
  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function durableUrlFromDataTransfer(dataTransfer: DataTransfer): string | null {
  const uriList = dataTransfer.getData("text/uri-list");
  const uri = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  const candidate = uri ?? dataTransfer.getData("text/plain").trim();
  if (candidate.length === 0) {
    return null;
  }
  // Match the schema: only absolute http(s) URLs become image blocks, so a
  // dropped data:/blob:/file:/ftp:/javascript: link never reaches validation.
  const resolved = resolveDroppedUrl(candidate);
  return resolved !== null && isDurableImageUrl(resolved) ? resolved : null;
}

function resolveDroppedUrl(candidate: string): string | null {
  try {
    return new URL(candidate).href;
  } catch {
    const base = typeof document !== "undefined" ? document.baseURI : undefined;
    if (base === undefined) {
      return null;
    }
    try {
      return new URL(candidate, base).href;
    } catch {
      return null;
    }
  }
}

function imageBlocksFromHtml(html: string): Block[] {
  if (html.trim().length === 0) {
    return [];
  }
  return parseHtmlToBlocks(html).filter((block) => block.type === "image");
}

export function DocumentEditor<TMeta extends BlockMeta = BlockMeta>(props: DocumentEditorProps<TMeta>) {
  const {
    readOnly = false,
    showHeadingNumbers = false,
    renderBlock,
    resolveImageSource,
    resolveImageContentSource,
    onUploadImage,
    allowDroppedImageUrls = false,
    groupUploadedImages = false,
  } = props;

  const messages = useMemo(
    () => resolveMessages(props.locale, props.messages),
    [props.locale, props.messages],
  );
  const placeholder = props.placeholder ?? messages.placeholder;

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
    const ref = props.ref;
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
  }, [props.ref, editor]);

  // ---- per-block InlineEditor handles + focus requests ----
  const editorsRef = useRef(new Map<string, InlineEditorHandle>());
  const focusTokenRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const appliedFocusTokenRef = useRef(0);

  const requestFocus = useCallback((key: EditorKey, offset: number) => {
    focusTokenRef.current += 1;
    setFocusRequest({ key, offset, token: focusTokenRef.current });
  }, []);

  useLayoutEffect(() => {
    if (focusRequest === null || focusRequest.token === appliedFocusTokenRef.current) {
      return;
    }
    appliedFocusTokenRef.current = focusRequest.token;
    editorsRef.current.get(editorKeyId(focusRequest.key))?.focus(focusRequest.offset);
  }, [focusRequest]);

  const registerEditor = useCallback((key: EditorKey, handle: InlineEditorHandle | null) => {
    const id = editorKeyId(key);
    if (handle === null) {
      editorsRef.current.delete(id);
    } else {
      editorsRef.current.set(id, handle);
    }
  }, []);

  // ---- image-row item surfaces (focusable, non-editable drop/paste targets) ----
  const itemElementsRef = useRef(new Map<string, HTMLElement>());
  const [itemFocusRequest, setItemFocusRequest] = useState<{ id: string; token: number } | null>(null);
  const appliedItemFocusTokenRef = useRef(0);

  const itemKey = useCallback((blockId: string, entryId: string): string => `${blockId}::${entryId}`, []);

  const registerItemElement = useCallback(
    (blockId: string, entryId: string, element: HTMLElement | null) => {
      const id = `${blockId}::${entryId}`;
      if (element === null) {
        itemElementsRef.current.delete(id);
      } else {
        itemElementsRef.current.set(id, element);
      }
    },
    [],
  );

  const requestItemFocus = useCallback(
    (blockId: string, entryId: string) => {
      focusTokenRef.current += 1;
      setItemFocusRequest({ id: itemKey(blockId, entryId), token: focusTokenRef.current });
    },
    [itemKey],
  );

  useLayoutEffect(() => {
    if (itemFocusRequest === null || itemFocusRequest.token === appliedItemFocusTokenRef.current) {
      return;
    }
    appliedItemFocusTokenRef.current = itemFocusRequest.token;
    itemElementsRef.current.get(itemFocusRequest.id)?.focus();
  }, [itemFocusRequest]);

  // ---- slash menu ----
  const getSlashAnchor = useCallback((blockId: string): { x: number; top: number; bottom: number } => {
    const root = editorsRef.current.get(blockId)?.getElement();
    if (root == null) {
      return { x: 0, top: 0, bottom: 0 };
    }
    // Prefer the caret's visual line (correct in wrapped/multi-line blocks);
    // fall back to the block box only when the caret can't be measured.
    const caretLine = getCaretLineRect(root);
    if (caretLine !== null) {
      return caretLine;
    }
    const rect = root.getBoundingClientRect();
    return { x: rect.left, top: rect.top, bottom: rect.bottom };
  }, []);

  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const allSlashItems = useMemo(
    () => [
      ...buildCoreSlashItems(messages, {
        includeImageGroup: onUploadImage !== undefined || allowDroppedImageUrls,
      }),
      ...(props.slashItems ?? []),
      ...registry.slashItems,
    ],
    [messages, onUploadImage, allowDroppedImageUrls, props.slashItems, registry],
  );
  const slashItems = useMemo(
    () => (slash === null ? [] : filterSlashItems(allSlashItems, slash.query)),
    [slash, allSlashItems],
  );

  const closeSlash = useCallback(() => {
    setSlash(null);
    setSlashIndex(0);
  }, []);

  const insertBlocksAfter = useCallback(
    (afterBlockId: string | null, blocks: Block<TMeta>[]) => {
      if (blocks.length === 0) {
        return;
      }
      commands.applyPatches(
        blocks.map((block, position) => ({
          op: "insert_block_after",
          afterBlockId: position === 0 ? afterBlockId : blocks[position - 1]!.id,
          block,
        })),
      );
    },
    [commands],
  );

  const insertImageAfter = useCallback(
    (afterBlockId: string | null, input: ImageInsertionInput<TMeta>) => {
      insertBlocksAfter(afterBlockId, [createImageBlock<TMeta>(input)]);
    },
    [insertBlocksAfter],
  );

  const insertBlocksAtTextSelection = useCallback(
    (selection: { blockId: string; anchor: number; focus: number }, pasted: Block<TMeta>[], inlineSingleParagraph: boolean) => {
      if (pasted.length === 0) {
        return;
      }
      const currentDocument = engine.getDocument();
      const block = currentDocument.blocks.find((candidate) => candidate.id === selection.blockId);
      if (block === undefined || !isTextLike(block)) {
        return;
      }

      const start = Math.min(selection.anchor, selection.focus);
      const end = Math.max(selection.anchor, selection.focus);
      const [left] = splitInlineContent(block.content, start);
      const [, right] = splitInlineContent(block.content, end);

      // Inline paste: a single paragraph splices into the current block (keeps its type).
      const only = pasted.length === 1 ? pasted[0] : undefined;
      if (inlineSingleParagraph && only !== undefined && only.type === "text" && only.variant === "paragraph") {
        const merged = concatInlineContent(concatInlineContent(left, only.content), right);
        commands.updateBlock(block.id, { content: merged });
        requestFocus(blockKey(block.id), getInlineLength(left) + getInlineLength(only.content));
        return;
      }

      // Block paste: split the current line, splice the blocks between, as one
      // atomic (single-undo) transaction through the patch pipeline.
      const index = currentDocument.blocks.findIndex((candidate) => candidate.id === block.id);
      const previousId = index > 0 ? currentDocument.blocks[index - 1]!.id : null;
      const rightBlock = getInlineLength(right) > 0 ? createTextBlock<TMeta>({ content: right }) : null;
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
        requestFocus(blockKey(rightBlock.id), 0);
      } else {
        const lastTextLike = [...pasted].reverse().find((candidate) => isTextLike(candidate));
        if (lastTextLike !== undefined && isTextLike(lastTextLike)) {
          requestFocus(blockKey(lastTextLike.id), getInlineLength(lastTextLike.content));
        }
      }
    },
    [engine, commands, requestFocus],
  );

  const uploadImageFiles = useCallback(
    async (files: File[]): Promise<Block<TMeta>[]> => {
      if (onUploadImage === undefined || files.length === 0) {
        return [];
      }
      const inputs = await Promise.all(files.map((file) => onUploadImage(file)));
      const resolved = inputs.filter(
        (input): input is ImageInsertionInput<TMeta> => input !== null && input !== undefined,
      );
      // Multiple files become one side-by-side group when opted in; a single
      // file (or the default) stays a plain image block per upload.
      if (groupUploadedImages && resolved.length >= 2) {
        return [createImageGroupBlock<TMeta>({ images: resolved.map(imageInputToGroupEntry) })];
      }
      return resolved.map((input) => createImageBlock<TMeta>(input));
    },
    [onUploadImage, groupUploadedImages],
  );

  // Resolves dropped/pasted files to image payloads (for filling a row slot),
  // dropping any the host rejected and preserving order.
  const uploadImageInputs = useCallback(
    async (files: File[]): Promise<ImageInsertionInput<TMeta>[]> => {
      if (onUploadImage === undefined || files.length === 0) {
        return [];
      }
      const inputs = await Promise.all(files.map((file) => onUploadImage(file)));
      return inputs.filter((input): input is ImageInsertionInput<TMeta> => input !== null && input !== undefined);
    },
    [onUploadImage],
  );

  // Transient drop feedback (e.g. an upload failure), keyed by block — and by
  // entry when it targets a single image-row slot. Auto-clears.
  const [dropFeedback, setDropFeedback] = useState<
    { blockId: string; entryId?: string | undefined; message: string } | null
  >(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDropFeedback = useCallback((blockId: string, entryId: string | undefined, message: string) => {
    if (feedbackTimerRef.current !== null) {
      clearTimeout(feedbackTimerRef.current);
    }
    setDropFeedback({ blockId, ...(entryId !== undefined ? { entryId } : {}), message });
    feedbackTimerRef.current = setTimeout(() => setDropFeedback(null), 3000);
  }, []);
  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) {
        clearTimeout(feedbackTimerRef.current);
      }
    },
    [],
  );

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
            requestFocus(blockKey(current.id), caret);
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
        case "image-group": {
          // Insert an empty 2-slot row; the user fills each slot by drop/paste.
          const group = createEmptyImageGroupBlock<TMeta>();
          commands.insertBlockAfter(current.id, group as Block<TMeta>);
          requestItemFocus(group.id, group.images[0]!.id);
          return;
        }
        default:
          break;
      }
      requestFocus(blockKey(current.id), slash.slashOffset);
    },
    [slash, engine, commands, closeSlash, requestFocus, requestItemFocus, props.slashItems, registry],
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
          requestFocus(blockKey(blockId), 0);
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
            requestFocus(blockKey(blockId), start + getInlineNodeLength(node));
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
  // The block last focused, retained across blur so a leave-the-editor prune can
  // spare the row the user is actively filling (e.g. while picking a file).
  const lastFocusedBlockIdRef = useRef<string | null>(null);

  const handleEditorFocus = useCallback((blockId: string) => {
    setFocusedBlockId(blockId);
    lastFocusedBlockIdRef.current = blockId;
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
      const imageFiles = getImageFiles(event.clipboardData);
      if (html.trim().length === 0 && text.length === 0 && imageFiles.length === 0) {
        return;
      }
      event.preventDefault();
      closeSlash();

      const pasteSelection = { blockId: selection.blockId, anchor: selection.anchor, focus: selection.focus };
      const insertParsedClipboard = () => {
        let pasted = parseClipboardToBlocks({ html, text }) as Block<TMeta>[];
        // URL-backed images from pasted HTML follow the same opt-in as dropped
        // URLs: drop them (but keep the surrounding text) unless allowed.
        if (!allowDroppedImageUrls) {
          pasted = pasted.filter((candidate) => candidate.type !== "image" && candidate.type !== "imageGroup");
        }
        insertBlocksAtTextSelection(pasteSelection, pasted, true);
      };

      if (imageFiles.length > 0 && onUploadImage !== undefined) {
        void uploadImageFiles(imageFiles).then((imageBlocks) => {
          if (imageBlocks.length > 0) {
            insertBlocksAtTextSelection(pasteSelection, imageBlocks, false);
          } else if (html.trim().length > 0 || text.length > 0) {
            insertParsedClipboard();
          }
        }).catch(() => undefined);
        return;
      }

      if (html.trim().length > 0 || text.length > 0) {
        insertParsedClipboard();
      }
    },
    [readOnly, engine, closeSlash, insertBlocksAtTextSelection, onUploadImage, uploadImageFiles, allowDroppedImageUrls],
  );

  // ---- keyboard structure ----
  const handleEnter = useCallback(
    (blockId: string, offset: number) => {
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      // Captions are single-line: Enter exits the image (or image group) into a
      // fresh paragraph below it rather than splitting the caption.
      if (block?.type === "image" || block?.type === "imageGroup") {
        const newId = commands.insertBlockAfter(blockId, createTextBlock({ content: [] }) as Block<TMeta>);
        requestFocus(blockKey(newId), 0);
        return;
      }
      // Enter on an empty list item exits the list instead of adding another
      // bullet: outdent one level if nested, else turn back into a paragraph
      // (mirrors Backspace-at-start). Applies to bullet and numbered variants.
      if (
        block !== undefined &&
        block.type === "text" &&
        block.variant !== "paragraph" &&
        getInlineLength(block.content) === 0
      ) {
        if ((block.indent ?? 0) > 0) {
          commands.outdent(blockId);
        } else {
          commands.turnInto(blockId, { type: "text", variant: "paragraph" });
        }
        requestFocus(blockKey(blockId), 0);
        return;
      }
      const newBlockId = commands.splitBlock(blockId, offset);
      requestFocus(blockKey(newBlockId), 0);
    },
    [engine, commands, requestFocus],
  );

  const handleBackspaceAtStart = useCallback(
    (blockId: string, entryId?: string) => {
      const blocks = engine.getDocument().blocks;
      const index = blocks.findIndex((candidate) => candidate.id === blockId);
      const block = index === -1 ? undefined : blocks[index];
      if (block === undefined) {
        return;
      }
      // Backspace at the start of an empty image caption removes the image
      // (a non-empty caption has its own text to delete first). There is no
      // text to merge into an image, so this is the block's delete affordance.
      if (block.type === "image") {
        if (block.caption !== undefined && getInlineLength(block.caption) > 0) {
          return;
        }
        const previous = index > 0 ? blocks[index - 1] : undefined;
        commands.deleteBlock(blockId);
        if (previous !== undefined && isTextLike(previous)) {
          requestFocus(blockKey(previous.id), Number.MAX_SAFE_INTEGER);
        }
        return;
      }
      // Backspace at the start of an empty group caption removes that entry,
      // which may collapse the group to a single image or delete the block.
      if (block.type === "imageGroup") {
        if (entryId === undefined) {
          return;
        }
        const entryIndex = block.images.findIndex((candidate) => candidate.id === entryId);
        const entry = entryIndex === -1 ? undefined : block.images[entryIndex];
        if (entry === undefined) {
          return;
        }
        if (entry.caption !== undefined && getInlineLength(entry.caption) > 0) {
          return;
        }
        const previousEntry = entryIndex > 0 ? block.images[entryIndex - 1] : undefined;
        const previousBlock = index > 0 ? blocks[index - 1] : undefined;
        commands.removeImageGroupEntry(blockId, entryId);
        const after = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
        if (after?.type === "imageGroup") {
          const target = previousEntry ?? after.images[0]!;
          requestFocus({ kind: "imageGroupCaption", blockId, entryId: target.id }, Number.MAX_SAFE_INTEGER);
        } else if (after?.type === "image") {
          requestFocus({ kind: "imageCaption", blockId }, Number.MAX_SAFE_INTEGER);
        } else if (previousBlock !== undefined && isTextLike(previousBlock)) {
          requestFocus(blockKey(previousBlock.id), Number.MAX_SAFE_INTEGER);
        }
        return;
      }
      if (!isTextLike(block)) {
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
      requestFocus(blockKey(previous.id), offset);
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
    requestFocus(blockKey(newId), 0);
  }, [engine, commands, requestFocus]);

  const moveFocus = useCallback(
    (blockId: string, direction: -1 | 1, entryId?: string, preferredItemIndex?: number): boolean => {
      const blocks = engine.getDocument().blocks;
      const index = blocks.findIndex((candidate) => candidate.id === blockId);
      if (index === -1) {
        return false;
      }
      // Preserve the caret's column across the jump (like native editors). The
      // source may be a group caption, so address it by its full editor key.
      const sourceKey: EditorKey =
        entryId !== undefined ? { kind: "imageGroupCaption", blockId, entryId } : blockKey(blockId);
      const sourceElement = editorsRef.current.get(editorKeyId(sourceKey))?.getElement();
      const caretX = sourceElement != null ? getCaretViewportX(sourceElement) : null;

      // The column to keep when moving between image rows: an explicit preferred
      // index wins; otherwise carry over the source caption's entry position.
      const sourceBlock = blocks[index]!;
      const carryIndex =
        preferredItemIndex ??
        (entryId !== undefined && sourceBlock.type === "imageGroup"
          ? sourceBlock.images.findIndex((candidate) => candidate.id === entryId)
          : -1);

      const landOn = (key: EditorKey, targetElement: HTMLElement | null): void => {
        let offset: number | null = null;
        if (caretX !== null && targetElement !== null) {
          offset = getOffsetNearViewportX(targetElement, caretX, direction === -1 ? "last" : "first");
        }
        requestFocus(key, offset ?? (direction === -1 ? Number.MAX_SAFE_INTEGER : 0));
      };

      for (let cursor = index + direction; cursor >= 0 && cursor < blocks.length; cursor += direction) {
        const candidate = blocks[cursor]!;
        // Land on an image row's item: keep the column when one is known, else
        // the entry nearest the edge (first going down, last going up). Filled
        // entries land on their caption editor; empty slots land on the focusable
        // item surface so an all-empty row is reachable, not skipped.
        if (candidate.type === "imageGroup" && candidate.images.length > 0) {
          const target =
            carryIndex >= 0
              ? Math.min(carryIndex, candidate.images.length - 1)
              : direction === -1
                ? candidate.images.length - 1
                : 0;
          const entry = candidate.images[target]!;
          const targetItemKey = itemKey(candidate.id, entry.id);
          if (preferredItemIndex !== undefined && itemElementsRef.current.has(targetItemKey)) {
            requestItemFocus(candidate.id, entry.id);
            return true;
          }
          const captionKey: EditorKey = { kind: "imageGroupCaption", blockId: candidate.id, entryId: entry.id };
          const captionHandle = editorsRef.current.get(editorKeyId(captionKey));
          if (captionHandle !== undefined) {
            landOn(captionKey, captionHandle.getElement());
            return true;
          }
          if (itemElementsRef.current.has(targetItemKey)) {
            requestItemFocus(candidate.id, entry.id);
            return true;
          }
          continue;
        }
        const handle = editorsRef.current.get(candidate.id);
        // Image blocks have no primary editor, but their caption is editable —
        // navigation lands on it just like a text-like block.
        if ((isTextLike(candidate) || candidate.type === "image") && handle !== undefined) {
          landOn(blockKey(candidate.id), handle.getElement());
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
    [engine, editor.hiddenBlockIds, requestFocus, requestItemFocus, itemKey, addTrailingParagraph],
  );

  // ---- selection: inline tracking + block multi-select ----
  const handleSelectionChange = useCallback(
    (blockId: string, start: number, end: number, entryId?: string) => {
      editor.setSelection({
        type: "text",
        blockId,
        ...(entryId !== undefined ? { entryId } : {}),
        anchor: start,
        focus: end,
      });
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

  const handleExternalDrop = useCallback(
    (targetBlockId: string, position: "before" | "after", dataTransfer: DataTransfer) => {
      setDropIndicator(null);
      if (readOnly) {
        return;
      }
      const blocks = engine.getDocument().blocks;
      const targetIndex = blocks.findIndex((candidate) => candidate.id === targetBlockId);
      if (targetIndex === -1) {
        return;
      }
      const afterBlockId =
        position === "after" ? targetBlockId : targetIndex === 0 ? null : blocks[targetIndex - 1]!.id;

      const imageFiles = getImageFiles(dataTransfer);
      if (imageFiles.length > 0) {
        if (onUploadImage === undefined) {
          showDropFeedback(targetBlockId, undefined, messages.imageDropFailed);
          return;
        }
        void uploadImageFiles(imageFiles)
          .then((imageBlocks) => {
            if (imageBlocks.length === 0) {
              showDropFeedback(targetBlockId, undefined, messages.imageDropFailed);
            } else {
              insertBlocksAfter(afterBlockId, imageBlocks);
            }
          })
          .catch(() => showDropFeedback(targetBlockId, undefined, messages.imageDropFailed));
        return;
      }

      // Dropped image *URLs* (dragged web images / link text) only become images
      // when the host opts in — they are not host-uploaded bytes.
      const htmlImageBlocks = imageBlocksFromHtml(dataTransfer.getData("text/html")) as Block<TMeta>[];
      const url = durableUrlFromDataTransfer(dataTransfer);
      const hasUrlImage = htmlImageBlocks.length > 0 || url !== null;
      if (!allowDroppedImageUrls) {
        if (hasUrlImage) {
          showDropFeedback(targetBlockId, undefined, messages.imageDropUrlDisabled);
        }
        return;
      }
      if (htmlImageBlocks.length > 0) {
        insertBlocksAfter(afterBlockId, htmlImageBlocks);
        return;
      }
      if (url !== null) {
        insertImageAfter(afterBlockId, { source: { type: "url", url } });
      }
    },
    [readOnly, engine, onUploadImage, allowDroppedImageUrls, uploadImageFiles, insertBlocksAfter, insertImageAfter, showDropFeedback, messages],
  );

  // Fills/replaces one image-row slot. The first upload lands in the target
  // slot (keeping its id so focus stays put); any extras append as new filled
  // columns after it. Used by both drop and paste onto a slot.
  const applyEntryFill = useCallback(
    (blockId: string, entryId: string, inputs: ImageInsertionInput<TMeta>[]) => {
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      if (block === undefined || block.type !== "imageGroup" || inputs.length === 0) {
        return;
      }
      const index = block.images.findIndex((candidate) => candidate.id === entryId);
      if (index === -1) {
        return;
      }
      // Normalize through the factory so ids are generated and captions coerced.
      const normalized = createImageGroupBlock<TMeta>({ images: inputs.map(imageInputToGroupEntry) }).images;
      const images = [...block.images];
      images[index] = { ...normalized[0]!, id: entryId };
      images.splice(index + 1, 0, ...normalized.slice(1));
      commands.updateBlock(blockId, { images });
      requestItemFocus(blockId, entryId);
    },
    [engine, commands, requestItemFocus],
  );

  const fillEntryFromTransfer = useCallback(
    (blockId: string, entryId: string, dataTransfer: DataTransfer) => {
      if (readOnly) {
        return;
      }
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      if (block === undefined || block.type !== "imageGroup") {
        return;
      }
      const imageFiles = getImageFiles(dataTransfer);
      if (imageFiles.length > 0) {
        if (onUploadImage === undefined) {
          showDropFeedback(blockId, entryId, messages.imageDropFailed);
          return;
        }
        void uploadImageInputs(imageFiles)
          .then((inputs) => {
            if (inputs.length === 0) {
              showDropFeedback(blockId, entryId, messages.imageDropFailed);
            } else {
              applyEntryFill(blockId, entryId, inputs);
            }
          })
          .catch(() => showDropFeedback(blockId, entryId, messages.imageDropFailed));
        return;
      }
      const url = durableUrlFromDataTransfer(dataTransfer);
      if (url !== null) {
        if (!allowDroppedImageUrls) {
          showDropFeedback(blockId, entryId, messages.imageDropUrlDisabled);
          return;
        }
        applyEntryFill(blockId, entryId, [{ source: { type: "url", url } }]);
        return;
      }
      showDropFeedback(blockId, entryId, messages.imageDropUnsupported);
    },
    [readOnly, engine, onUploadImage, allowDroppedImageUrls, uploadImageInputs, applyEntryFill, showDropFeedback, messages],
  );

  const addColumn = useCallback(
    (blockId: string) => {
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      if (block === undefined || block.type !== "imageGroup") {
        return;
      }
      const entry: ImageGroupEntry<TMeta> = { id: generateBlockId(), source: { type: "empty" } };
      const lastEntryId = block.images[block.images.length - 1]?.id ?? null;
      commands.insertImageGroupEntry(blockId, lastEntryId, entry);
      requestItemFocus(blockId, entry.id);
    },
    [engine, commands, requestItemFocus],
  );

  const removeColumn = useCallback(
    (blockId: string, entryId: string) => {
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      if (block === undefined || block.type !== "imageGroup") {
        return;
      }
      const index = block.images.findIndex((candidate) => candidate.id === entryId);
      commands.removeImageGroupEntry(blockId, entryId);
      const after = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      if (after?.type === "imageGroup") {
        const target = after.images[Math.max(0, index - 1)] ?? after.images[0];
        if (target !== undefined) {
          requestItemFocus(blockId, target.id);
        }
      }
    },
    [engine, commands, requestItemFocus],
  );

  const handleItemArrow = useCallback(
    (blockId: string, entryId: string, key: ImageItemArrow): boolean => {
      const block = engine.getDocument().blocks.find((candidate) => candidate.id === blockId);
      if (block === undefined || block.type !== "imageGroup") {
        return false;
      }
      const index = block.images.findIndex((candidate) => candidate.id === entryId);
      if (index === -1) {
        return false;
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        if (block.images.length < 2) {
          return false;
        }
        const dir = key === "ArrowLeft" ? -1 : 1;
        const nextIndex = (index + dir + block.images.length) % block.images.length;
        requestItemFocus(blockId, block.images[nextIndex]!.id);
        return true;
      }
      // Up/Down leave the row toward the adjacent block, keeping this column.
      return moveFocus(blockId, key === "ArrowUp" ? -1 : 1, undefined, index);
    },
    [engine, requestItemFocus, moveFocus],
  );

  const handleItemFocus = useCallback(
    (blockId: string) => {
      // An item surface is focused, not a caption — clear any text selection so
      // the formatting toolbar doesn't linger over the now-unfocused text.
      setFocusedBlockId(blockId);
      lastFocusedBlockIdRef.current = blockId;
      editor.setSelection(null);
    },
    [editor],
  );

  // ---- floating toolbar ----
  const textSelection = editor.selection?.type === "text" ? editor.selection : null;
  // The `isTextLike` filter intentionally excludes image and image-group
  // caption selections: captions are editable but get no formatting toolbar for
  // now (they carry an entryId / target caption content the mark commands don't
  // address yet). This keeps the toolbar from acting on the wrong inline target.
  const toolbarTarget =
    textSelection !== null && textSelection.anchor !== textSelection.focus
      ? document.blocks.find((candidate) => candidate.id === textSelection.blockId && isTextLike(candidate))
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
    // textSelection isn't read here, but a selection change must re-measure the live range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleContainerBlur = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }
      editor.commit();
      // Clean up unfilled image-row slots when the user leaves the editor — but
      // spare the row they last touched. Leaving is exactly when someone steps
      // out to pick/drag a file, so the in-progress row must survive the round
      // trip; only rows they had already moved on from get pruned.
      if (!readOnly) {
        commands.pruneEmptyImageSlots(lastFocusedBlockIdRef.current ?? undefined);
      }
    },
    [editor, readOnly, commands],
  );

  // A non-editable block at the end of the document has no caret position after
  // it — offer a click target to add (and focus) a trailing line.
  const lastBlock = document.blocks[document.blocks.length - 1];
  const showTrailingAdd =
    !readOnly && lastBlock !== undefined && !editor.hiddenBlockIds.has(lastBlock.id) && !isTextLike(lastBlock);

  // ---- render ----
  return (
    <MessagesProvider messages={messages}>
    <div
      className={["wte-editor", props.className].filter(Boolean).join(" ")}
      role="textbox"
      aria-multiline
      aria-label={props.ariaLabel ?? messages.documentAriaLabel}
      onKeyDown={handleContainerKeyDown}
      onMouseDown={handleEditorMouseDown}
      onBlur={handleContainerBlur}
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
          onDropExternal={handleExternalDrop}
          onInterceptKeyDown={interceptKeyDown}
          inlineRenderers={inlineRenderers}
          blockRenderers={
            registry.blockRenderers as unknown as ReadonlyMap<string, (props: RenderBlockProps) => ReactNode>
          }
          renderBlock={renderBlock as DocumentEditorProps["renderBlock"]}
          resolveImageSource={resolveImageSource as DocumentEditorProps["resolveImageSource"]}
          resolveImageContentSource={resolveImageContentSource as DocumentEditorProps["resolveImageContentSource"]}
          commandsUpdateBlock={commands.updateBlock}
          registerItemElement={registerItemElement}
          onEntryFill={fillEntryFromTransfer}
          onItemFocus={handleItemFocus}
          onItemArrow={handleItemArrow}
          onAddColumn={addColumn}
          onRemoveColumn={removeColumn}
          imageGroupFeedback={
            dropFeedback?.blockId === block.id && dropFeedback.entryId !== undefined
              ? { entryId: dropFeedback.entryId, message: dropFeedback.message }
              : null
          }
          blockFeedback={
            dropFeedback?.blockId === block.id && dropFeedback.entryId === undefined ? dropFeedback.message : null
          }
        />
      ))}

      {showTrailingAdd && (
        <div
          className="wte-trailing-line"
          role="button"
          tabIndex={-1}
          aria-label={messages.addLineBelow}
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
          anchor={slash.anchor}
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
    </MessagesProvider>
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
  registerEditor(key: EditorKey, handle: InlineEditorHandle | null): void;
  onContentChange(blockId: string, content: InlineNode[], caret: number | null): void;
  onSelectionChange(blockId: string, start: number, end: number, entryId?: string): void;
  onEnter(blockId: string, offset: number): void;
  onBackspaceAtStart(blockId: string, entryId?: string): void;
  onTab(blockId: string, shift: boolean): void;
  onEditorFocus(blockId: string): void;
  onEditorBlur(blockId: string): void;
  onMoveFocus(blockId: string, direction: -1 | 1, entryId?: string): boolean;
  onHandleClick(blockId: string, shiftKey: boolean): void;
  onToggleCollapsed(headingId: string): void;
  onDropIndicatorChange(indicator: DropIndicator | null): void;
  onDropBlock(targetBlockId: string, position: "before" | "after", draggedBlockId: string): void;
  onDropExternal(targetBlockId: string, position: "before" | "after", dataTransfer: DataTransfer): void;
  onInterceptKeyDown(blockId: string, event: ReactKeyboardEvent): boolean;
  inlineRenderers: ReadonlyMap<string, InlineRenderConfig>;
  blockRenderers: ReadonlyMap<string, (props: RenderBlockProps) => ReactNode>;
  renderBlock: DocumentEditorProps["renderBlock"];
  resolveImageSource: DocumentEditorProps["resolveImageSource"];
  resolveImageContentSource: DocumentEditorProps["resolveImageContentSource"];
  commandsUpdateBlock(blockId: string, patch: Record<string, unknown>): void;
  registerItemElement(blockId: string, entryId: string, element: HTMLElement | null): void;
  onEntryFill(blockId: string, entryId: string, dataTransfer: DataTransfer): void;
  onItemFocus(blockId: string, entryId: string): void;
  onItemArrow(blockId: string, entryId: string, key: ImageItemArrow): boolean;
  onAddColumn(blockId: string): void;
  onRemoveColumn(blockId: string, entryId: string): void;
  imageGroupFeedback: { entryId: string; message: string } | null;
  blockFeedback: string | null;
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
  onDropExternal,
  onInterceptKeyDown,
  inlineRenderers,
  blockRenderers,
  renderBlock,
  resolveImageSource,
  resolveImageContentSource,
  commandsUpdateBlock,
  registerItemElement,
  onEntryFill,
  onItemFocus,
  onItemArrow,
  onAddColumn,
  onRemoveColumn,
  imageGroupFeedback,
  blockFeedback,
}: BlockRowProps) {
  const messages = useMessages();
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
        if (readOnly) {
          return;
        }
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        onDropIndicatorChange({ blockId: block.id, position });
      }}
      onDragLeave={() => onDropIndicatorChange(null)}
      onDrop={(event) => {
        if (readOnly) {
          return;
        }
        event.preventDefault();
        onDropIndicatorChange(null);
        const draggedId = event.dataTransfer.getData("text/wte-block");
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        if (draggedId.length > 0) {
          onDropBlock(block.id, position, draggedId);
        } else {
          onDropExternal(block.id, position, event.dataTransfer);
        }
      }}
    >
      <div className="wte-block__gutter" contentEditable={false}>
        {!readOnly && (
          <span
            className="wte-block__handle"
            draggable
            title={messages.dragHandleTitle}
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
            aria-label={collapsed ? messages.expandSection : messages.collapseSection}
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
              ref={(handle) => registerEditor(blockKey(block.id), handle)}
              as={`h${block.level}` as "h1"}
              content={block.content}
              readOnly={readOnly}
              ariaLabel={messages.headingAriaLabel(block.level)}
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
              ref={(handle) => registerEditor(blockKey(block.id), handle)}
              as="p"
              content={block.content}
              readOnly={readOnly}
              ariaLabel={messages.textBlockAriaLabel}
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

        {block.type === "image" && (
          <ImageView
            block={block as ImageBlock}
            readOnly={readOnly}
            resolveImageSource={resolveImageSource as ((block: ImageBlock) => string | undefined) | undefined}
            onImageChange={(patch) => commandsUpdateBlock(block.id, patch)}
            registerCaptionEditor={(handle) => registerEditor({ kind: "imageCaption", blockId: block.id }, handle)}
            onCaptionSelectionChange={(start, end) => onSelectionChange(block.id, start, end)}
            onCaptionFocus={() => onEditorFocus(block.id)}
            onCaptionBlur={() => onEditorBlur(block.id)}
            onCaptionEnter={() => onEnter(block.id, 0)}
            onCaptionBackspaceAtStart={() => onBackspaceAtStart(block.id)}
            onCaptionArrowUp={() => onMoveFocus(block.id, -1)}
            onCaptionArrowDown={() => onMoveFocus(block.id, 1)}
          />
        )}

        {block.type === "imageGroup" && (
          <ImageGroupView
            block={block as ImageGroupBlock}
            readOnly={readOnly}
            resolveImageContentSource={resolveImageContentSource as ((entry: ImageGroupEntry) => string | undefined) | undefined}
            onImageGroupChange={(patch) => commandsUpdateBlock(block.id, patch)}
            registerCaptionEditor={(entryId, handle) =>
              registerEditor({ kind: "imageGroupCaption", blockId: block.id, entryId }, handle)
            }
            onCaptionSelectionChange={(entryId, start, end) => onSelectionChange(block.id, start, end, entryId)}
            onCaptionFocus={() => onEditorFocus(block.id)}
            onCaptionBlur={() => onEditorBlur(block.id)}
            onCaptionEnter={() => onEnter(block.id, 0)}
            onCaptionBackspaceAtStart={(entryId) => onBackspaceAtStart(block.id, entryId)}
            onCaptionArrowUp={(entryId) => onMoveFocus(block.id, -1, entryId)}
            onCaptionArrowDown={(entryId) => onMoveFocus(block.id, 1, entryId)}
            registerItemElement={(entryId, element) => registerItemElement(block.id, entryId, element)}
            onEntryDrop={(entryId, dataTransfer) => onEntryFill(block.id, entryId, dataTransfer)}
            onEntryPaste={(entryId, dataTransfer) => onEntryFill(block.id, entryId, dataTransfer)}
            onItemFocus={(entryId) => onItemFocus(block.id, entryId)}
            onItemArrow={(entryId, key) => onItemArrow(block.id, entryId, key)}
            onAddColumn={() => onAddColumn(block.id)}
            onRemoveColumn={(entryId) => onRemoveColumn(block.id, entryId)}
            {...(imageGroupFeedback !== null
              ? { feedbackEntryId: imageGroupFeedback.entryId, feedbackMessage: imageGroupFeedback.message }
              : {})}
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

        {blockFeedback !== null && (
          <span className="wte-image__feedback" role="status" contentEditable={false}>
            {blockFeedback}
          </span>
        )}
      </div>
    </div>
  );
}
