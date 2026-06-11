import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Plus,
  TableIcon,
  Trash2,
  UnderlineIcon,
} from "lucide-react";
import type {
  ContentNode,
  InlineMark,
  InlineNode,
  LegalDocumentBlock,
  LegalRequest,
  SignatureLineNode,
} from "../shared/document-schema";
import { getBlockNumberingLevel, isBlockTitleNumberingEnabled } from "../shared/document-numbering";
import {
  resolveBodyStyle,
  resolveRoleTitleStyle,
  resolveSignatureStyle,
  type DocumentStyleTemplate,
} from "../shared/document-style-template";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "../lib/utils";

type MinutaBlockEditorProps = {
  block: LegalDocumentBlock;
  index: number;
  canChangeFontSize?: boolean;
  onCommit: (block: LegalDocumentBlock) => void;
  saveToken: number;
  styleTemplate: DocumentStyleTemplate;
  titlePrefix?: string | null;
};

type InlineEditorProps = {
  activeAlignment?: TextAlignment;
  activeFontSizePt?: number;
  ariaLabel: string;
  canAlign?: boolean;
  canChangeFontSize?: boolean;
  className?: string;
  editableClassName?: string;
  focusOffset?: number;
  focusToken?: number;
  nodes: InlineNode[];
  onAlign?: (alignment: TextAlignment) => void;
  onChange: (nodes: InlineNode[]) => void;
  onFontSizeChange?: (fontSizePt: number) => void;
  onBackspace?: (selection: InlineSelection) => boolean;
  onEnter?: (selection: InlineSelection) => void;
  onArrowDown?: (selection: InlineSelection) => boolean;
  onArrowUp?: (selection: InlineSelection) => boolean;
  onInsertTable?: () => void;
  onFocus?: () => void;
  onSelectionChange?: (selection: InlineSelection) => void;
  placeholder?: string;
  showToolbar?: boolean;
  singleLine?: boolean;
  style?: React.CSSProperties;
  variant?: "framed" | "bare";
};

type InlineSelection = {
  start: number;
  end: number;
};

type ToggleInlineMarkType = "bold" | "italic" | "underline";

type TokenInlineMarkType = "color" | "highlight";

type ActiveInlineTarget =
  | { type: "paragraph"; nodeIndex: number }
  | { type: "listItem"; nodeIndex: number; itemId: string };

type ActiveInlineSelection = {
  target: ActiveInlineTarget;
  selection: InlineSelection;
};

type SpecialInlineTarget =
  | { type: "requestTitle" }
  | { type: "requestItem"; requestId: string }
  | { type: "signatureTitle" }
  | { type: "signatureName"; lawyerId: string }
  | { type: "signatureOab"; lawyerId: string };

type SpecialInlineSelection = {
  target: SpecialInlineTarget;
  selection: InlineSelection;
};

type InlineFocusRequest = {
  key: string;
  offset: number;
  token: number;
};

type TextAlignment = "left" | "center" | "right" | "justify";

type TableSelection =
  | { type: "cell"; rowIndex: number; columnId: string }
  | { type: "row"; rowIndex: number }
  | { type: "column"; columnId: string };

type TableMenuState = {
  x: number;
  y: number;
  selection: TableSelection;
};

type ContentRowMenuState = {
  x: number;
  y: number;
  nodeIndex: number;
};

type TableColumn = Extract<ContentNode, { type: "table" }>["columns"][number];
type SourceContentNode = Extract<ContentNode, { type: "citation" | "jurisprudence" }>;

type ColumnResizeState = {
  startX: number;
  leftIndex: number;
  startWidths: number[];
  tableWidthPx: number;
};

function createId(): string {
  return crypto.randomUUID();
}

function getSelectionOffsets(root: HTMLElement): InlineSelection | null {
  const browserSelection = window.getSelection();
  if (!browserSelection || browserSelection.rangeCount === 0) {
    return null;
  }

  const range = browserSelection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  const startRange = range.cloneRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = range.cloneRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

function findTextPosition(root: Node, targetOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = targetOffset;
  let currentNode = walker.nextNode() as Text | null;

  while (currentNode) {
    const textLength = currentNode.textContent?.length ?? 0;
    if (offset <= textLength) {
      return {
        node: currentNode,
        offset,
      };
    }

    offset -= textLength;
    currentNode = walker.nextNode() as Text | null;
  }

  return null;
}

function setSelectionOffsets(root: HTMLElement, selection: InlineSelection): void {
  const start = findTextPosition(root, selection.start);
  const end = findTextPosition(root, selection.end);

  if (!start || !end) {
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
    return;
  }

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);

  const browserSelection = window.getSelection();
  browserSelection?.removeAllRanges();
  browserSelection?.addRange(range);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineNodesHtml(nodes: InlineNode[]): string {
  const normalized = normalizeInlineNodesForEdit(nodes);
  const text = getInlineText(normalized);
  if (text.length === 0) {
    return "";
  }

  return normalized
    .map((node) => {
      if (node.type !== "text") {
        return `<span class="minuta-native-placeholder">${escapeHtml(node.key)}</span>`;
      }

      const className = cn(
        inlineMarkClassName(node.marks),
        (node.origin?.type === "placeholder" || node.placeholderState) && "minuta-native-placeholder",
      );
      const title = node.origin?.key ? ` title="Placeholder: ${escapeHtml(node.origin.key)}"` : "";
      const style = inlineMarkStyleAttribute(node.marks);
      return `<span${className ? ` class="${escapeHtml(className)}"` : ""}${style ? ` style="${style}"` : ""}${title}>${escapeHtml(node.text)}</span>`;
    })
    .join("");
}

function replaceBlock(block: LegalDocumentBlock, update: (draft: LegalDocumentBlock) => void): LegalDocumentBlock {
  const draft = structuredClone(block) as LegalDocumentBlock;
  update(draft);
  return draft;
}

function getInlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.text;
      }

      return node.key;
    })
    .join("");
}

function isInlineTextBlank(nodes: InlineNode[]): boolean {
  return getInlineText(normalizeInlineNodesForEdit(nodes)).trim().length === 0;
}

function isInlineSelectionAtBoundary(selection: InlineSelection, nodes: InlineNode[], boundary: "start" | "end"): boolean {
  if (selection.start !== selection.end) {
    return false;
  }

  if (boundary === "start") {
    return selection.start === 0;
  }

  return selection.start === getInlineText(normalizeInlineNodesForEdit(nodes)).length;
}

function normalizeInlineNodesForEdit(nodes: InlineNode[]): InlineNode[] {
  const normalized = nodes.map((node): InlineNode => {
    if (node.type === "text") {
      return node;
    }

    return {
      type: "text",
      text: node.key,
      origin: {
        type: "placeholder",
        key: node.key,
      },
      placeholderState: "unfilled",
      ...(node.marks ? { marks: node.marks } : {}),
    };
  });

  return normalized.length > 0 ? normalized : [{ type: "text", text: "" }];
}

