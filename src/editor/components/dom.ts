import { normalizeInlineContent } from "../core/inline";
import type { InlineMark, InlineNode, InlineObjectNode } from "../core/schema";

/**
 * Per-`kind` chip rendering, derived from the plugin registry. Kept React-free
 * (label/class are strings) so the contenteditable HTML stays plugin-agnostic;
 * the interactive popover is rendered separately by DocumentEditor.
 */
export interface InlineRenderConfig {
  getLabel?: ((node: InlineObjectNode) => string) | undefined;
  getClassName?: ((node: InlineObjectNode) => string | undefined) | undefined;
  /** Chip is clickable (the kind has a renderEditor) → adds the interactive class. */
  interactive?: boolean | undefined;
}

function defaultObjectLabel(node: InlineObjectNode): string {
  const label = node.data["label"];
  return typeof label === "string" && label.length > 0 ? label : node.kind;
}

/**
 * DOM ↔ model conversion for the per-block contenteditable (D7/D16).
 * Rendering is plain HTML with semantic tags for marks; reading walks the
 * DOM back into InlineNode[]. Inline objects render as atomic
 * contenteditable=false chips carrying their data in attributes.
 */

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replaceAll("'", "&#39;");
}

/** Fixed nesting order so identical mark sets produce identical HTML. */
const MARK_ORDER: InlineMark["type"][] = [
  "link",
  "code",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "color",
  "highlight",
];

function wrapWithMark(html: string, mark: InlineMark): string {
  switch (mark.type) {
    case "bold":
      return `<strong>${html}</strong>`;
    case "italic":
      return `<em>${html}</em>`;
    case "underline":
      return `<u>${html}</u>`;
    case "strikethrough":
      return `<s>${html}</s>`;
    case "code":
      return `<code>${html}</code>`;
    case "link":
      return `<a href="${escapeAttribute(mark.href)}">${html}</a>`;
    case "color":
      return `<span data-wte-color="${escapeAttribute(mark.token)}">${html}</span>`;
    case "highlight":
      return `<span data-wte-highlight="${escapeAttribute(mark.token)}">${html}</span>`;
  }
}

export function inlineNodesToHtml(
  content: InlineNode[],
  inlineRenderers?: ReadonlyMap<string, InlineRenderConfig>,
): string {
  let html = "";
  for (const node of content) {
    if (node.type === "text") {
      let nodeHtml = escapeHtml(node.text);
      const marks = [...(node.marks ?? [])].sort(
        (a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type),
      );
      for (const mark of marks) {
        nodeHtml = wrapWithMark(nodeHtml, mark);
      }
      html += nodeHtml;
    } else {
      const config = inlineRenderers?.get(node.kind);
      const label = config?.getLabel?.(node) ?? defaultObjectLabel(node);
      const customClass = config?.getClassName?.(node);
      const className = ["wte-inline-object", config?.interactive === true ? "wte-inline-object--interactive" : null, customClass ?? null]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" ");
      const payload = escapeAttribute(JSON.stringify({ data: node.data, meta: node.meta }));
      html += `<span class="${escapeAttribute(className)}" data-wte-object="${escapeAttribute(node.kind)}" data-wte-payload="${payload}" contenteditable="false">${escapeHtml(label)}</span>`;
    }
  }
  return html;
}

function markForElement(element: Element): InlineMark | null {
  switch (element.tagName) {
    case "STRONG":
    case "B":
      return { type: "bold" };
    case "EM":
    case "I":
      return { type: "italic" };
    case "U":
      return { type: "underline" };
    case "S":
    case "STRIKE":
    case "DEL":
      return { type: "strikethrough" };
    case "CODE":
      return { type: "code" };
    case "A": {
      const href = element.getAttribute("href");
      return href !== null && href.length > 0 ? { type: "link", href } : null;
    }
    default: {
      const color = element.getAttribute("data-wte-color");
      if (color !== null && color.length > 0) {
        return { type: "color", token: color };
      }
      const highlight = element.getAttribute("data-wte-highlight");
      if (highlight !== null && highlight.length > 0) {
        return { type: "highlight", token: highlight };
      }
      return null;
    }
  }
}

