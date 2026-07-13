// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  domToInlineNodes,
  getSelectionOffsets,
  inlineNodesToHtml,
  offsetOfInlineObject,
  setCaretOffset,
  type InlineRenderConfig,
} from "./dom";
import type { InlineNode } from "../core/schema";

function element(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe("inlineNodesToHtml", () => {
  it("renders marks as semantic tags in a stable order", () => {
    const content: InlineNode[] = [
      { type: "text", text: "plain " },
      { type: "text", text: "bold-italic", marks: [{ type: "italic" }, { type: "bold" }] },
    ];
    expect(inlineNodesToHtml(content)).toBe("plain <strong><em>bold-italic</em></strong>");
  });

  it("escapes HTML in text, links, and tokens", () => {
    expect(inlineNodesToHtml([{ type: "text", text: "<b>&\"" }])).toBe("&lt;b&gt;&amp;&quot;");
    expect(
      inlineNodesToHtml([{ type: "text", text: "x", marks: [{ type: "link", href: 'https://a?b="c"' }] }]),
    ).toBe('<a href="https://a?b=&quot;c&quot;">x</a>');
  });

  it("drops unsafe links when rendering or parsing editor HTML", () => {
    expect(inlineNodesToHtml([{ type: "text", text: "x", marks: [{ type: "link", href: "javascript:alert(1)" }] }])).toBe("x");
    expect(domToInlineNodes(element('<a href="javascript:alert(1)">x</a>'))).toEqual([{ type: "text", text: "x" }]);
  });

  it("renders inline objects as atomic chips with payload attributes", () => {
    const html = inlineNodesToHtml([
      { type: "object", kind: "placeholder", data: { key: "client", label: "Cliente" } },
    ]);
    expect(html).toContain('data-wte-object="placeholder"');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain(">Cliente</span>");
  });

  it("applies per-kind label, class, and interactive flag from inlineRenderers", () => {
    const renderers = new Map<string, InlineRenderConfig>([
      [
        "placeholder",
        {
          getLabel: (node) => (typeof node.data["value"] === "string" ? node.data["value"] : "empty"),
          getClassName: (node) => (node.data["value"] !== undefined ? "filled" : "empty-chip"),
          interactive: true,
        },
      ],
    ]);
    const html = inlineNodesToHtml(
      [{ type: "object", kind: "placeholder", data: { label: "Cliente", value: "Ana" } }],
      renderers,
    );
    expect(html).toContain("wte-inline-object--interactive");
    expect(html).toContain("filled");
    expect(html).toContain(">Ana</span>");
  });

  it("falls back to the default pill when a kind has no renderer", () => {
    const renderers = new Map<string, InlineRenderConfig>();
    const html = inlineNodesToHtml([{ type: "object", kind: "mention", data: { label: "X" } }], renderers);
    expect(html).toContain('class="wte-inline-object"');
    expect(html).toContain(">X</span>");
  });
});

describe("offsetOfInlineObject", () => {
  it("returns the inline offset where a chip begins", () => {
    const content: InlineNode[] = [
      { type: "text", text: "Hi " },
      { type: "object", kind: "placeholder", data: {} },
      { type: "text", text: " there" },
    ];
    const root = element(inlineNodesToHtml(content));
    const chip = root.querySelector("[data-wte-object]")!;
    expect(offsetOfInlineObject(root, chip)).toBe(3);
  });

  it("returns null for an element outside the root", () => {
    const root = element("abc");
    const other = element('<span data-wte-object="x">y</span>');
    expect(offsetOfInlineObject(root, other.querySelector("[data-wte-object]")!)).toBeNull();
  });
});

describe("domToInlineNodes", () => {
  it("round-trips text, marks, and objects", () => {
    const content: InlineNode[] = [
      { type: "text", text: "a " },
      { type: "text", text: "b", marks: [{ type: "bold" }, { type: "underline" }] },
      { type: "text", text: " c ", marks: [{ type: "link", href: "https://x.dev" }] },
      { type: "object", kind: "mention", data: { id: "u1" }, meta: { state: "ok" } },
      { type: "text", text: " end", marks: [{ type: "color", token: "danger" }] },
    ];
    const root = element(inlineNodesToHtml(content));
    expect(domToInlineNodes(root)).toEqual(content);
  });

  it("reads browser-flavored tags (b, i, span styles) into marks", () => {
    const root = element("<b>bold</b><i>italic</i><s>gone</s>");
    expect(domToInlineNodes(root)).toEqual([
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: "italic", marks: [{ type: "italic" }] },
      { type: "text", text: "gone", marks: [{ type: "strikethrough" }] },
    ]);
  });

  it("ignores <br> and merges adjacent same-marked text", () => {
    const root = element("hello<br>world");
    expect(domToInlineNodes(root)).toEqual([{ type: "text", text: "helloworld" }]);
  });

  it("round-trips explicit off marks used to override inherited formatting", () => {
    const content: InlineNode[] = [
      { type: "text", text: "plain in bold paragraph", marks: [{ type: "bold", enabled: false }] },
    ];
    const root = element(inlineNodesToHtml(content));
    expect(root.querySelector('[data-wte-bold="false"]')).not.toBeNull();
    expect(domToInlineNodes(root)).toEqual(content);
  });

  it("returns empty content for an empty element", () => {
    expect(domToInlineNodes(element(""))).toEqual([]);
  });
});

describe("caret utilities", () => {
  it("setCaretOffset + getSelectionOffsets round-trip across marks and objects", () => {
    const content: InlineNode[] = [
      { type: "text", text: "ab", marks: [{ type: "bold" }] },
      { type: "object", kind: "x", data: {} },
      { type: "text", text: "cd" },
    ];
    const root = element(inlineNodesToHtml(content));

    for (const offset of [0, 1, 2, 4, 5]) {
      setCaretOffset(root, offset);
      expect(getSelectionOffsets(root)).toEqual({ start: offset, end: offset });
    }
  });

  it("clamps past-the-end offsets to the end", () => {
    const root = element(inlineNodesToHtml([{ type: "text", text: "abc" }]));
    setCaretOffset(root, 99);
    expect(getSelectionOffsets(root)).toEqual({ start: 3, end: 3 });
  });

  it("returns null when the selection is outside the root", () => {
    const root = element("abc");
    const other = element("xyz");
    setCaretOffset(other, 1);
    expect(getSelectionOffsets(root)).toBeNull();
  });
});