function sameMarks(left: InlineMark[] | undefined, right: InlineMark[] | undefined): boolean {
  const leftKeys = (left ?? []).map(getInlineMarkKey).sort();
  const rightKeys = (right ?? []).map(getInlineMarkKey).sort();

  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

function getInlineMarkKey(mark: InlineMark): string {
  return mark.type === "color" || mark.type === "highlight" ? `${mark.type}:${mark.token}` : mark.type;
}

function samePlaceholderMeta(left: InlineNode, right: InlineNode): boolean {
  if (left.type !== "text" || right.type !== "text") {
    return left.type === right.type;
  }

  return left.origin?.key === right.origin?.key && left.placeholderState === right.placeholderState;
}

function compactInlineNodes(nodes: InlineNode[]): InlineNode[] {
  const compacted: InlineNode[] = [];

  for (const node of nodes) {
    if (node.type !== "text" || node.text.length === 0) {
      continue;
    }

    const previous = compacted[compacted.length - 1];
    if (previous?.type === "text" && sameMarks(previous.marks, node.marks) && samePlaceholderMeta(previous, node)) {
      previous.text += node.text;
      continue;
    }

    compacted.push(node);
  }

  return compacted.length > 0 ? compacted : [{ type: "text", text: "" }];
}

function sliceInlineNodes(nodes: InlineNode[], start: number, end: number): InlineNode[] {
  const normalized = normalizeInlineNodesForEdit(nodes);
  const sliced: InlineNode[] = [];
  let offset = 0;

  for (const node of normalized) {
    if (node.type !== "text") {
      continue;
    }

    const nodeStart = offset;
    const nodeEnd = offset + node.text.length;
    offset = nodeEnd;

    if (nodeEnd <= start || nodeStart >= end) {
      continue;
    }

    const from = Math.max(start - nodeStart, 0);
    const to = Math.min(end - nodeStart, node.text.length);
    sliced.push({
      ...node,
      text: node.text.slice(from, to),
    });
  }

  return compactInlineNodes(sliced);
}

function getMarksForInsertion(nodes: InlineNode[], offset: number): InlineMark[] | undefined {
  let currentOffset = 0;

  for (const node of normalizeInlineNodesForEdit(nodes)) {
    if (node.type !== "text") {
      continue;
    }

    const nextOffset = currentOffset + node.text.length;
    if (offset >= currentOffset && offset <= nextOffset) {
      return node.marks;
    }

    currentOffset = nextOffset;
  }

  return undefined;
}

function reconcileInlineText(nodes: InlineNode[], nextText: string): InlineNode[] {
  const currentText = getInlineText(normalizeInlineNodesForEdit(nodes));

  if (currentText === nextText) {
    return normalizeInlineNodesForEdit(nodes);
  }

  let prefixLength = 0;
  while (prefixLength < currentText.length && prefixLength < nextText.length && currentText[prefixLength] === nextText[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < currentText.length - prefixLength &&
    suffixLength < nextText.length - prefixLength &&
    currentText[currentText.length - 1 - suffixLength] === nextText[nextText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const insertedText = nextText.slice(prefixLength, nextText.length - suffixLength);
  const prefixNodes = sliceInlineNodes(nodes, 0, prefixLength);
  const suffixNodes = suffixLength > 0 ? sliceInlineNodes(nodes, currentText.length - suffixLength, currentText.length) : [];
  const insertionMarks = getMarksForInsertion(nodes, prefixLength);

  return compactInlineNodes([
    ...prefixNodes,
    ...(insertedText.length > 0 ? [{ type: "text" as const, text: insertedText, ...(insertionMarks ? { marks: insertionMarks } : {}) }] : []),
    ...suffixNodes,
  ]);
}

function toggleInlineMark(nodes: InlineNode[], selection: InlineSelection, markType: ToggleInlineMarkType): InlineNode[] {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);

  if (start === end) {
    return nodes;
  }

  const currentText = getInlineText(normalizeInlineNodesForEdit(nodes));
  const before = sliceInlineNodes(nodes, 0, start);
  const selected = sliceInlineNodes(nodes, start, end);
  const after = sliceInlineNodes(nodes, end, currentText.length);
  const allSelectedHaveMark = selected.every((node) => node.type === "text" && hasMark(node.marks, markType));
  const marked = selected.map((node): InlineNode => {
    if (node.type !== "text") {
      return node;
    }

    const marks = allSelectedHaveMark
      ? (node.marks ?? []).filter((mark) => mark.type !== markType)
      : [...(node.marks ?? []).filter((mark) => mark.type !== markType), { type: markType }];

    return {
      ...node,
      ...(marks.length > 0 ? { marks } : { marks: undefined }),
    };
  });

  return compactInlineNodes([...before, ...marked, ...after]);
}

function applyInlineTokenMark(nodes: InlineNode[], selection: InlineSelection, markType: TokenInlineMarkType, token: string | null): InlineNode[] {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);

  if (start === end) {
    return nodes;
  }

  const currentText = getInlineText(normalizeInlineNodesForEdit(nodes));
  const before = sliceInlineNodes(nodes, 0, start);
  const selected = sliceInlineNodes(nodes, start, end);
  const after = sliceInlineNodes(nodes, end, currentText.length);
  const marked = selected.map((node): InlineNode => {
    if (node.type !== "text") {
      return node;
    }

    const nextMarks = (node.marks ?? []).filter((mark) => mark.type !== markType);
    if (token) {
      nextMarks.push({ type: markType, token });
    }

    return {
      ...node,
      ...(nextMarks.length > 0 ? { marks: nextMarks } : { marks: undefined }),
    };
  });

  return compactInlineNodes([...before, ...marked, ...after]);
}

function hasMark(marks: InlineMark[] | undefined, markType: InlineMark["type"]): boolean {
  return (marks ?? []).some((mark) => mark.type === markType);
}

function getSelectionTokenMark(nodes: InlineNode[], selection: InlineSelection, markType: TokenInlineMarkType): string | null {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (start === end) {
    return null;
  }

  const tokens = sliceInlineNodes(nodes, start, end)
    .flatMap((node) => (node.type === "text" ? (node.marks ?? []) : []))
    .filter((mark): mark is Extract<InlineMark, { type: TokenInlineMarkType }> => mark.type === markType)
    .map((mark) => mark.token);

  return tokens.length > 0 && tokens.every((token) => token === tokens[0]) ? tokens[0] : null;
}

function inlineMarkClassName(marks: InlineMark[] | undefined): string {
  return cn(hasMark(marks, "bold") && "font-semibold", hasMark(marks, "italic") && "italic", hasMark(marks, "underline") && "underline");
}

function inlineMarkStyle(marks: InlineMark[] | undefined): React.CSSProperties | undefined {
  const colorMark = marks?.find((mark): mark is Extract<InlineMark, { type: "color" }> => mark.type === "color");
  const highlightMark = marks?.find((mark): mark is Extract<InlineMark, { type: "highlight" }> => mark.type === "highlight");

  if (!colorMark && !highlightMark) {
    return undefined;
  }

  return {
    color: colorMark?.token,
    backgroundColor: highlightMark?.token,
  };
}

function inlineMarkStyleAttribute(marks: InlineMark[] | undefined): string {
  const style = inlineMarkStyle(marks);
  if (!style) {
    return "";
  }

  return [
    style.color ? `color: ${escapeHtml(style.color)};` : "",
    style.backgroundColor ? `background-color: ${escapeHtml(String(style.backgroundColor))}; box-decoration-break: clone;` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function createParagraph(text = "", alignment: TextAlignment = "justify"): Extract<ContentNode, { type: "paragraph" }> {
  return {
    type: "paragraph",
    children: [{ type: "text", text }],
    style: {
      alignment,
    },
  };
}

function createListItem(children: InlineNode[] = [{ type: "text", text: "" }]) {
  return {
    id: createId(),
    children,
  };
}

function createListNodeFromItems(
  items: Array<{ id: string; children: InlineNode[] }>,
  kind: "bulletList" | "numberedList",
): Extract<ContentNode, { type: "bulletList" | "numberedList" }> {
  return {
    type: kind,
    ...(kind === "numberedList" ? { markerStyle: "decimal" as const } : {}),
    items: items.length > 0 ? items : [createListItem()],
  };
}

function createRequestFromInline(children: InlineNode[] = [{ type: "text", text: "" }], sourceRequest?: LegalRequest): LegalRequest {
  return {
    id: createId(),
    text: children,
    ...(sourceRequest?.style ? { style: structuredClone(sourceRequest.style) as LegalRequest["style"] } : {}),
    category: sourceRequest?.category ?? "other",
    required: sourceRequest?.required ?? true,
    sources: {
      supportingBlockIds: [],
      evidenceIds: [],
      knowledgeItemIds: [],
    },
  };
}

function createDefaultTable(): Extract<ContentNode, { type: "table" }> {
  const columns = Array.from({ length: 3 }, (_value, index) => ({
    id: createId(),
    header: [{ type: "text" as const, text: `Coluna ${index + 1}` }],
    width: {
      value: 33,
      unit: "percent" as const,
    },
  }));

  return {
    type: "table",
    columns,
    rows: Array.from({ length: 2 }, () => ({
      id: createId(),
      cells: columns.map((column) => ({
        columnId: column.id,
        children: [createParagraph("")],
      })),
    })),
    showHeader: true,
  };
}

function normalizeColumnWidths(columns: TableColumn[]): number[] {
  if (columns.length === 0) {
    return [];
  }

  const rawWidths = columns.map((column) => (column.width?.unit === "percent" && Number.isFinite(column.width.value) && column.width.value > 0 ? column.width.value : null));
  const knownWidthSum = rawWidths.reduce((sum, width) => sum + (width ?? 0), 0);
  const missingCount = rawWidths.filter((width) => width === null).length;

  if (knownWidthSum <= 0) {
    return columns.map(() => 100 / columns.length);
  }

  if (knownWidthSum >= 100 || missingCount === 0) {
    return rawWidths.map((width) => ((width ?? 0) / knownWidthSum) * 100);
  }

  const missingWidth = (100 - knownWidthSum) / missingCount;
  return rawWidths.map((width) => width ?? missingWidth);
}

function clampColumnWidth(width: number): number {
  return Math.min(Math.max(width, 8), 84);
}

function getColumnBoundaryOffset(widths: number[], boundaryIndex: number): number {
  return widths.slice(0, boundaryIndex + 1).reduce((sum, width) => sum + width, 0);
}

export function MinutaBlockEditor({ block, index, canChangeFontSize = false, onCommit, saveToken, styleTemplate, titlePrefix }: MinutaBlockEditorProps): JSX.Element {
  const [draftBlock, setDraftBlock] = useState<LegalDocumentBlock>(() => block);
  const latestDraftBlockRef = useRef(draftBlock);
  const lastHandledSaveTokenRef = useRef(saveToken);
  const [activeSpecialSelection, setActiveSpecialSelection] = useState<SpecialInlineSelection | null>(null);
  const [sectionTitleFocusRequest, setSectionTitleFocusRequest] = useState<InlineFocusRequest | null>(null);
  const [sectionContentFocusRequest, setSectionContentFocusRequest] = useState<InlineFocusRequest | null>(null);
  const inheritedTitleAlignment =
    draftBlock.type === "heading" && draftBlock.role === "document_title"
      ? resolveRoleTitleStyle(styleTemplate, "document_title").alignment
      : styleTemplate.sectionTitle.alignment;
  const titleAlignment = draftBlock.layout?.alignment ?? inheritedTitleAlignment;
  const inheritedTitleFontSize =
    draftBlock.type === "heading" && draftBlock.role === "document_title"
      ? resolveRoleTitleStyle(styleTemplate, "document_title").fontSizePt
      : styleTemplate.sectionTitle.fontSizePt;
  const titleFontSizePt = draftBlock.layout?.fontSizePt ?? inheritedTitleFontSize;
  const titleStyle =
    draftBlock.type === "heading" && draftBlock.role === "document_title"
      ? {
          fontSize: `${titleFontSizePt}pt`,
          fontWeight: resolveRoleTitleStyle(styleTemplate, "document_title").bold ? 700 : 600,
          textAlign: titleAlignment,
        }
      : {
          fontSize: `${titleFontSizePt}pt`,
          fontWeight: styleTemplate.sectionTitle.bold ? 700 : 600,
          textAlign: titleAlignment,
        };

  function updateTitleAlignment(alignment: TextAlignment): void {
    updateDraftBlock((currentBlock) => setBlockTitleAlignment(currentBlock, alignment));
  }

  function updateTitleFontSize(fontSizePt: number): void {
    updateDraftBlock((currentBlock) => setBlockTitleFontSize(currentBlock, fontSizePt));
  }

  function updateTitleNumbering(enabled: boolean): void {
    updateDraftBlock((currentBlock) => setBlockTitleNumberingEnabled(currentBlock, enabled));
  }

  function updateTitleNumberingLevel(level: number): void {
    updateDraftBlock((currentBlock) => setBlockTitleNumberingLevel(currentBlock, level));
  }

  useEffect(() => {
    setDraftBlock(block);
    latestDraftBlockRef.current = block;
    lastHandledSaveTokenRef.current = saveToken;
    setActiveSpecialSelection(null);
  }, [block.id]);

  useEffect(() => {
    if (saveToken <= 0 || lastHandledSaveTokenRef.current === saveToken) {
      return;
    }

    lastHandledSaveTokenRef.current = saveToken;
    onCommit(latestDraftBlockRef.current);
  }, [onCommit, saveToken]);

  const updateDraftBlock = useCallback(
    (getNextBlock: (currentBlock: LegalDocumentBlock) => LegalDocumentBlock) => {
      const nextBlock = getNextBlock(latestDraftBlockRef.current);
      latestDraftBlockRef.current = nextBlock;
      setDraftBlock(nextBlock);
    },
    [],
  );

  function insertParagraphAfterSectionTitle(): void {
    updateDraftBlock((currentBlock) =>
      replaceBlock(currentBlock, (draft) => {
        if (draft.type === "section") {
          draft.content = [createParagraph("", draft.role === "court_addressing" ? "center" : "justify"), ...draft.content];
        }
      }),
    );
    setSectionContentFocusRequest({
      key: "paragraph:0",
      offset: 0,
      token: Date.now(),
    });
  }

  function focusFirstSectionContent(): boolean {
    if (draftBlock.type !== "section") {
      return false;
    }

    const firstNode = draftBlock.content[0];
    if (!firstNode || firstNode.type === "paragraph") {
      setSectionContentFocusRequest({
        key: "paragraph:0",
        offset: 0,
        token: Date.now(),
      });
      return true;
    }

    if (firstNode.type === "bulletList" || firstNode.type === "numberedList") {
      const item = firstNode.items[0];
      if (!item) {
        return false;
      }

      setSectionContentFocusRequest({
        key: `listItem:0:${item.id}`,
        offset: 0,
        token: Date.now(),
      });
      return true;
    }

    if (firstNode.type === "table") {
      const columns = firstNode.columns.length > 0 ? firstNode.columns : createDefaultTable().columns;
      const column = columns[0];
      if (!column) {
        return false;
      }

      setSectionContentFocusRequest({
        key: `cell:0:0:${column.id}`,
        offset: 0,
        token: Date.now(),
      });
      return true;
    }

    return false;
  }

  function getActiveSpecialSelectionNodes(): InlineNode[] {
    if (!activeSpecialSelection) {
      return [{ type: "text", text: "" }];
    }

    return getSpecialInlineNodes(draftBlock, activeSpecialSelection.target);
  }

  function applyMarkToActiveSpecialSelection(markType: ToggleInlineMarkType): void {
    if (!activeSpecialSelection || activeSpecialSelection.selection.start === activeSpecialSelection.selection.end) {
      return;
    }

    const selectionTarget = activeSpecialSelection.target;
    updateDraftBlock((currentBlock) =>
      setSpecialInlineNodes(currentBlock, selectionTarget, (nodes) => toggleInlineMark(nodes, activeSpecialSelection.selection, markType)),
    );
  }

  function applyTokenMarkToActiveSpecialSelection(markType: TokenInlineMarkType, token: string | null): void {
    if (!activeSpecialSelection || activeSpecialSelection.selection.start === activeSpecialSelection.selection.end) {
      return;
    }

    const selectionTarget = activeSpecialSelection.target;
    updateDraftBlock((currentBlock) =>
      setSpecialInlineNodes(currentBlock, selectionTarget, (nodes) => applyInlineTokenMark(nodes, activeSpecialSelection.selection, markType, token)),
    );
  }

  function activateSpecialSelection(target: SpecialInlineTarget, selection: InlineSelection): void {
    setActiveSpecialSelection({ target, selection });
  }

  function getActiveSpecialAlignment(): TextAlignment | undefined {
    if (!activeSpecialSelection) {
      return undefined;
    }

    if (activeSpecialSelection.target.type === "requestItem" && draftBlock.type === "request_list") {
      return draftBlock.requests.find((request) => request.id === activeSpecialSelection.target.requestId)?.style?.alignment ?? "justify";
    }

    if (activeSpecialSelection.target.type === "requestTitle" || activeSpecialSelection.target.type === "signatureTitle") {
      return titleAlignment;
    }

    return undefined;
  }

  function getActiveSpecialFontSize(): number | undefined {
    if (!activeSpecialSelection) {
      return undefined;
    }

    if (activeSpecialSelection.target.type === "requestItem" && draftBlock.type === "request_list") {
      return draftBlock.requests.find((request) => request.id === activeSpecialSelection.target.requestId)?.style?.fontSizePt ?? resolveRequestItemStyle(styleTemplate).fontSizePt;
    }

    if (activeSpecialSelection.target.type === "requestTitle" || activeSpecialSelection.target.type === "signatureTitle") {
      return titleFontSizePt;
    }

    return undefined;
  }

  function canStyleActiveSpecialBlock(): boolean {
    return (
      activeSpecialSelection?.target.type === "requestTitle" ||
      activeSpecialSelection?.target.type === "signatureTitle" ||
      activeSpecialSelection?.target.type === "requestItem"
    );
  }

  function updateActiveSpecialAlignment(alignment: TextAlignment): void {
    if (!activeSpecialSelection || !canStyleActiveSpecialBlock()) {
      return;
    }

    const selectionTarget = activeSpecialSelection.target;
    if (selectionTarget.type === "requestItem") {
      updateDraftBlock((currentBlock) => setRequestStyle(currentBlock, selectionTarget.requestId, { alignment }));
      return;
    }

    updateTitleAlignment(alignment);
  }

  function updateActiveSpecialFontSize(fontSizePt: number): void {
    if (!activeSpecialSelection || !canStyleActiveSpecialBlock()) {
      return;
    }

    const selectionTarget = activeSpecialSelection.target;
    if (selectionTarget.type === "requestItem") {
      updateDraftBlock((currentBlock) => setRequestStyle(currentBlock, selectionTarget.requestId, { fontSizePt }));
      return;
    }

    updateTitleFontSize(fontSizePt);
  }

  const specialSelectionNodes = getActiveSpecialSelectionNodes();
  const hasActiveSpecialTextSelection = activeSpecialSelection !== null && activeSpecialSelection.selection.start !== activeSpecialSelection.selection.end;
  const canStyleActiveSpecial = canStyleActiveSpecialBlock();
  const specialInlineToolbar = (
    <InlineToolbar
      activeAlignment={getActiveSpecialAlignment()}
      activeFontSizePt={getActiveSpecialFontSize()}
      canAlign
      canChangeFontSize={canChangeFontSize}
      canFormatInline={hasActiveSpecialTextSelection}
      canInsertTable={false}
      canMakeList={draftBlock.type === "request_list"}
      highlightColorValue={activeSpecialSelection ? getSelectionTokenMark(specialSelectionNodes, activeSpecialSelection.selection, "highlight") ?? "#fff3a3" : "#fff3a3"}
      onAlign={canStyleActiveSpecial ? updateActiveSpecialAlignment : undefined}
      onBold={() => applyMarkToActiveSpecialSelection("bold")}
      onBulletList={draftBlock.type === "request_list" ? () => updateDraftBlock((currentBlock) => setRequestListMarker(currentBlock, "bullet")) : undefined}
      onClearHighlight={() => applyTokenMarkToActiveSpecialSelection("highlight", null)}
      onClearTextColor={() => applyTokenMarkToActiveSpecialSelection("color", null)}
      onFontSizeChange={canStyleActiveSpecial ? updateActiveSpecialFontSize : undefined}
      onHighlightChange={(token) => applyTokenMarkToActiveSpecialSelection("highlight", token)}
      onItalic={() => applyMarkToActiveSpecialSelection("italic")}
      onNumberedList={draftBlock.type === "request_list" ? () => updateDraftBlock((currentBlock) => setRequestListMarker(currentBlock, "decimal")) : undefined}
      onTextColorChange={(token) => applyTokenMarkToActiveSpecialSelection("color", token)}
      textColorValue={activeSpecialSelection ? getSelectionTokenMark(specialSelectionNodes, activeSpecialSelection.selection, "color") ?? "#151515" : "#151515"}
      onUnderline={() => applyMarkToActiveSpecialSelection("underline")}
    />
  );

  if (draftBlock.type === "heading") {
    return (
      <EditorShell index={index} role={draftBlock.role} type={draftBlock.type}>
        <TitleNumberingControls block={draftBlock} onEnabledChange={updateTitleNumbering} onLevelChange={updateTitleNumberingLevel} />
        <InlineEditor
          activeAlignment={titleAlignment}
          activeFontSizePt={titleFontSizePt}
          ariaLabel="Titulo"
          canAlign
          canChangeFontSize={canChangeFontSize}
          nodes={draftBlock.title}
          onAlign={updateTitleAlignment}
          onChange={(nodes) => updateDraftBlock((currentBlock) => setBlockTitle(currentBlock, nodes))}
          onFontSizeChange={updateTitleFontSize}
          singleLine
          style={titleStyle}
        />
      </EditorShell>
    );
  }

  if (draftBlock.type === "request_list") {
    const requestTitleNodes = draftBlock.title ?? [{ type: "text" as const, text: "" }];

    return (
      <EditorShell index={index} role={draftBlock.role} type={draftBlock.type}>
        <div className="minuta-special-edit-surface minuta-native-content-surface minuta-native-section-edit-surface">
          {specialInlineToolbar}
          <div className="minuta-native-document-flow minuta-native-section-document-flow">
            <div className="minuta-native-section-title-row">
              <div className="minuta-native-section-title-line" style={titleStyle}>
                {titlePrefix ? <span className="minuta-native-section-title-prefix">{titlePrefix}</span> : null}
                <InlineEditor
                  ariaLabel="Titulo dos pedidos"
                  className="minuta-native-section-title-inline"
                  editableClassName="minuta-native-section-title-editor"
                  nodes={requestTitleNodes}
                  onChange={(nodes) => updateDraftBlock((currentBlock) => setBlockTitle(currentBlock, nodes))}
                  onFocus={() => activateSpecialSelection({ type: "requestTitle" }, { start: 0, end: 0 })}
                  onSelectionChange={(selection) => activateSpecialSelection({ type: "requestTitle" }, selection)}
                  placeholder="Titulo dos pedidos"
                  showToolbar={false}
                  singleLine
                  variant="bare"
                />
              </div>
            </div>
            <RequestListEditor
              markerStyle={draftBlock.listStyle.markerOverride ?? "decimal"}
              onChange={(requests) => updateDraftBlock((currentBlock) => setRequestListRequests(currentBlock, requests))}
              onItemFocus={(requestId) => activateSpecialSelection({ type: "requestItem", requestId }, { start: 0, end: 0 })}
              onItemSelectionChange={(requestId, selection) => activateSpecialSelection({ type: "requestItem", requestId }, selection)}
              requests={draftBlock.requests}
            />
          </div>
        </div>
      </EditorShell>
    );
  }

  if (draftBlock.type === "signature") {
    return (
      <EditorShell index={index} role={draftBlock.role} type={draftBlock.type}>
        <div className="minuta-special-edit-surface minuta-native-content-surface minuta-native-section-edit-surface">
          {specialInlineToolbar}
          <div className="minuta-native-document-flow minuta-native-section-document-flow minuta-signature-document-flow" style={getSignatureContainerEditStyle(styleTemplate)}>
            {draftBlock.title ? (
              <div className="minuta-native-section-title-row">
                <div className="minuta-native-section-title-line" style={titleStyle}>
                  {titlePrefix ? <span className="minuta-native-section-title-prefix">{titlePrefix}</span> : null}
                  <InlineEditor
                    ariaLabel="Titulo da assinatura"
                    className="minuta-native-section-title-inline"
                    editableClassName="minuta-native-section-title-editor"
                    nodes={draftBlock.title}
                    onChange={(nodes) => updateDraftBlock((currentBlock) => setBlockTitle(currentBlock, nodes))}
                    onFocus={() => activateSpecialSelection({ type: "signatureTitle" }, { start: 0, end: 0 })}
                    onSelectionChange={(selection) => activateSpecialSelection({ type: "signatureTitle" }, selection)}
                    showToolbar={false}
                    singleLine
                    variant="bare"
                  />
                </div>
              </div>
            ) : null}
            {draftBlock.content.map((line) => (
              <SignatureLineEditor
                key={line.lawyerId}
                line={line}
                onChange={(update) => updateDraftBlock((currentBlock) => setSignatureLine(currentBlock, line.lawyerId, update))}
                onNameFocus={() => activateSpecialSelection({ type: "signatureName", lawyerId: line.lawyerId }, { start: 0, end: 0 })}
                onNameSelectionChange={(selection) => activateSpecialSelection({ type: "signatureName", lawyerId: line.lawyerId }, selection)}
                onOabFocus={() => activateSpecialSelection({ type: "signatureOab", lawyerId: line.lawyerId }, { start: 0, end: 0 })}
                onOabSelectionChange={(selection) => activateSpecialSelection({ type: "signatureOab", lawyerId: line.lawyerId }, selection)}
                styleTemplate={styleTemplate}
              />
            ))}
          </div>
        </div>
      </EditorShell>
    );
  }

  if (draftBlock.type === "section") {
    const sectionTitleNodes = draftBlock.title ?? [{ type: "text" as const, text: "" }];

    return (
      <EditorShell index={index} role={draftBlock.role} type={draftBlock.type}>
        <ContentSequenceEditor
          baseFontSizePt={resolveBodyStyle(styleTemplate).fontSizePt}
          canChangeFontSize={canChangeFontSize}
          content={draftBlock.content}
          documentFlowClassName="minuta-native-section-document-flow"
          enableRowContextMenu
          leadingRows={
            <div className="minuta-native-section-title-row">
              <div className="minuta-native-section-title-line" style={titleStyle}>
                {titlePrefix ? <span className="minuta-native-section-title-prefix">{titlePrefix}</span> : null}
                <InlineEditor
                  activeAlignment={titleAlignment}
                  activeFontSizePt={titleFontSizePt}
                  ariaLabel="Titulo da secao"
                  className="minuta-native-section-title-inline"
                  editableClassName="minuta-native-section-title-editor"
                  focusOffset={sectionTitleFocusRequest?.offset}
                  focusToken={sectionTitleFocusRequest?.token}
                  nodes={sectionTitleNodes}
                  onChange={(nodes) => updateDraftBlock((currentBlock) => setBlockTitle(currentBlock, nodes))}
                  onArrowDown={(selection) => {
                    if (!isInlineSelectionAtBoundary(selection, sectionTitleNodes, "end")) {
                      return false;
                    }

                    return focusFirstSectionContent();
                  }}
                  onEnter={insertParagraphAfterSectionTitle}
                  placeholder="Titulo da secao"
                  showToolbar={false}
                  singleLine
                  variant="bare"
                />
              </div>
            </div>
          }
          externalFocusRequest={sectionContentFocusRequest}
          onArrowUpBeforeFirst={() => {
            setSectionTitleFocusRequest({
              key: "sectionTitle",
              offset: getInlineText(normalizeInlineNodesForEdit(sectionTitleNodes)).length,
              token: Date.now(),
            });
            return true;
          }}
          onChange={(content) => updateDraftBlock((currentBlock) => setBlockContent(currentBlock, content))}
          surfaceClassName="minuta-native-section-edit-surface"
          textAlign={draftBlock.role === "court_addressing" ? "center" : "justify"}
        />
      </EditorShell>
    );
  }

  return (
    <EditorShell index={index} role={draftBlock.role} type={draftBlock.type}>
      {draftBlock.title ? (
        <>
          <TitleNumberingControls block={draftBlock} onEnabledChange={updateTitleNumbering} onLevelChange={updateTitleNumberingLevel} />
          <InlineEditor
            activeAlignment={titleAlignment}
            activeFontSizePt={titleFontSizePt}
            ariaLabel="Titulo do bloco"
            canAlign
            canChangeFontSize={canChangeFontSize}
            nodes={draftBlock.title}
            onAlign={updateTitleAlignment}
            onChange={(nodes) => updateDraftBlock((currentBlock) => setBlockTitle(currentBlock, nodes))}
            onFontSizeChange={updateTitleFontSize}
            singleLine
            style={titleStyle}
          />
        </>
      ) : null}
      <ContentSequenceEditor
        baseFontSizePt={resolveBodyStyle(styleTemplate).fontSizePt}
        canChangeFontSize={canChangeFontSize}
        content={draftBlock.content}
        onChange={(content) => updateDraftBlock((currentBlock) => setBlockContent(currentBlock, content))}
        textAlign={draftBlock.role === "court_addressing" ? "center" : "justify"}
      />
    </EditorShell>
  );
}

function EditorShell({ children }: { children: React.ReactNode; index: number; role: string; type: string }): JSX.Element {
  return <div className="minuta-native-editor-shell">{children}</div>;
}

function TitleNumberingControls({
  block,
  onEnabledChange,
  onLevelChange,
}: {
  block: LegalDocumentBlock;
  onEnabledChange: (enabled: boolean) => void;
  onLevelChange: (level: number) => void;
}): JSX.Element {
  const isEnabled = isBlockTitleNumberingEnabled(block);
  const level = getBlockNumberingLevel(block);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
      <Button
        aria-pressed={isEnabled}
        onClick={() => onEnabledChange(!isEnabled)}
        size="sm"
        title={isEnabled ? "Desativar numeracao do titulo" : "Ativar numeracao do titulo"}
        type="button"
        variant={isEnabled ? "default" : "outline"}
      >
        <ListOrdered data-icon="inline-start" />
        Numerar
      </Button>
      <label className={cn("flex items-center gap-2 text-xs text-muted-foreground", !isEnabled && "opacity-60")}>
        Nivel
        <Input
          aria-label="Nivel da numeracao do titulo"
          className="h-8 w-16"
          disabled={!isEnabled}
          max={6}
          min={1}
          onChange={(event) => onLevelChange(Number(event.target.value))}
          type="number"
          value={level}
        />
      </label>
    </div>
  );
}

function InlineEditor({
  activeAlignment,
  activeFontSizePt,
  ariaLabel,
  canAlign = false,
  canChangeFontSize = false,
  className,
  editableClassName,
  focusOffset = 0,
  focusToken,
  nodes,
  onAlign,
  onChange,
  onFontSizeChange,
  onBackspace,
  onEnter,
  onArrowDown,
  onArrowUp,
  onInsertTable,
  onFocus,
  onSelectionChange,
  placeholder,
  showToolbar = true,
  singleLine = false,
  style,
  variant = "framed",
}: InlineEditorProps): JSX.Element {
  const normalizedNodes = useMemo(() => normalizeInlineNodesForEdit(nodes), [nodes]);
  const [selection, setSelection] = useState<InlineSelection>({ start: 0, end: 0 });
  const editorRef = useRef<HTMLDivElement | null>(null);
  const shouldRestoreSelectionRef = useRef(false);
  const skipNextDomSyncRef = useRef(false);
  const text = getInlineText(normalizedNodes);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (skipNextDomSyncRef.current) {
      skipNextDomSyncRef.current = false;
      return;
    }

    editor.innerHTML = renderInlineNodesHtml(normalizedNodes);

    if (!shouldRestoreSelectionRef.current || document.activeElement !== editor) {
      return;
    }

    shouldRestoreSelectionRef.current = false;
    setSelectionOffsets(editor, selection);
  }, [normalizedNodes]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (focusToken === undefined || !editor) {
      return;
    }

    editor.focus();
    setSelectionOffsets(editor, { start: focusOffset, end: focusOffset });
  }, [focusOffset, focusToken]);

  function updateSelection(target: HTMLElement): InlineSelection {
    const nextSelection = getSelectionOffsets(target) ?? selection;
    setSelection(nextSelection);
    onSelectionChange?.(nextSelection);
    return nextSelection;
  }

  function handleTextInput(event: React.FormEvent<HTMLDivElement>): void {
    updateSelection(event.currentTarget);
    skipNextDomSyncRef.current = true;
    onChange(reconcileInlineText(normalizedNodes, (event.currentTarget.textContent ?? "").replace(/\u200B/g, "")));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "b") {
      event.preventDefault();
      onChange(toggleInlineMark(normalizedNodes, selection, "bold"));
      shouldRestoreSelectionRef.current = true;
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "i") {
      event.preventDefault();
      onChange(toggleInlineMark(normalizedNodes, selection, "italic"));
      shouldRestoreSelectionRef.current = true;
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "u") {
      event.preventDefault();
      onChange(toggleInlineMark(normalizedNodes, selection, "underline"));
      shouldRestoreSelectionRef.current = true;
      return;
    }

    if (event.key === "Backspace" && onBackspace?.(updateSelection(event.currentTarget))) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" && text.trim().toLocaleLowerCase("pt-BR") === "/tabela" && onInsertTable) {
      event.preventDefault();
      onChange([{ type: "text", text: "" }]);
      onInsertTable();
      return;
    }

    if (event.key === "Enter" && onEnter) {
      event.preventDefault();
      onEnter(updateSelection(event.currentTarget));
      return;
    }

    if (event.key === "ArrowDown" && onArrowDown?.(updateSelection(event.currentTarget))) {
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowUp" && onArrowUp?.(updateSelection(event.currentTarget))) {
      event.preventDefault();
      return;
    }

    if (singleLine && event.key === "Enter") {
      event.preventDefault();
      return;
    }
  }

  function applyMark(markType: ToggleInlineMarkType): void {
    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      setSelectionOffsets(editor, selection);
    }

    shouldRestoreSelectionRef.current = true;
    onChange(toggleInlineMark(normalizedNodes, selection, markType));
  }

  function applyTokenMark(markType: TokenInlineMarkType, token: string | null): void {
    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      setSelectionOffsets(editor, selection);
    }

    shouldRestoreSelectionRef.current = true;
    onChange(applyInlineTokenMark(normalizedNodes, selection, markType, token));
  }

  const hasExpandedSelection = selection.start !== selection.end;

  const editable = (
    <div
      ref={editorRef}
      aria-label={ariaLabel}
      className={cn(
        "minuta-native-inline-editor",
        singleLine && "minuta-native-inline-editor-single",
        editableClassName,
      )}
      contentEditable
      data-empty={text.length === 0 ? "true" : undefined}
      data-placeholder={placeholder}
      onBlur={(event) => updateSelection(event.currentTarget)}
      onFocus={() => {
        onFocus?.();
        if (editorRef.current) {
          updateSelection(editorRef.current);
        }
      }}
      onInput={handleTextInput}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => updateSelection(event.currentTarget)}
      onMouseUp={(event) => updateSelection(event.currentTarget)}
      onSelect={(event) => updateSelection(event.currentTarget)}
      role="textbox"
      spellCheck
      style={style}
      suppressContentEditableWarning
    />
  );

  if (variant === "bare") {
    return (
      <div className={cn("minuta-native-inline-bare", className)}>
        {editable}
      </div>
    );
  }

  return (
    <div className={cn("minuta-native-inline-frame", className)}>
      {showToolbar ? (
        <InlineToolbar
          activeAlignment={activeAlignment}
          activeFontSizePt={activeFontSizePt}
          canFormatInline={hasExpandedSelection}
          canInsertTable={Boolean(onInsertTable)}
          canAlign={canAlign}
          canChangeFontSize={canChangeFontSize}
          canMakeList={false}
          onAlign={onAlign}
          onBold={() => applyMark("bold")}
          onClearHighlight={() => applyTokenMark("highlight", null)}
          onClearTextColor={() => applyTokenMark("color", null)}
          onFontSizeChange={onFontSizeChange}
          onHighlightChange={(token) => applyTokenMark("highlight", token)}
          onInsertTable={onInsertTable}
          onItalic={() => applyMark("italic")}
          onTextColorChange={(token) => applyTokenMark("color", token)}
          textColorValue={getSelectionTokenMark(normalizedNodes, selection, "color") ?? "#151515"}
          highlightColorValue={getSelectionTokenMark(normalizedNodes, selection, "highlight") ?? "#fff3a3"}
          onUnderline={() => applyMark("underline")}
        />
      ) : null}
      {editable}
    </div>
  );
}