function readInlineObject(element: Element): InlineNode {
  const kind = element.getAttribute("data-wte-object") ?? "unknown";
  try {
    const payload = JSON.parse(element.getAttribute("data-wte-payload") ?? "{}") as {
      data?: Record<string, unknown>;
      meta?: Record<string, unknown>;
    };
    return {
      type: "object",
      kind,
      data: payload.data ?? {},
      ...(payload.meta !== undefined ? { meta: payload.meta } : {}),
    };
  } catch {
    return { type: "object", kind, data: {} };
  }
}

export function domToInlineNodes(root: HTMLElement): InlineNode[] {
  const nodes: InlineNode[] = [];

  function walk(node: Node, marks: InlineMark[]): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.length > 0) {
        nodes.push({ type: "text", text, ...(marks.length > 0 ? { marks } : {}) });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const element = node as Element;
    if (element.hasAttribute("data-wte-object")) {
      nodes.push(readInlineObject(element));
      return;
    }
    if (element.tagName === "BR") {
      return;
    }
    const mark = markForElement(element);
    const childMarks = mark !== null ? [...marks.filter((m) => m.type !== mark.type), mark] : marks;
    for (const child of Array.from(element.childNodes)) {
      walk(child, childMarks);
    }
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child, []);
  }
  return normalizeInlineContent(nodes);
}

// ---------------------------------------------------------------------------
// Caret utilities — offsets in inline units (objects count as 1)
// ---------------------------------------------------------------------------

interface WalkPosition {
  node: Node;
  /** Character offset within a text node; 0/1 = before/after an object. */
  offset: number;
}

function isObjectElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute("data-wte-object");
}

/** Inline-unit offset of a DOM position inside root, or null if outside. */
function positionToOffset(root: HTMLElement, position: WalkPosition): number | null {
  let total = 0;
  let found: number | null = null;

  function walk(node: Node): boolean {
    if (node === position.node && node.nodeType === Node.TEXT_NODE) {
      found = total + Math.min(position.offset, (node.textContent ?? "").length);
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.textContent ?? "").length;
      return false;
    }
    if (isObjectElement(node)) {
      if (node === position.node) {
        found = total + (position.offset > 0 ? 1 : 0);
        return true;
      }
      total += 1;
      return false;
    }
    const children = Array.from(node.childNodes);
    if (node === position.node) {
      // Element position: offset is a child index — resolve to the start
      // of that child by walking the preceding children.
      for (let index = 0; index < Math.min(position.offset, children.length); index += 1) {
        walk(children[index]!);
      }
      found = total;
      return true;
    }
    for (const child of children) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  }

  walk(root);
  return found;
}

export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }
  const start = positionToOffset(root, { node: range.startContainer, offset: range.startOffset });
  const end = positionToOffset(root, { node: range.endContainer, offset: range.endOffset });
  if (start === null || end === null) {
    return null;
  }
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function getCaretOffset(root: HTMLElement): number | null {
  return getSelectionOffsets(root)?.end ?? null;
}

/**
 * Inline-unit offset where the given inline-object element begins (the chip
 * occupies `[offset, offset + 1)`). Used to address a clicked chip for the
 * edit popover. Returns null if the element is not within `root`.
 */
export function offsetOfInlineObject(root: HTMLElement, element: Element): number | null {
  const parent = element.parentNode;
  if (parent === null || !root.contains(element)) {
    return null;
  }
  const index = Array.from(parent.childNodes).indexOf(element as ChildNode);
  if (index === -1) {
    return null;
  }
  return positionToOffset(root, { node: parent, offset: index });
}

/** Resolves an inline-unit offset to a concrete DOM position (clamped). */
function resolveOffset(root: HTMLElement, offset: number): WalkPosition | null {
  let remaining = Math.max(offset, 0);
  let target: WalkPosition | null = null;

  function walk(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? "").length;
      if (remaining <= length) {
        target = { node, offset: remaining };
        return true;
      }
      remaining -= length;
      return false;
    }
    if (isObjectElement(node)) {
      if (remaining < 1) {
        const parent = node.parentNode;
        if (parent !== null) {
          target = { node: parent, offset: Array.from(parent.childNodes).indexOf(node as ChildNode) };
        }
        return true;
      }
      remaining -= 1;
      return false;
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  }

  walk(root);
  return target;
}

