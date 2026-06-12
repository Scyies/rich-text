import { normalizeInlineContent } from "../core/inline";
import type { InlineMark, InlineNode } from "../core/schema";

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

export function inlineNodesToHtml(content: InlineNode[]): string {
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
      const label =
        typeof node.data["label"] === "string" && node.data["label"].length > 0
          ? node.data["label"]
          : node.kind;
      const payload = escapeAttribute(JSON.stringify({ data: node.data, meta: node.meta }));
      html += `<span class="wte-inline-object" data-wte-object="${escapeAttribute(node.kind)}" data-wte-payload="${payload}" contenteditable="false">${escapeHtml(label)}</span>`;
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