function InlineToolbar({
  activeAlignment,
  activeFontSizePt,
  canFormatInline = true,
  canInsertTable,
  canMakeList,
  canAlign,
  canChangeFontSize,
  highlightColorValue = "#fff3a3",
  onAlign,
  onBold,
  onBulletList,
  onClearHighlight,
  onClearTextColor,
  onFontSizeChange,
  onHighlightChange,
  onInsertTable,
  onItalic,
  onNumberedList,
  onTextColorChange,
  onUnderline,
  textColorValue = "#151515",
}: {
  activeAlignment?: TextAlignment;
  activeFontSizePt?: number;
  canFormatInline?: boolean;
  canInsertTable: boolean;
  canMakeList: boolean;
  canAlign?: boolean;
  canChangeFontSize?: boolean;
  highlightColorValue?: string;
  onAlign?: (alignment: TextAlignment) => void;
  onBold: () => void;
  onBulletList?: () => void;
  onClearHighlight?: () => void;
  onClearTextColor?: () => void;
  onFontSizeChange?: (fontSizePt: number) => void;
  onHighlightChange?: (token: string) => void;
  onInsertTable?: () => void;
  onItalic: () => void;
  onNumberedList?: () => void;
  onTextColorChange?: (token: string) => void;
  onUnderline: () => void;
  textColorValue?: string;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-muted/25 p-1">
      <ToolbarButton disabled={!canFormatInline} label="Negrito" onClick={onBold}>
        <Bold />
      </ToolbarButton>
      <ToolbarButton disabled={!canFormatInline} label="Italico" onClick={onItalic}>
        <Italic />
      </ToolbarButton>
      <ToolbarButton disabled={!canFormatInline} label="Sublinhado" onClick={onUnderline}>
        <UnderlineIcon />
      </ToolbarButton>
      {onTextColorChange || onHighlightChange ? (
        <>
          <InlineColorToolbarControl
            disabled={!canFormatInline || !onTextColorChange}
            label="Cor do texto selecionado"
            onChange={(token) => onTextColorChange?.(token)}
            onClear={onClearTextColor}
            value={textColorValue}
          >
            <span className="text-xs font-semibold leading-none">A</span>
          </InlineColorToolbarControl>
          <InlineColorToolbarControl
            disabled={!canFormatInline || !onHighlightChange}
            label="Realce do texto selecionado"
            onChange={(token) => onHighlightChange?.(token)}
            onClear={onClearHighlight}
            value={highlightColorValue}
          >
            <Highlighter />
          </InlineColorToolbarControl>
        </>
      ) : null}
      {canAlign ? (
        <>
          <span className="mx-1 h-6 w-px bg-border" />
          <ToolbarButton active={activeAlignment === "left"} disabled={!onAlign} label="Alinhar a esquerda" onClick={() => onAlign?.("left")}>
            <AlignLeft />
          </ToolbarButton>
          <ToolbarButton active={activeAlignment === "center"} disabled={!onAlign} label="Centralizar" onClick={() => onAlign?.("center")}>
            <AlignCenter />
          </ToolbarButton>
          <ToolbarButton active={activeAlignment === "right"} disabled={!onAlign} label="Alinhar a direita" onClick={() => onAlign?.("right")}>
            <AlignRight />
          </ToolbarButton>
          <ToolbarButton active={activeAlignment === "justify"} disabled={!onAlign} label="Justificar" onClick={() => onAlign?.("justify")}>
            <AlignJustify />
          </ToolbarButton>
        </>
      ) : null}
      {canChangeFontSize ? (
        <>
          <span className="mx-1 h-6 w-px bg-border" />
          <label className="flex items-center gap-1 rounded-md px-1 text-xs text-muted-foreground">
            Tamanho
            <select
              aria-label="Tamanho da fonte"
              className="h-8 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
              disabled={!onFontSizeChange}
              onChange={(event) => onFontSizeChange?.(Number(event.target.value))}
              value={String(activeFontSizePt ?? 12)}
            >
              {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32].map((fontSize) => (
                <option key={fontSize} value={fontSize}>
                  {fontSize}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {canMakeList ? (
        <>
          <ToolbarButton disabled={!onBulletList} label="Lista" onClick={() => onBulletList?.()}>
            <List />
          </ToolbarButton>
          <ToolbarButton disabled={!onNumberedList} label="Lista numerada" onClick={() => onNumberedList?.()}>
            <ListOrdered />
          </ToolbarButton>
        </>
      ) : null}
      {canInsertTable ? (
        <ToolbarButton label="Inserir tabela" onClick={() => onInsertTable?.()}>
          <TableIcon />
        </ToolbarButton>
      ) : null}
    </div>
  );
}

function InlineColorToolbarControl({
  children,
  disabled,
  label,
  onChange,
  onClear,
  value,
}: {
  children: React.ReactNode;
  disabled: boolean;
  label: string;
  onChange: (token: string) => void;
  onClear?: () => void;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-center rounded-md border bg-background">
      <label className={cn("relative flex size-8 items-center justify-center", disabled && "pointer-events-none opacity-50")} title={label}>
        {children}
        <input
          aria-label={label}
          className="absolute inset-0 cursor-pointer opacity-0"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={value}
        />
      </label>
      {onClear ? (
        <button
          aria-label={`Remover ${label.toLocaleLowerCase("pt-BR")}`}
          className="flex h-8 w-6 items-center justify-center border-l text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          onClick={onClear}
          onMouseDown={(event) => event.preventDefault()}
          title={`Remover ${label.toLocaleLowerCase("pt-BR")}`}
          type="button"
        >
          x
        </button>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button aria-label={label} className={cn(active && "bg-accent text-accent-foreground")} disabled={disabled} onClick={onClick} size="icon" title={label} type="button" variant="ghost">
      {children}
    </Button>
  );
}

function ContentSequenceEditor({
  baseFontSizePt,
  canChangeFontSize = false,
  content,
  documentFlowClassName,
  enableRowContextMenu = false,
  externalFocusRequest,
  leadingRows,
  onArrowUpBeforeFirst,
  onChange,
  showPersistentToolbar = true,
  surfaceClassName,
  textAlign,
}: {
  baseFontSizePt: number;
  canChangeFontSize?: boolean;
  content: ContentNode[];
  documentFlowClassName?: string;
  enableRowContextMenu?: boolean;
  externalFocusRequest?: InlineFocusRequest | null;
  leadingRows?: React.ReactNode;
  onArrowUpBeforeFirst?: () => boolean;
  onChange: (content: ContentNode[]) => void;
  showPersistentToolbar?: boolean;
  surfaceClassName?: string;
  textAlign: TextAlignment;
}): JSX.Element {
  const baseNodes = content.length > 0 ? content : [createParagraph("", textAlign)];
  const nodes = baseNodes[baseNodes.length - 1]?.type === "table" ? [...baseNodes, createParagraph("", textAlign)] : baseNodes;
  const [activeSelection, setActiveSelection] = useState<ActiveInlineSelection | null>(null);
  const [focusRequest, setFocusRequest] = useState<InlineFocusRequest | null>(null);
  const [rowMenu, setRowMenu] = useState<ContentRowMenuState | null>(null);

  function replaceNode(nodeIndex: number, nextNode: ContentNode): void {
    onChange(nodes.map((node, index) => (index === nodeIndex ? nextNode : node)));
  }

  function replaceNodeWithNodes(nodeIndex: number, nextContentNodes: ContentNode[]): void {
    const nextNodes = [...nodes];
    nextNodes.splice(nodeIndex, 1, ...nextContentNodes);
    onChange(nextNodes.length > 0 ? nextNodes : [createParagraph("", textAlign)]);
  }

  function insertNodeAfter(nodeIndex: number, nextNode: ContentNode): void {
    const nextNodes = [...nodes];
    nextNodes.splice(nodeIndex + 1, 0, nextNode);
    onChange(nextNodes);
  }

  function insertNodeAfterWithFocus(nodeIndex: number, nextNode: ContentNode): void {
    insertNodeAfter(nodeIndex, nextNode);
    setFocusRequest({
      key: `paragraph:${nodeIndex + 1}`,
      offset: 0,
      token: Date.now(),
    });
  }

  function deleteNode(nodeIndex: number): void {
    const nextNodes = nodes.filter((_node, index) => index !== nodeIndex);
    onChange(nextNodes.length > 0 ? nextNodes : [createParagraph("", textAlign)]);
  }

  function convertParagraphToList(nodeIndex: number, kind: "bulletList" | "numberedList"): void {
    const node = nodes[nodeIndex];
    if (node?.type !== "paragraph") {
      return;
    }

    const item = createListItem(node.children);
    replaceNode(nodeIndex, createListNodeFromItems([item], kind));
    setFocusRequest({
      key: `listItem:${nodeIndex}:${item.id}`,
      offset: getInlineText(normalizeInlineNodesForEdit(item.children)).length,
      token: Date.now(),
    });
  }

  function convertListToList(nodeIndex: number, kind: "bulletList" | "numberedList"): void {
    const node = nodes[nodeIndex];
    if (node?.type !== "bulletList" && node?.type !== "numberedList") {
      return;
    }

    replaceNode(nodeIndex, createListNodeFromItems(node.items, kind));
  }

  function convertListToParagraphs(nodeIndex: number): void {
    const node = nodes[nodeIndex];
    if (node?.type !== "bulletList" && node?.type !== "numberedList") {
      return;
    }

    replaceNodeWithNodes(
      nodeIndex,
      node.items.map((item) => createParagraphFromInline(item.children, textAlign)),
    );
  }

  function convertEmptyListItemToParagraph(nodeIndex: number, itemIndex: number): void {
    const node = nodes[nodeIndex];
    if (node?.type !== "bulletList" && node?.type !== "numberedList") {
      return;
    }

    const beforeItems = node.items.slice(0, itemIndex);
    const afterItems = node.items.slice(itemIndex + 1);
    const nextContentNodes: ContentNode[] = [];

    if (beforeItems.length > 0) {
      nextContentNodes.push(createListNodeFromItems(beforeItems, node.type));
    }

    nextContentNodes.push(createParagraph("", textAlign));

    if (afterItems.length > 0) {
      nextContentNodes.push(createListNodeFromItems(afterItems, node.type));
    }

    replaceNodeWithNodes(nodeIndex, nextContentNodes);
    setFocusRequest({
      key: `paragraph:${nodeIndex + (beforeItems.length > 0 ? 1 : 0)}`,
      offset: 0,
      token: Date.now(),
    });
  }

  function updateListItem(nodeIndex: number, itemId: string, children: InlineNode[]): void {
    const node = nodes[nodeIndex];
    if (node?.type !== "bulletList" && node?.type !== "numberedList") {
      return;
    }

    replaceNode(nodeIndex, {
      ...node,
      items: node.items.map((item) => (item.id === itemId ? { ...item, children } : item)),
    });
  }

  function applyMarkToActive(markType: ToggleInlineMarkType): void {
    if (!activeSelection || activeSelection.selection.start === activeSelection.selection.end) {
      return;
    }

    const node = nodes[activeSelection.target.nodeIndex];
    if (activeSelection.target.type === "paragraph" && node?.type === "paragraph") {
      replaceNode(activeSelection.target.nodeIndex, {
        ...node,
        children: toggleInlineMark(node.children, activeSelection.selection, markType),
      });
      return;
    }

    if (activeSelection.target.type === "listItem" && (node?.type === "bulletList" || node?.type === "numberedList")) {
      updateListItem(
        activeSelection.target.nodeIndex,
        activeSelection.target.itemId,
        toggleInlineMark(
          node.items.find((item) => item.id === activeSelection.target.itemId)?.children ?? [{ type: "text", text: "" }],
          activeSelection.selection,
          markType,
        ),
      );
    }
  }

  function applyTokenMarkToActive(markType: TokenInlineMarkType, token: string | null): void {
    if (!activeSelection || activeSelection.selection.start === activeSelection.selection.end) {
      return;
    }

    const node = nodes[activeSelection.target.nodeIndex];
    if (activeSelection.target.type === "paragraph" && node?.type === "paragraph") {
      replaceNode(activeSelection.target.nodeIndex, {
        ...node,
        children: applyInlineTokenMark(node.children, activeSelection.selection, markType, token),
      });
      return;
    }

    if (activeSelection.target.type === "listItem" && (node?.type === "bulletList" || node?.type === "numberedList")) {
      updateListItem(
        activeSelection.target.nodeIndex,
        activeSelection.target.itemId,
        applyInlineTokenMark(
          node.items.find((item) => item.id === activeSelection.target.itemId)?.children ?? [{ type: "text", text: "" }],
          activeSelection.selection,
          markType,
          token,
        ),
      );
    }
  }

  function getActiveSelectionNodes(): InlineNode[] {
    if (!activeSelection) {
      return [{ type: "text", text: "" }];
    }

    const node = nodes[activeSelection.target.nodeIndex];
    if (activeSelection.target.type === "paragraph" && node?.type === "paragraph") {
      return node.children;
    }

    if (activeSelection.target.type === "listItem" && (node?.type === "bulletList" || node?.type === "numberedList")) {
      return node.items.find((item) => item.id === activeSelection.target.itemId)?.children ?? [{ type: "text", text: "" }];
    }

    return [{ type: "text", text: "" }];
  }

  function getActiveTokenMark(markType: TokenInlineMarkType): string | null {
    if (!activeSelection) {
      return null;
    }

    return getSelectionTokenMark(getActiveSelectionNodes(), activeSelection.selection, markType);
  }

  function getActiveAlignment(): TextAlignment {
    const node = nodes[getActiveNodeIndex()];
    if (node?.type === "paragraph") {
      return node.style?.alignment ?? textAlign;
    }

    return textAlign;
  }

  function getActiveFontSize(): number {
    const node = nodes[getActiveNodeIndex()];
    if (node?.type === "paragraph") {
      return node.style?.fontSizePt ?? baseFontSizePt;
    }

    return baseFontSizePt;
  }

  function applyAlignmentToActive(alignment: TextAlignment): void {
    const nodeIndex = getActiveNodeIndex();
    const node = nodes[nodeIndex];
    if (node?.type !== "paragraph") {
      return;
    }

    replaceNode(nodeIndex, {
      ...node,
      style: {
        ...node.style,
        alignment,
      },
    });
  }

  function applyFontSizeToActive(fontSizePt: number): void {
    const nodeIndex = getActiveNodeIndex();
    const node = nodes[nodeIndex];
    if (node?.type !== "paragraph" || !Number.isFinite(fontSizePt) || fontSizePt <= 0) {
      return;
    }

    replaceNode(nodeIndex, {
      ...node,
      style: {
        ...node.style,
        fontSizePt,
      },
    });
  }

  function getActiveNodeIndex(): number {
    return activeSelection?.target.nodeIndex ?? Math.max(nodes.length - 1, 0);
  }

  const hasActiveTextSelection = activeSelection !== null && activeSelection.selection.start !== activeSelection.selection.end;

  function convertActiveParagraphToList(kind: "bulletList" | "numberedList"): void {
    const nodeIndex = getActiveNodeIndex();
    convertParagraphToList(nodeIndex, kind);
  }

  function insertTableAtActiveNode(): void {
    const nodeIndex = getActiveNodeIndex();
    const table = createDefaultTable();
    insertNodeAfter(nodeIndex, table);
    focusTableCell(nodeIndex + 1, 0, table.columns[0]?.id);
  }

  function applyTableActionToRow(nodeIndex: number): void {
    const node = nodes[nodeIndex];
    if (!node) {
      return;
    }

    const table = createDefaultTable();
    if (node.type === "paragraph" && isInlineTextBlank(node.children)) {
      replaceNode(nodeIndex, table);
      focusTableCell(nodeIndex, 0, table.columns[0]?.id);
      return;
    }

    insertNodeAfter(nodeIndex, table);
    focusTableCell(nodeIndex + 1, 0, table.columns[0]?.id);
  }

  function replaceActiveParagraphWithTable(nodeIndex: number): void {
    const table = createDefaultTable();
    replaceNode(nodeIndex, table);
    focusTableCell(nodeIndex, 0, table.columns[0]?.id);
  }

  function focusTableCell(nodeIndex: number, rowIndex: number, columnId: string | undefined): void {
    if (!columnId) {
      return;
    }

    setFocusRequest({
      key: `cell:${nodeIndex}:${rowIndex}:${columnId}`,
      offset: 0,
      token: Date.now(),
    });
  }

  function focusNodeBoundary(nodeIndex: number, boundary: "start" | "end"): boolean {
    const node = nodes[nodeIndex];
    if (!node) {
      return false;
    }

    if (node.type === "paragraph") {
      setFocusRequest({
        key: `paragraph:${nodeIndex}`,
        offset: boundary === "start" ? 0 : getInlineText(normalizeInlineNodesForEdit(node.children)).length,
        token: Date.now(),
      });
      return true;
    }

    if (node.type === "bulletList" || node.type === "numberedList") {
      const item = boundary === "start" ? node.items[0] : node.items[node.items.length - 1];
      if (!item) {
        return false;
      }

      setFocusRequest({
        key: `listItem:${nodeIndex}:${item.id}`,
        offset: boundary === "start" ? 0 : getInlineText(normalizeInlineNodesForEdit(item.children)).length,
        token: Date.now(),
      });
      return true;
    }

    if (node.type === "table") {
      const columns = node.columns.length > 0 ? node.columns : createDefaultTable().columns;
      const rowIndex = boundary === "start" ? 0 : Math.max(node.rows.length - 1, 0);
      const column = boundary === "start" ? columns[0] : columns[columns.length - 1];
      focusTableCell(nodeIndex, rowIndex, column?.id);
      return Boolean(column);
    }

    if (node.type === "citation" || node.type === "jurisprudence") {
      const sourceNodes = getSourceDisplayNodes(node);
      setFocusRequest({
        key: `source:${nodeIndex}`,
        offset: boundary === "start" ? 0 : getInlineText(normalizeInlineNodesForEdit(sourceNodes)).length,
        token: Date.now(),
      });
      return true;
    }

    return false;
  }

  function focusAdjacentNode(nodeIndex: number, direction: "up" | "down"): boolean {
    if (direction === "up" && nodeIndex <= 0) {
      return onArrowUpBeforeFirst?.() ?? false;
    }

    return focusNodeBoundary(nodeIndex + (direction === "down" ? 1 : -1), direction === "down" ? "start" : "end");
  }

  function isAtInlineBoundary(selection: InlineSelection, nodesValue: InlineNode[], boundary: "start" | "end"): boolean {
    if (selection.start !== selection.end) {
      return false;
    }

    if (boundary === "start") {
      return selection.start === 0;
    }

    return selection.start === getInlineText(normalizeInlineNodesForEdit(nodesValue)).length;
  }

  function handleParagraphArrow(nodeIndex: number, selection: InlineSelection, direction: "up" | "down"): boolean {
    const node = nodes[nodeIndex];
    if (node?.type !== "paragraph") {
      return false;
    }

    if (!isAtInlineBoundary(selection, node.children, direction === "down" ? "end" : "start")) {
      return false;
    }

    return focusAdjacentNode(nodeIndex, direction);
  }

  function focusAfterTable(nodeIndex: number): void {
    const nextNode = nodes[nodeIndex + 1];
    if (!nextNode) {
      const paragraph = createParagraph("", textAlign);
      insertNodeAfterWithFocus(nodeIndex, paragraph);
      return;
    }

    if (nextNode.type === "paragraph") {
      setFocusRequest({
        key: `paragraph:${nodeIndex + 1}`,
        offset: 0,
        token: Date.now(),
      });
    }
  }

  function openRowMenu(event: React.MouseEvent<HTMLElement>, nodeIndex: number): void {
    if (!enableRowContextMenu) {
      return;
    }

    const browserSelection = window.getSelection();
    const hasExpandedSelectionInRow =
      browserSelection &&
      !browserSelection.isCollapsed &&
      ((browserSelection.anchorNode !== null && event.currentTarget.contains(browserSelection.anchorNode)) ||
        (browserSelection.focusNode !== null && event.currentTarget.contains(browserSelection.focusNode)));
    if (hasExpandedSelectionInRow) {
      setRowMenu(null);
      return;
    }

    event.preventDefault();
    setActiveSelection(null);
    setRowMenu({
      x: event.clientX,
      y: event.clientY,
      nodeIndex,
    });
  }

  function closeRowMenu(): void {
    setRowMenu(null);
  }

  function splitParagraphAtSelection(nodeIndex: number, selection: InlineSelection): void {
    const node = nodes[nodeIndex];
    if (node?.type !== "paragraph") {
      return;
    }

    const textLength = getInlineText(normalizeInlineNodesForEdit(node.children)).length;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const before = sliceInlineNodes(node.children, 0, start);
    const after = sliceInlineNodes(node.children, end, textLength);
    const nextNodes = [...nodes];

    nextNodes.splice(
      nodeIndex,
      1,
      {
        ...node,
        children: before,
      },
      createParagraphFromInline(after, node.style?.alignment ?? textAlign, node.style?.fontSizePt),
    );
    onChange(nextNodes);

    setFocusRequest({
      key: `paragraph:${nodeIndex + 1}`,
      offset: 0,
      token: Date.now(),
    });
  }

  function handleParagraphBackspace(nodeIndex: number, selection: InlineSelection): boolean {
    if (selection.start !== selection.end || selection.start !== 0) {
      return false;
    }

    const node = nodes[nodeIndex];
    if (node?.type !== "paragraph") {
      return false;
    }

    const currentLength = getInlineText(normalizeInlineNodesForEdit(node.children)).length;
    const previousNode = nodes[nodeIndex - 1];

    if (currentLength === 0) {
      if (nodes.length <= 1) {
        return true;
      }

      const nextNodes = nodes.filter((_currentNode, index) => index !== nodeIndex);
      onChange(nextNodes.length > 0 ? nextNodes : [createParagraph("", textAlign)]);

      if (previousNode?.type === "paragraph") {
        setFocusRequest({
          key: `paragraph:${nodeIndex - 1}`,
          offset: getInlineText(normalizeInlineNodesForEdit(previousNode.children)).length,
          token: Date.now(),
        });
      } else {
        const nextParagraphIndex = nextNodes.findIndex((currentNode, index) => index >= nodeIndex && currentNode.type === "paragraph");
        if (nextParagraphIndex >= 0) {
          setFocusRequest({
            key: `paragraph:${nextParagraphIndex}`,
            offset: 0,
            token: Date.now(),
          });
        }
      }

      return true;
    }

    if (previousNode?.type !== "paragraph") {
      return false;
    }

    const previousLength = getInlineText(normalizeInlineNodesForEdit(previousNode.children)).length;
    const nextNodes = [...nodes];
    nextNodes.splice(
      nodeIndex - 1,
      2,
      {
        ...previousNode,
        children: compactInlineNodes([...previousNode.children, ...node.children]),
      },
    );
    onChange(nextNodes);
    setFocusRequest({
      key: `paragraph:${nodeIndex - 1}`,
      offset: previousLength,
      token: Date.now(),
    });

    return true;
  }

  return (
    <div className={cn("minuta-native-content-surface", surfaceClassName)} onClick={closeRowMenu}>
      {showPersistentToolbar ? (
        <InlineToolbar
          activeAlignment={getActiveAlignment()}
          activeFontSizePt={getActiveFontSize()}
          canFormatInline={hasActiveTextSelection}
          canInsertTable
          canAlign
          canChangeFontSize={canChangeFontSize}
          canMakeList
          onAlign={applyAlignmentToActive}
          onBold={() => applyMarkToActive("bold")}
          onBulletList={() => convertActiveParagraphToList("bulletList")}
          onClearHighlight={() => applyTokenMarkToActive("highlight", null)}
          onClearTextColor={() => applyTokenMarkToActive("color", null)}
          onFontSizeChange={applyFontSizeToActive}
          onHighlightChange={(token) => applyTokenMarkToActive("highlight", token)}
          onInsertTable={insertTableAtActiveNode}
          onItalic={() => applyMarkToActive("italic")}
          onNumberedList={() => convertActiveParagraphToList("numberedList")}
          onTextColorChange={(token) => applyTokenMarkToActive("color", token)}
          textColorValue={getActiveTokenMark("color") ?? "#151515"}
          highlightColorValue={getActiveTokenMark("highlight") ?? "#fff3a3"}
          onUnderline={() => applyMarkToActive("underline")}
        />
      ) : null}
      <div className={cn("minuta-native-document-flow", documentFlowClassName)}>
        {leadingRows}
        {nodes.map((node, nodeIndex) => {
          if (node.type === "paragraph") {
            return (
              <div
                key={nodeIndex}
                className={cn(
                  enableRowContextMenu && "minuta-native-content-row",
                  "minuta-native-paragraph-row",
                  nodeIndex === baseNodes.length && "minuta-native-trailing-block",
                )}
                onContextMenu={(event) => openRowMenu(event, nodeIndex)}
              >
                <InlineEditor
                  ariaLabel={`Paragrafo ${nodeIndex + 1}`}
                  nodes={node.children}
                  onChange={(children) =>
                    replaceNode(nodeIndex, {
                      ...node,
                      children,
                      style: node.style ?? { alignment: textAlign },
                    })
                  }
                  onFocus={() => setActiveSelection({ target: { type: "paragraph", nodeIndex }, selection: { start: 0, end: 0 } })}
                  onBackspace={(selection) => handleParagraphBackspace(nodeIndex, selection)}
                  onEnter={(selection) => splitParagraphAtSelection(nodeIndex, selection)}
                  onArrowDown={(selection) => handleParagraphArrow(nodeIndex, selection, "down")}
                  onArrowUp={(selection) => handleParagraphArrow(nodeIndex, selection, "up")}
                  focusOffset={
                    focusRequest?.key === `paragraph:${nodeIndex}`
                      ? focusRequest.offset
                      : externalFocusRequest?.key === `paragraph:${nodeIndex}`
                        ? externalFocusRequest.offset
                        : undefined
                  }
                  focusToken={
                    focusRequest?.key === `paragraph:${nodeIndex}`
                      ? focusRequest.token
                      : externalFocusRequest?.key === `paragraph:${nodeIndex}`
                        ? externalFocusRequest.token
                        : undefined
                  }
                  onInsertTable={() => replaceActiveParagraphWithTable(nodeIndex)}
                  onSelectionChange={(selection) => setActiveSelection({ target: { type: "paragraph", nodeIndex }, selection })}
                  showToolbar={false}
                  style={{ fontSize: node.style?.fontSizePt ? `${node.style.fontSizePt}pt` : undefined, textAlign: node.style?.alignment ?? textAlign }}
                  variant="bare"
                />
              </div>
            );
          }

          if (node.type === "bulletList" || node.type === "numberedList") {
            return (
              <div key={nodeIndex} className={cn(enableRowContextMenu && "minuta-native-content-row")} onContextMenu={(event) => openRowMenu(event, nodeIndex)}>
                <ListNodeEditor
                  node={node}
                  externalFocusRequest={
                    focusRequest?.key.startsWith(`listItem:${nodeIndex}:`)
                      ? {
                          ...focusRequest,
                          key: focusRequest.key.replace(`listItem:${nodeIndex}:`, "listItem:"),
                        }
                      : null
                  }
                  onChange={(nextNode) => replaceNode(nodeIndex, nextNode)}
                  onConvertEmptyItemToParagraph={(itemIndex) => convertEmptyListItemToParagraph(nodeIndex, itemIndex)}
                  onArrowDownPastList={() => focusAdjacentNode(nodeIndex, "down")}
                  onArrowUpPastList={() => focusAdjacentNode(nodeIndex, "up")}
                  onItemFocus={(itemId) => setActiveSelection({ target: { type: "listItem", nodeIndex, itemId }, selection: { start: 0, end: 0 } })}
                  onItemSelectionChange={(itemId, selection) => setActiveSelection({ target: { type: "listItem", nodeIndex, itemId }, selection })}
                />
              </div>
            );
          }

          if (node.type === "table") {
            return (
              <div
                key={nodeIndex}
                className={cn(enableRowContextMenu && "minuta-native-content-row", "minuta-native-table-row")}
                onContextMenu={(event) => openRowMenu(event, nodeIndex)}
              >
                <SchemaTableEditor
                  node={node}
                  externalFocusRequest={
                    focusRequest?.key.startsWith(`cell:${nodeIndex}:`)
                      ? {
                          ...focusRequest,
                          key: focusRequest.key.replace(`cell:${nodeIndex}:`, "cell:"),
                        }
                      : null
                  }
                  onChange={(nextNode) => replaceNode(nodeIndex, nextNode)}
                  onArrowDownPastTable={() => focusAdjacentNode(nodeIndex, "down")}
                  onArrowUpPastTable={() => focusAdjacentNode(nodeIndex, "up")}
                  onDelete={() => deleteNode(nodeIndex)}
                  onExitTable={() => focusAfterTable(nodeIndex)}
                  textAlign={textAlign}
                />
              </div>
            );
          }

          if (node.type === "citation" || node.type === "jurisprudence") {
            return (
              <div
                key={nodeIndex}
                className={cn(enableRowContextMenu && "minuta-native-content-row", "minuta-native-source-row")}
                onContextMenu={(event) => openRowMenu(event, nodeIndex)}
              >
                <InlineEditor
                  ariaLabel={node.type === "citation" ? "Texto da citacao" : "Texto da jurisprudencia"}
                  focusOffset={focusRequest?.key === `source:${nodeIndex}` ? focusRequest.offset : undefined}
                  focusToken={focusRequest?.key === `source:${nodeIndex}` ? focusRequest.token : undefined}
                  nodes={getSourceDisplayNodes(node)}
                  onChange={(customText) => replaceNode(nodeIndex, setSourceDisplayText(node, customText))}
                  onArrowDown={(selection) =>
                    isInlineSelectionAtBoundary(selection, getSourceDisplayNodes(node), "end") ? focusAdjacentNode(nodeIndex, "down") : false
                  }
                  onArrowUp={(selection) =>
                    isInlineSelectionAtBoundary(selection, getSourceDisplayNodes(node), "start") ? focusAdjacentNode(nodeIndex, "up") : false
                  }
                  placeholder="Texto da fonte juridica"
                  showToolbar={false}
                  style={{ textAlign }}
                  variant="bare"
                />
              </div>
            );
          }

          return (
            <div key={nodeIndex} className="rounded-md border bg-muted/35 p-3 text-sm text-muted-foreground">
              Este no estruturado ainda precisa de um editor proprio.
            </div>
          );
        })}
      </div>
      {enableRowContextMenu && rowMenu ? (
        <ContentRowContextMenu
          menu={rowMenu}
          node={nodes[rowMenu.nodeIndex]}
          onBulletList={() => {
            const node = nodes[rowMenu.nodeIndex];
            if (node?.type === "paragraph") {
              convertParagraphToList(rowMenu.nodeIndex, "bulletList");
            } else if (node?.type === "numberedList") {
              convertListToList(rowMenu.nodeIndex, "bulletList");
            }
            closeRowMenu();
          }}
          onDeleteTable={() => {
            deleteNode(rowMenu.nodeIndex);
            closeRowMenu();
          }}
          onNumberedList={() => {
            const node = nodes[rowMenu.nodeIndex];
            if (node?.type === "paragraph") {
              convertParagraphToList(rowMenu.nodeIndex, "numberedList");
            } else if (node?.type === "bulletList") {
              convertListToList(rowMenu.nodeIndex, "numberedList");
            }
            closeRowMenu();
          }}
          onTable={() => {
            applyTableActionToRow(rowMenu.nodeIndex);
            closeRowMenu();
          }}
          onText={() => {
            convertListToParagraphs(rowMenu.nodeIndex);
            closeRowMenu();
          }}
        />
      ) : null}
    </div>
  );
}

function ContentRowContextMenu({
  menu,
  node,
  onBulletList,
  onDeleteTable,
  onNumberedList,
  onTable,
  onText,
}: {
  menu: ContentRowMenuState;
  node: ContentNode | undefined;
  onBulletList: () => void;
  onDeleteTable: () => void;
  onNumberedList: () => void;
  onTable: () => void;
  onText: () => void;
}): JSX.Element | null {
  if (!node) {
    return null;
  }

  if (node.type === "paragraph") {
    return (
      <div className="minuta-content-row-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
        <MenuButton onClick={onBulletList}>Lista com marcadores</MenuButton>
        <MenuButton onClick={onNumberedList}>Lista numerada</MenuButton>
        <MenuButton onClick={onTable}>Tabela</MenuButton>
      </div>
    );
  }

  if (node.type === "bulletList") {
    return (
      <div className="minuta-content-row-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
        <MenuButton onClick={onText}>Texto</MenuButton>
        <MenuButton onClick={onNumberedList}>Lista numerada</MenuButton>
        <MenuButton onClick={onTable}>Tabela</MenuButton>
      </div>
    );
  }

  if (node.type === "numberedList") {
    return (
      <div className="minuta-content-row-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
        <MenuButton onClick={onText}>Texto</MenuButton>
        <MenuButton onClick={onBulletList}>Lista com marcadores</MenuButton>
        <MenuButton onClick={onTable}>Tabela</MenuButton>
      </div>
    );
  }

  if (node.type === "table") {
    return (
      <div className="minuta-content-row-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
        <MenuButton onClick={onTable}>Adicionar tabela abaixo</MenuButton>
        <MenuButton onClick={onDeleteTable}>Remover tabela</MenuButton>
      </div>
    );
  }

  return null;
}

function ListNodeEditor({
  externalFocusRequest,
  node,
  onChange,
  onArrowDownPastList,
  onArrowUpPastList,
  onConvertEmptyItemToParagraph,
  onItemFocus,
  onItemSelectionChange,
}: {
  externalFocusRequest?: InlineFocusRequest | null;
  node: Extract<ContentNode, { type: "bulletList" | "numberedList" }>;
  onChange: (node: Extract<ContentNode, { type: "bulletList" | "numberedList" }>) => void;
  onArrowDownPastList: () => boolean;
  onArrowUpPastList: () => boolean;
  onConvertEmptyItemToParagraph: (itemIndex: number) => void;
  onItemFocus: (itemId: string) => void;
  onItemSelectionChange: (itemId: string, selection: InlineSelection) => void;
}): JSX.Element {
  const ListTag = node.type === "bulletList" ? "ul" : "ol";
  const [focusRequest, setFocusRequest] = useState<InlineFocusRequest | null>(null);

  function updateItem(itemId: string, children: InlineNode[]): void {
    onChange({
      ...node,
      items: node.items.map((item) => (item.id === itemId ? { ...item, children } : item)),
    });
  }

  function addItemAfter(itemIndex: number): void {
    const nextItem = createListItem();
    const nextItems = [...node.items];
    nextItems.splice(itemIndex + 1, 0, nextItem);
    onChange({ ...node, items: nextItems });
    setFocusRequest({
      key: `listItem:${nextItem.id}`,
      offset: 0,
      token: Date.now(),
    });
  }

  function removeItem(itemIndex: number): void {
    const nextItems = node.items.filter((_item, index) => index !== itemIndex);
    onChange({ ...node, items: nextItems.length > 0 ? nextItems : [createListItem()] });
  }

  function splitItemAtSelection(itemIndex: number, selection: InlineSelection): void {
    const item = node.items[itemIndex];
    if (!item) {
      return;
    }

    const textLength = getInlineText(normalizeInlineNodesForEdit(item.children)).length;
    if (textLength === 0) {
      onConvertEmptyItemToParagraph(itemIndex);
      return;
    }

    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const nextItem = createListItem(sliceInlineNodes(item.children, end, textLength));
    const nextItems = [...node.items];

    nextItems.splice(
      itemIndex,
      1,
      {
        ...item,
        children: sliceInlineNodes(item.children, 0, start),
      },
      nextItem,
    );
    onChange({ ...node, items: nextItems });
    setFocusRequest({
      key: `listItem:${nextItem.id}`,
      offset: 0,
      token: Date.now(),
    });
  }

  function handleItemBackspace(itemIndex: number, selection: InlineSelection): boolean {
    if (selection.start !== selection.end || selection.start !== 0) {
      return false;
    }

    const item = node.items[itemIndex];
    if (!item) {
      return false;
    }

    const currentLength = getInlineText(normalizeInlineNodesForEdit(item.children)).length;
    const previousItem = node.items[itemIndex - 1];

    if (currentLength === 0) {
      onConvertEmptyItemToParagraph(itemIndex);
      return true;
    }

    if (!previousItem) {
      return false;
    }

    const previousLength = getInlineText(normalizeInlineNodesForEdit(previousItem.children)).length;
    const nextItems = [...node.items];
    nextItems.splice(itemIndex - 1, 2, {
      ...previousItem,
      children: compactInlineNodes([...previousItem.children, ...item.children]),
    });
    onChange({ ...node, items: nextItems });
    setFocusRequest({
      key: `listItem:${previousItem.id}`,
      offset: previousLength,
      token: Date.now(),
    });

    return true;
  }

  function focusItem(itemIndex: number, boundary: "start" | "end"): boolean {
    const item = node.items[itemIndex];
    if (!item) {
      return false;
    }

    setFocusRequest({
      key: `listItem:${item.id}`,
      offset: boundary === "start" ? 0 : getInlineText(normalizeInlineNodesForEdit(item.children)).length,
      token: Date.now(),
    });
    return true;
  }

  function handleItemArrow(itemIndex: number, selection: InlineSelection, direction: "up" | "down"): boolean {
    const item = node.items[itemIndex];
    if (!item || !isInlineSelectionAtBoundary(selection, item.children, direction === "down" ? "end" : "start")) {
      return false;
    }

    if (direction === "down") {
      return focusItem(itemIndex + 1, "start") || onArrowDownPastList();
    }

    return focusItem(itemIndex - 1, "end") || onArrowUpPastList();
  }

  return (
    <ListTag className={cn("minuta-native-list", node.type === "bulletList" ? "list-disc" : "list-decimal")}>
      {node.items.map((item, itemIndex) => (
        <li key={item.id}>
          <div className="minuta-native-list-item">
            <div className="min-w-0 flex-1">
              <InlineEditor
                ariaLabel={`Item ${itemIndex + 1}`}
                nodes={item.children}
                onChange={(children) => updateItem(item.id, children)}
                onBackspace={(selection) => handleItemBackspace(itemIndex, selection)}
                focusOffset={
                  focusRequest?.key === `listItem:${item.id}`
                    ? focusRequest.offset
                    : externalFocusRequest?.key === `listItem:${item.id}`
                      ? externalFocusRequest.offset
                      : undefined
                }
                focusToken={
                  focusRequest?.key === `listItem:${item.id}`
                    ? focusRequest.token
                    : externalFocusRequest?.key === `listItem:${item.id}`
                      ? externalFocusRequest.token
                      : undefined
                }
                onArrowDown={(selection) => handleItemArrow(itemIndex, selection, "down")}
                onArrowUp={(selection) => handleItemArrow(itemIndex, selection, "up")}
                onEnter={(selection) => splitItemAtSelection(itemIndex, selection)}
                onFocus={() => onItemFocus(item.id)}
                onSelectionChange={(selection) => onItemSelectionChange(item.id, selection)}
                showToolbar={false}
                variant="bare"
              />
            </div>
            <div className="minuta-native-list-actions">
              <Button aria-label="Adicionar item" onClick={() => addItemAfter(itemIndex)} size="icon" type="button" variant="ghost">
                <Plus />
              </Button>
              <Button aria-label="Remover item" onClick={() => removeItem(itemIndex)} size="icon" type="button" variant="ghost">
                <Trash2 />
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ListTag>
  );
}

function RequestListEditor({
  markerStyle,
  onChange,
  onItemFocus,
  onItemSelectionChange,
  requests,
}: {
  markerStyle: "bullet" | "decimal";
  onChange: (requests: LegalRequest[]) => void;
  onItemFocus: (requestId: string) => void;
  onItemSelectionChange: (requestId: string, selection: InlineSelection) => void;
  requests: LegalRequest[];
}): JSX.Element {
  const [focusRequest, setFocusRequest] = useState<InlineFocusRequest | null>(null);
  const items = useMemo(() => (requests.length > 0 ? requests : [createRequestFromInline()]), [requests]);

  function updateItem(requestId: string, text: InlineNode[]): void {
    onChange(items.map((request) => (request.id === requestId ? { ...request, text } : request)));
  }

  function focusRequestItem(requestId: string, offset = 0): void {
    setFocusRequest({
      key: `request:${requestId}`,
      offset,
      token: Date.now(),
    });
  }

  function addItemAfter(itemIndex: number): void {
    const sourceRequest = items[itemIndex];
    const nextRequest = createRequestFromInline(undefined, sourceRequest);
    const nextItems = [...items];
    nextItems.splice(itemIndex + 1, 0, nextRequest);
    onChange(nextItems);
    focusRequestItem(nextRequest.id);
  }

  function removeItem(itemIndex: number): void {
    if (items.length <= 1) {
      onChange([{ ...items[0], text: [{ type: "text", text: "" }] }]);
      focusRequestItem(items[0]?.id ?? "");
      return;
    }

    const nextItems = items.filter((_item, index) => index !== itemIndex);
    onChange(nextItems);
    const focusTarget = nextItems[Math.min(itemIndex, nextItems.length - 1)];
    if (focusTarget) {
      focusRequestItem(focusTarget.id, getInlineText(normalizeInlineNodesForEdit(focusTarget.text)).length);
    }
  }

  function splitItemAtSelection(itemIndex: number, selection: InlineSelection): void {
    const item = items[itemIndex];
    if (!item) {
      return;
    }

    const textLength = getInlineText(normalizeInlineNodesForEdit(item.text)).length;
    if (textLength === 0) {
      addItemAfter(itemIndex);
      return;
    }

    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const nextRequest = createRequestFromInline(sliceInlineNodes(item.text, end, textLength), item);
    const nextItems = [...items];
    nextItems.splice(
      itemIndex,
      1,
      {
        ...item,
        text: sliceInlineNodes(item.text, 0, start),
      },
      nextRequest,
    );
    onChange(nextItems);
    focusRequestItem(nextRequest.id);
  }

  function handleItemBackspace(itemIndex: number, selection: InlineSelection): boolean {
    if (selection.start !== selection.end || selection.start !== 0) {
      return false;
    }

    const item = items[itemIndex];
    if (!item) {
      return false;
    }

    const currentLength = getInlineText(normalizeInlineNodesForEdit(item.text)).length;
    const previousItem = items[itemIndex - 1];

    if (currentLength === 0) {
      removeItem(itemIndex);
      return true;
    }

    if (!previousItem) {
      return false;
    }

    const previousLength = getInlineText(normalizeInlineNodesForEdit(previousItem.text)).length;
    const nextItems = [...items];
    nextItems.splice(itemIndex - 1, 2, {
      ...previousItem,
      text: compactInlineNodes([...previousItem.text, ...item.text]),
    });
    onChange(nextItems);
    focusRequestItem(previousItem.id, previousLength);

    return true;
  }

  function focusItem(itemIndex: number, boundary: "start" | "end"): boolean {
    const item = items[itemIndex];
    if (!item) {
      return false;
    }

    focusRequestItem(item.id, boundary === "start" ? 0 : getInlineText(normalizeInlineNodesForEdit(item.text)).length);
    return true;
  }

  function handleItemArrow(itemIndex: number, selection: InlineSelection, direction: "up" | "down"): boolean {
    const item = items[itemIndex];
    if (!item || !isInlineSelectionAtBoundary(selection, item.text, direction === "down" ? "end" : "start")) {
      return false;
    }

    return direction === "down" ? focusItem(itemIndex + 1, "start") : focusItem(itemIndex - 1, "end");
  }

  return (
    <ol className={cn("minuta-native-list minuta-request-edit-list", markerStyle === "bullet" ? "list-disc" : "list-decimal")}>
      {items.map((request, requestIndex) => (
        <li key={request.id}>
          <div className="minuta-native-list-item minuta-request-edit-row">
            <div className="min-w-0 flex-1">
              <InlineEditor
                ariaLabel={`Pedido ${requestIndex + 1}`}
                focusOffset={focusRequest?.key === `request:${request.id}` ? focusRequest.offset : undefined}
                focusToken={focusRequest?.key === `request:${request.id}` ? focusRequest.token : undefined}
                nodes={request.text}
                onArrowDown={(selection) => handleItemArrow(requestIndex, selection, "down")}
                onArrowUp={(selection) => handleItemArrow(requestIndex, selection, "up")}
                onBackspace={(selection) => handleItemBackspace(requestIndex, selection)}
                onChange={(nodes) => updateItem(request.id, nodes)}
                onEnter={(selection) => splitItemAtSelection(requestIndex, selection)}
                onFocus={() => onItemFocus(request.id)}
                onSelectionChange={(selection) => onItemSelectionChange(request.id, selection)}
                showToolbar={false}
                style={{
                  fontSize: request.style?.fontSizePt ? `${request.style.fontSizePt}pt` : undefined,
                  textAlign: request.style?.alignment ?? "justify",
                }}
                variant="bare"
              />
            </div>
            <div className="minuta-native-list-actions">
              <Button aria-label="Adicionar pedido" onClick={() => addItemAfter(requestIndex)} size="icon" type="button" variant="ghost">
                <Plus />
              </Button>
              <Button aria-label="Remover pedido" onClick={() => removeItem(requestIndex)} size="icon" type="button" variant="ghost">
                <Trash2 />
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SchemaTableEditor({
  externalFocusRequest,
  node,
  onChange,
  onArrowDownPastTable,
  onArrowUpPastTable,
  onDelete,
  onExitTable,
  textAlign,
}: {
  externalFocusRequest?: InlineFocusRequest | null;
  node: Extract<ContentNode, { type: "table" }>;
  onChange: (node: Extract<ContentNode, { type: "table" }>) => void;
  onArrowDownPastTable: () => boolean;
  onArrowUpPastTable: () => boolean;
  onDelete: () => void;
  onExitTable: () => void;
  textAlign: TextAlignment;
}): JSX.Element {
  const [selection, setSelection] = useState<TableSelection | null>(null);
  const [menu, setMenu] = useState<TableMenuState | null>(null);
  const [cellFocusRequest, setCellFocusRequest] = useState<InlineFocusRequest | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const resizeStateRef = useRef<ColumnResizeState | null>(null);
  const columns = node.columns.length > 0 ? node.columns : createDefaultTable().columns;
  const columnWidths = normalizeColumnWidths(columns);
  const rows = node.rows;

  function updateTable(update: (draft: Extract<ContentNode, { type: "table" }>) => void): void {
    const draft = structuredClone({ ...node, columns, rows }) as Extract<ContentNode, { type: "table" }>;
    update(draft);
    onChange(draft);
  }

  function addRow(targetIndex: number): void {
    updateTable((draft) => {
      draft.rows.splice(targetIndex, 0, {
        id: createId(),
        cells: draft.columns.map((column) => ({
          columnId: column.id,
          children: [createParagraph("", textAlign)],
        })),
      });
    });
  }

  function removeRow(rowIndex: number): void {
    updateTable((draft) => {
      draft.rows = draft.rows.filter((_row, index) => index !== rowIndex);
      if (draft.rows.length === 0) {
        draft.rows.push({
          id: createId(),
          cells: draft.columns.map((column) => ({
            columnId: column.id,
            children: [createParagraph("", textAlign)],
          })),
        });
      }
    });
  }

  function addColumn(targetIndex: number): void {
    updateTable((draft) => {
      const nextColumnWidth = 100 / (draft.columns.length + 1);
      const currentWidths = normalizeColumnWidths(draft.columns).map((width) => width * ((100 - nextColumnWidth) / 100));
      const column = {
        id: createId(),
        header: [{ type: "text" as const, text: `Coluna ${targetIndex + 1}` }],
        width: {
          value: Number(nextColumnWidth.toFixed(2)),
          unit: "percent" as const,
        },
      };
      draft.columns = draft.columns.map((currentColumn, index) => ({
        ...currentColumn,
        width: {
          value: Number(currentWidths[index]?.toFixed(2) ?? 0),
          unit: "percent",
        },
      }));
      draft.columns.splice(targetIndex, 0, column);
      for (const row of draft.rows) {
        row.cells.splice(targetIndex, 0, {
          columnId: column.id,
          children: [createParagraph("", textAlign)],
        });
      }
      normalizeDraftColumnWidths(draft);
    });
  }

  function removeColumn(columnId: string): void {
    updateTable((draft) => {
      if (draft.columns.length <= 1) {
        return;
      }

      draft.columns = draft.columns.filter((column) => column.id !== columnId);
      draft.rows = draft.rows.map((row) => ({
        ...row,
        cells: row.cells.filter((cell) => cell.columnId !== columnId),
      }));
      normalizeDraftColumnWidths(draft);
    });
  }

  function updateColumnWidths(widths: number[]): void {
    updateTable((draft) => {
      draft.columns = draft.columns.map((column, index) => ({
        ...column,
        width: {
          value: Number(widths[index]?.toFixed(2) ?? 0),
          unit: "percent",
        },
      }));
      normalizeDraftColumnWidths(draft);
    });
  }

  function normalizeDraftColumnWidths(draft: Extract<ContentNode, { type: "table" }>): void {
    const widths = normalizeColumnWidths(draft.columns);
    draft.columns = draft.columns.map((column, index) => ({
      ...column,
      width: {
        value: Number(widths[index]?.toFixed(2) ?? 0),
        unit: "percent",
      },
    }));
  }

  function handleColumnResizeStart(event: React.PointerEvent<HTMLButtonElement>, leftIndex: number): void {
    const tableWidthPx = tableRef.current?.getBoundingClientRect().width ?? 0;
    if (tableWidthPx <= 0 || leftIndex >= columns.length - 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      startX: event.clientX,
      leftIndex,
      startWidths: columnWidths,
      tableWidthPx,
    };
  }

  function handleColumnResizeMove(event: React.PointerEvent<HTMLButtonElement>): void {
    const resizeState = resizeStateRef.current;
    if (!resizeState) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rightIndex = resizeState.leftIndex + 1;
    const pairTotal = resizeState.startWidths[resizeState.leftIndex] + resizeState.startWidths[rightIndex];
    const deltaPercent = ((event.clientX - resizeState.startX) / resizeState.tableWidthPx) * 100;
    const nextLeft = clampColumnWidth(resizeState.startWidths[resizeState.leftIndex] + deltaPercent);
    const nextRight = clampColumnWidth(pairTotal - nextLeft);

    if (nextLeft + nextRight !== pairTotal) {
      return;
    }

    const nextWidths = [...resizeState.startWidths];
    nextWidths[resizeState.leftIndex] = nextLeft;
    nextWidths[rightIndex] = nextRight;
    updateColumnWidths(nextWidths);
  }

  function handleColumnResizeEnd(event: React.PointerEvent<HTMLButtonElement>): void {
    if (resizeStateRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }

    resizeStateRef.current = null;
  }

  function updateHeader(columnId: string, header: InlineNode[]): void {
    updateTable((draft) => {
      const column = draft.columns.find((currentColumn) => currentColumn.id === columnId);
      if (column) {
        column.header = header;
      }
    });
  }

  function updateCell(rowIndex: number, columnId: string, children: InlineNode[]): void {
    updateTable((draft) => {
      const row = draft.rows[rowIndex];
      if (!row) {
        return;
      }

      let cell = row.cells.find((currentCell) => currentCell.columnId === columnId);
      if (!cell) {
        cell = {
          columnId,
          children: [createParagraph("", textAlign)],
        };
        row.cells.push(cell);
      }

      cell.children = [createParagraphFromInline(children, textAlign)];
    });
  }

  function handleCellEnter(rowIndex: number, columnIndex: number): void {
    const nextColumn = columns[columnIndex + 1];
    if (nextColumn) {
      setCellFocusRequest({
        key: `cell:${rowIndex}:${nextColumn.id}`,
        offset: 0,
        token: Date.now(),
      });
      return;
    }

    const firstColumn = columns[0];
    if (firstColumn && rows[rowIndex + 1]) {
      setCellFocusRequest({
        key: `cell:${rowIndex + 1}:${firstColumn.id}`,
        offset: 0,
        token: Date.now(),
      });
      return;
    }

    onExitTable();
  }

  function handleCellArrow(rowIndex: number, columnId: string, children: InlineNode[], selection: InlineSelection, direction: "up" | "down"): boolean {
    if (!isInlineSelectionAtBoundary(selection, children, direction === "down" ? "end" : "start")) {
      return false;
    }

    if (direction === "down" && rows[rowIndex + 1]) {
      setCellFocusRequest({
        key: `cell:${rowIndex + 1}:${columnId}`,
        offset: 0,
        token: Date.now(),
      });
      return true;
    }

    if (direction === "up" && rows[rowIndex - 1]) {
      const previousCell = rows[rowIndex - 1]?.cells.find((cell) => cell.columnId === columnId);
      setCellFocusRequest({
        key: `cell:${rowIndex - 1}:${columnId}`,
        offset: getInlineText(normalizeInlineNodesForEdit(getFirstCellInlineNodes(previousCell?.children))).length,
        token: Date.now(),
      });
      return true;
    }

    return direction === "down" ? onArrowDownPastTable() : onArrowUpPastTable();
  }

  function getSelectionCell(selectionValue: TableSelection): { rowIndex: number; columnId: string } {
    if (selectionValue.type === "cell") {
      return selectionValue;
    }

    if (selectionValue.type === "row") {
      return {
        rowIndex: selectionValue.rowIndex,
        columnId: columns[0]?.id ?? "",
      };
    }

    return {
      rowIndex: 0,
      columnId: selectionValue.columnId,
    };
  }

  function openMenu(event: React.MouseEvent, nextSelection: TableSelection): void {
    event.preventDefault();
    event.stopPropagation();
    setSelection(nextSelection);
    setMenu({
      x: event.clientX,
      y: event.clientY,
      selection: nextSelection,
    });
  }

  function closeMenu(): void {
    setMenu(null);
  }

  function isColumnSelected(columnId: string): boolean {
    return selection?.type === "column" && selection.columnId === columnId;
  }

  function isRowSelected(rowIndex: number): boolean {
    return selection?.type === "row" && selection.rowIndex === rowIndex;
  }

  function isCellSelected(rowIndex: number, columnId: string): boolean {
    return selection?.type === "cell" && selection.rowIndex === rowIndex && selection.columnId === columnId;
  }

  const headerActionLabel = node.showHeader ? "Ocultar cabecalho" : "Mostrar cabecalho";

  return (
    <div className="group/table minuta-native-table-editor" onMouseLeave={closeMenu}>
      <div className="minuta-table-inline-actions">
        <Button
          aria-label={headerActionLabel}
          className="size-8"
          onClick={() => updateTable((draft) => {
            draft.showHeader = !draft.showHeader;
          })}
          size="icon"
          title={headerActionLabel}
          type="button"
          variant="ghost"
        >
          <TableIcon />
        </Button>
        <Button
          aria-label="Remover tabela"
          className="size-8 text-destructive"
          onClick={onDelete}
          size="icon"
          title="Remover tabela"
          type="button"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </div>
      <div className="minuta-table-right-rail">
        <button aria-label="Adicionar coluna" onClick={() => addColumn(columns.length)} type="button">
          +
        </button>
      </div>
      <div className="minuta-table-bottom-rail">
        <button aria-label="Adicionar linha" onClick={() => addRow(rows.length)} type="button">
          +
        </button>
      </div>
      <div className="minuta-scrollbar overflow-x-auto">
        <div className="minuta-native-table-shell">
          <table ref={tableRef} className="minuta-native-table">
            <colgroup>
              {columns.map((column, columnIndex) => (
                <col key={column.id} style={{ width: `${columnWidths[columnIndex] ?? 100 / columns.length}%` }} />
              ))}
            </colgroup>
            {node.showHeader ? (
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      className={cn(isColumnSelected(column.id) && "is-selected")}
                      onClick={() => setSelection({ type: "column", columnId: column.id })}
                      onContextMenu={(event) => openMenu(event, { type: "column", columnId: column.id })}
                    >
                      <InlineEditor
                        ariaLabel="Cabecalho da coluna"
                        nodes={column.header ?? [{ type: "text", text: "" }]}
                        onChange={(header) => updateHeader(column.id, header)}
                        showToolbar={false}
                        singleLine
                        variant="bare"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row.id}>
                  {columns.map((column, columnIndex) => {
                    const cell = row.cells.find((currentCell) => currentCell.columnId === column.id);
                    const inlineNodes = getFirstCellInlineNodes(cell?.children);
                    const cellFocusKey = `cell:${rowIndex}:${column.id}`;
                    return (
                      <td
                        key={column.id}
                        className={cn((isCellSelected(rowIndex, column.id) || isColumnSelected(column.id) || isRowSelected(rowIndex)) && "is-selected")}
                        onClick={() => setSelection({ type: "cell", rowIndex, columnId: column.id })}
                        onContextMenu={(event) => openMenu(event, { type: "cell", rowIndex, columnId: column.id })}
                      >
                        <InlineEditor
                          ariaLabel={`Celula ${rowIndex + 1}`}
                          nodes={inlineNodes}
                          onChange={(children) => updateCell(rowIndex, column.id, children)}
                          onEnter={() => handleCellEnter(rowIndex, columnIndex)}
                          focusOffset={
                            cellFocusRequest?.key === cellFocusKey
                              ? cellFocusRequest.offset
                              : externalFocusRequest?.key === cellFocusKey
                                ? externalFocusRequest.offset
                                : undefined
                          }
                          focusToken={
                            cellFocusRequest?.key === cellFocusKey
                              ? cellFocusRequest.token
                              : externalFocusRequest?.key === cellFocusKey
                                ? externalFocusRequest.token
                                : undefined
                          }
                          onArrowDown={(selection) => handleCellArrow(rowIndex, column.id, inlineNodes, selection, "down")}
                          onArrowUp={(selection) => handleCellArrow(rowIndex, column.id, inlineNodes, selection, "up")}
                          placeholder=" "
                          showToolbar={false}
                          variant="bare"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {columns.slice(0, -1).map((column, columnIndex) => (
            <button
              key={`resize-${column.id}`}
              aria-label={`Redimensionar coluna ${columnIndex + 1}`}
              className="minuta-column-resize-handle"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => handleColumnResizeStart(event, columnIndex)}
              onPointerMove={handleColumnResizeMove}
              onPointerUp={handleColumnResizeEnd}
              onPointerCancel={handleColumnResizeEnd}
              style={{ left: `${getColumnBoundaryOffset(columnWidths, columnIndex)}%` }}
              type="button"
            />
          ))}
        </div>
      </div>
      {menu ? (
        <TableContextMenu
          menu={menu}
          onAddColumnLeft={() => {
            const cell = getSelectionCell(menu.selection);
            addColumn(Math.max(columns.findIndex((column) => column.id === cell.columnId), 0));
            closeMenu();
          }}
          onAddColumnRight={() => {
            const cell = getSelectionCell(menu.selection);
            addColumn(Math.max(columns.findIndex((column) => column.id === cell.columnId), 0) + 1);
            closeMenu();
          }}
          onAddRowAbove={() => {
            addRow(getSelectionCell(menu.selection).rowIndex);
            closeMenu();
          }}
          onAddRowBelow={() => {
            addRow(getSelectionCell(menu.selection).rowIndex + 1);
            closeMenu();
          }}
          onRemoveColumn={() => {
            removeColumn(getSelectionCell(menu.selection).columnId);
            closeMenu();
          }}
          onRemoveRow={() => {
            removeRow(getSelectionCell(menu.selection).rowIndex);
            closeMenu();
          }}
          onToggleHeader={() => {
            updateTable((draft) => {
              draft.showHeader = !draft.showHeader;
            });
            closeMenu();
          }}
        />
      ) : null}
    </div>
  );
}

function TableContextMenu({
  menu,
  onAddColumnLeft,
  onAddColumnRight,
  onAddRowAbove,
  onAddRowBelow,
  onRemoveColumn,
  onRemoveRow,
  onToggleHeader,
}: {
  menu: TableMenuState;
  onAddColumnLeft: () => void;
  onAddColumnRight: () => void;
  onAddRowAbove: () => void;
  onAddRowBelow: () => void;
  onRemoveColumn: () => void;
  onRemoveRow: () => void;
  onToggleHeader: () => void;
}): JSX.Element {
  return (
    <div className="fixed z-50 w-64 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg" style={{ left: menu.x, top: menu.y }}>
      <MenuButton onClick={onAddRowAbove}>Adicionar linha acima</MenuButton>
      <MenuButton onClick={onAddRowBelow}>Adicionar linha abaixo</MenuButton>
      <MenuButton onClick={onRemoveRow}>Remover linha</MenuButton>
      <MenuButton onClick={onAddColumnLeft}>Adicionar coluna a esquerda</MenuButton>
      <MenuButton onClick={onAddColumnRight}>Adicionar coluna a direita</MenuButton>
      <MenuButton onClick={onRemoveColumn}>Remover coluna</MenuButton>
      <MenuButton onClick={onToggleHeader}>Alternar cabecalho</MenuButton>
    </div>
  );
}

function MenuButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }): JSX.Element {
  return (
    <button className="flex w-full items-center rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground" onClick={onClick} type="button">
      {children}
    </button>
  );
}

function SignatureLineEditor({
  line,
  onChange,
  onNameFocus,
  onNameSelectionChange,
  onOabFocus,
  onOabSelectionChange,
  styleTemplate,
}: {
  line: SignatureLineNode;
  onChange: (update: (line: SignatureLineNode) => void) => void;
  onNameFocus: () => void;
  onNameSelectionChange: (selection: InlineSelection) => void;
  onOabFocus: () => void;
  onOabSelectionChange: (selection: InlineSelection) => void;
  styleTemplate: DocumentStyleTemplate;
}): JSX.Element {
  return (
    <div className="minuta-signature-line-editor" style={getSignatureLineEditStyle(styleTemplate)}>
      <InlineEditor
        ariaLabel="Nome do advogado"
        nodes={line.name}
        onChange={(nodes) => onChange((draftLine) => {
          draftLine.name = nodes;
        })}
        onFocus={onNameFocus}
        onSelectionChange={onNameSelectionChange}
        showToolbar={false}
        singleLine
        style={{ textAlign: "center" }}
        variant="bare"
      />
      <InlineEditor
        ariaLabel="OAB"
        nodes={line.oabText ?? [{ type: "text", text: "" }]}
        onChange={(nodes) => onChange((draftLine) => {
          draftLine.oabText = nodes;
        })}
        onFocus={onOabFocus}
        onSelectionChange={onOabSelectionChange}
        showToolbar={false}
        singleLine
        style={{ textAlign: "center" }}
        variant="bare"
      />
      {line.roleLabel ? (
        <input
          aria-label="Funcao"
          className="minuta-signature-role-input"
          onChange={(event) => onChange((draftLine) => {
            draftLine.roleLabel = event.target.value.trim() || undefined;
          })}
          value={line.roleLabel}
        />
      ) : null}
    </div>
  );
}

function getSourceDisplayNodes(node: SourceContentNode): InlineNode[] {
  if (node.displayMode === "custom" && node.customText) {
    return node.customText;
  }

  if (node.type === "citation") {
    if (node.displayMode === "short" && node.snapshot.label) {
      return [{ type: "text", text: node.snapshot.label }];
    }

    return node.snapshot.text;
  }

  if (node.displayMode === "quote" && node.snapshot.quote) {
    return node.snapshot.quote;
  }

  if ((node.displayMode === "summary" || node.displayMode === "full") && node.snapshot.summary) {
    return node.snapshot.summary;
  }

  if (node.snapshot.quote) {
    return node.snapshot.quote;
  }

  return [{ type: "text", text: node.snapshot.label ?? node.snapshot.caseNumber ?? "" }];
}

function setSourceDisplayText(node: SourceContentNode, customText: InlineNode[]): SourceContentNode {
  return {
    ...node,
    displayMode: "custom",
    customText,
  } as SourceContentNode;
}

function getSpecialInlineNodes(block: LegalDocumentBlock, target: SpecialInlineTarget): InlineNode[] {
  if (target.type === "requestTitle") {
    return block.type === "request_list" ? block.title ?? [{ type: "text", text: "" }] : [{ type: "text", text: "" }];
  }

  if (target.type === "requestItem") {
    if (block.type !== "request_list") {
      return [{ type: "text", text: "" }];
    }

    return block.requests.find((request) => request.id === target.requestId)?.text ?? [{ type: "text", text: "" }];
  }

  if (target.type === "signatureTitle") {
    return block.type === "signature" ? block.title ?? [{ type: "text", text: "" }] : [{ type: "text", text: "" }];
  }

  if (target.type === "signatureName") {
    if (block.type !== "signature") {
      return [{ type: "text", text: "" }];
    }

    return block.content.find((line) => line.lawyerId === target.lawyerId)?.name ?? [{ type: "text", text: "" }];
  }

  if (block.type !== "signature") {
    return [{ type: "text", text: "" }];
  }

  return block.content.find((line) => line.lawyerId === target.lawyerId)?.oabText ?? [{ type: "text", text: "" }];
}

function setSpecialInlineNodes(
  block: LegalDocumentBlock,
  target: SpecialInlineTarget,
  getNextNodes: (nodes: InlineNode[]) => InlineNode[],
): LegalDocumentBlock {
  if (target.type === "requestTitle") {
    return setBlockTitle(block, getNextNodes(getSpecialInlineNodes(block, target)));
  }

  if (target.type === "requestItem") {
    return setRequestText(block, target.requestId, getNextNodes(getSpecialInlineNodes(block, target)));
  }

  if (target.type === "signatureTitle") {
    return setBlockTitle(block, getNextNodes(getSpecialInlineNodes(block, target)));
  }

  if (target.type === "signatureName") {
    return setSignatureLine(block, target.lawyerId, (line) => {
      line.name = getNextNodes(getSpecialInlineNodes(block, target));
    });
  }

  return setSignatureLine(block, target.lawyerId, (line) => {
    line.oabText = getNextNodes(getSpecialInlineNodes(block, target));
  });
}

function getSignatureContainerEditStyle(styleTemplate: DocumentStyleTemplate): React.CSSProperties {
  return {
    marginTop: `${resolveSignatureStyle(styleTemplate).spacingBeforePt}pt`,
    textAlign: resolveSignatureStyle(styleTemplate).alignment,
  };
}

function getSignatureLineEditStyle(styleTemplate: DocumentStyleTemplate): React.CSSProperties {
  return {
    minWidth: `${resolveSignatureStyle(styleTemplate).lineWidthPt}pt`,
    textAlign: resolveSignatureStyle(styleTemplate).alignment,
  };
}

function setBlockTitle(block: LegalDocumentBlock, title: InlineNode[] | null): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    if (draft.type === "heading") {
      draft.title = title ?? [{ type: "text", text: "" }];
      return;
    }

    if (draft.type === "section" || draft.type === "content" || draft.type === "request_list" || draft.type === "signature") {
      draft.title = title;
    }
  });
}

function setBlockTitleAlignment(block: LegalDocumentBlock, alignment: TextAlignment): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    draft.layout = {
      ...draft.layout,
      alignment,
    };
  });
}

function setBlockTitleFontSize(block: LegalDocumentBlock, fontSizePt: number): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
      return;
    }

    draft.layout = {
      ...draft.layout,
      fontSizePt,
    };
  });
}

function setBlockTitleNumberingEnabled(block: LegalDocumentBlock, enabled: boolean): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    draft.numbering = {
      enabled,
      includeInSequence: enabled,
      format: "decimal",
      level: getBlockNumberingLevel(draft),
    };
  });
}

function setBlockTitleNumberingLevel(block: LegalDocumentBlock, level: number): LegalDocumentBlock {
  const normalizedLevel = Number.isFinite(level) ? Math.min(Math.max(Math.trunc(level), 1), 6) : 1;

  return replaceBlock(block, (draft) => {
    const enabled = isBlockTitleNumberingEnabled(draft);
    draft.numbering = {
      enabled,
      includeInSequence: enabled,
      format: "decimal",
      level: normalizedLevel,
    };
  });
}

function setBlockContent(block: LegalDocumentBlock, content: ContentNode[]): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    if (draft.type === "section" || draft.type === "content") {
      draft.content = content;
    }
  });
}