/** Selects [start, end] in inline units (clamped; collapsed when equal). */
export function setSelectionOffsets(root: HTMLElement, start: number, end: number): void {
  const doc = root.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) {
    return;
  }

  const range = doc.createRange();
  const startPosition = resolveOffset(root, Math.min(start, end));
  if (startPosition !== null) {
    range.setStart(startPosition.node, startPosition.offset);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  const endPosition = resolveOffset(root, Math.max(start, end));
  if (endPosition !== null) {
    range.setEnd(endPosition.node, endPosition.offset);
  } else {
    range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Places a collapsed caret at the inline-unit offset (clamped). */
export function setCaretOffset(root: HTMLElement, offset: number): void {
  setSelectionOffsets(root, offset, offset);
}

// ---------------------------------------------------------------------------
// Visual line detection (block-boundary arrow navigation)
// ---------------------------------------------------------------------------

function getCaretRect(root: HTMLElement): DOMRect | null {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return null;
  }
  let rect: DOMRect;
  try {
    const rects = range.getClientRects();
    rect = rects.length > 0 ? rects[0]! : range.getBoundingClientRect();
  } catch {
    return null; // measurement unavailable (e.g. jsdom)
  }
  // Zero rect: empty block or measurement unavailable (jsdom) — callers
  // treat it as a single-line block.
  if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) {
    return null;
  }
  return rect;
}

/**
 * True when the caret sits on the block's first visual (wrapped) line —
 * the condition under which ArrowUp should leave the block. Errs toward
 * true when measurement is unavailable.
 */
export function isCaretOnFirstLine(root: HTMLElement): boolean {
  const caretRect = getCaretRect(root);
  if (caretRect === null) {
    return true;
  }
  const rootRect = root.getBoundingClientRect();
  return caretRect.top - rootRect.top < caretRect.height * 1.5;
}

/** True when the caret sits on the block's last visual (wrapped) line. */
export function isCaretOnLastLine(root: HTMLElement): boolean {
  const caretRect = getCaretRect(root);
  if (caretRect === null) {
    return true;
  }
  const rootRect = root.getBoundingClientRect();
  return rootRect.bottom - caretRect.bottom < caretRect.height * 1.5;
}

/** Viewport x of the caret — the "column" to preserve across block jumps. */
export function getCaretViewportX(root: HTMLElement): number | null {
  return getCaretRect(root)?.left ?? null;
}

/**
 * Inline offset on the block's first/last visual line nearest to viewport
 * x — how ArrowUp/Down keep the column when crossing blocks. Returns null
 * when hit-testing is unavailable (jsdom; callers fall back to start/end).
 */
export function getOffsetNearViewportX(root: HTMLElement, x: number, line: "first" | "last"): number | null {
  try {
    const rootRect = root.getBoundingClientRect();
    if (rootRect.height === 0 && rootRect.width === 0) {
      return null;
    }
    const inset = Math.min(8, rootRect.height / 2);
    const probeY = line === "first" ? rootRect.top + inset : rootRect.bottom - inset;
    const probeX = Math.min(Math.max(x, rootRect.left + 1), rootRect.right - 1);

    const doc = root.ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    let node: Node | null = null;
    let domOffset = 0;
    if (typeof doc.caretPositionFromPoint === "function") {
      const position = doc.caretPositionFromPoint(probeX, probeY);
      if (position !== null) {
        node = position.offsetNode;
        domOffset = position.offset;
      }
    } else if (typeof doc.caretRangeFromPoint === "function") {
      const range = doc.caretRangeFromPoint(probeX, probeY);
      if (range !== null) {
        node = range.startContainer;
        domOffset = range.startOffset;
      }
    }

    if (node === null || !root.contains(node)) {
      return null;
    }
    return positionToOffset(root, { node, offset: domOffset });
  } catch {
    return null;
  }
}