function setRequestText(block: LegalDocumentBlock, requestId: string, text: InlineNode[]): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    if (draft.type !== "request_list") {
      return;
    }

    const request = draft.requests.find((currentRequest: LegalRequest) => currentRequest.id === requestId);
    if (request) {
      request.text = text;
    }
  });
}

function setRequestListRequests(block: LegalDocumentBlock, requests: LegalRequest[]): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    if (draft.type !== "request_list") {
      return;
    }

    draft.requests = requests.length > 0 ? requests : [createRequestFromInline()];
  });
}

function setRequestStyle(block: LegalDocumentBlock, requestId: string, style: NonNullable<LegalRequest["style"]>): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    if (draft.type !== "request_list") {
      return;
    }

    const request = draft.requests.find((currentRequest: LegalRequest) => currentRequest.id === requestId);
    if (!request) {
      return;
    }

    request.style = {
      ...request.style,
      ...style,
    };
  });
}

function setRequestListMarker(block: LegalDocumentBlock, markerOverride: "bullet" | "decimal"): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    if (draft.type !== "request_list") {
      return;
    }

    draft.listStyle = {
      ...draft.listStyle,
      markerOverride,
    };
  });
}

function setSignatureLine(block: LegalDocumentBlock, lawyerId: string, update: (line: SignatureLineNode) => void): LegalDocumentBlock {
  return replaceBlock(block, (draft) => {
    if (draft.type !== "signature") {
      return;
    }

    const line = draft.content.find((currentLine) => currentLine.lawyerId === lawyerId);
    if (line) {
      update(line);
    }
  });
}

function createParagraphFromInline(children: InlineNode[], alignment: TextAlignment, fontSizePt?: number): Extract<ContentNode, { type: "paragraph" }> {
  return {
    type: "paragraph",
    children,
    style: {
      alignment,
      ...(fontSizePt ? { fontSizePt } : {}),
    },
  };
}

function getFirstCellInlineNodes(children: ContentNode[] | undefined): InlineNode[] {
  const firstParagraph = children?.find((node): node is Extract<ContentNode, { type: "paragraph" }> => node.type === "paragraph");
  return firstParagraph?.children ?? [{ type: "text", text: "" }];
}
