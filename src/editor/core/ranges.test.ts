import { describe, expect, it } from "vitest";
import { createImageBlock, createTextBlock } from "./factories";
import { getInlineText } from "./inline";
import { deleteTextRange, extractTextRange, replaceTextRangeWithBlocks, replaceTextRangeWithInline, textRangeToPlainText } from "./ranges";
import { SCHEMA_VERSION, type MogulDocument } from "./schema";

function docWith(blocks: MogulDocument["blocks"]): MogulDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

describe("document range operations", () => {
  it("deletes within one block and places the caret at the join", () => {
    const block = createTextBlock({ content: "abcdef" });
    const result = deleteTextRange(docWith([block]), {
      type: "text",
      anchor: { blockId: block.id, offset: 2 },
      focus: { blockId: block.id, offset: 4 },
    });
    expect(getInlineText((result.document.blocks[0] as typeof block).content)).toBe("abef");
    expect(result.selection.focus.offset).toBe(2);
  });

  it("merges cross-block endpoints and removes intervening atomic blocks", () => {
    const first = createTextBlock({ content: "first" });
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const last = createTextBlock({ content: "last" });
    const result = deleteTextRange(docWith([first, image, last]), {
      type: "text",
      anchor: { blockId: last.id, offset: 2 },
      focus: { blockId: first.id, offset: 2 },
    });
    expect(result.document.blocks).toHaveLength(1);
    expect(getInlineText((result.document.blocks[0] as typeof first).content)).toBe("fist");
    expect(result.selection.anchor).toEqual({ blockId: first.id, offset: 2 });
  });

  it("extracts clipped blocks for rich and plain-text clipboard output", () => {
    const first = createTextBlock({ content: "first" });
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" }, altText: "diagram" });
    const last = createTextBlock({ content: "last" });
    const document = docWith([first, image, last]);
    const selection = {
      type: "text" as const,
      anchor: { blockId: last.id, offset: 3 },
      focus: { blockId: first.id, offset: 2 },
    };
    const fragment = extractTextRange(document, selection);
    expect(fragment.blocks).toHaveLength(3);
    expect(getInlineText((fragment.blocks[0] as typeof first).content)).toBe("rst");
    expect(fragment.blocks[1]).toBe(image);
    expect(getInlineText((fragment.blocks[2] as typeof last).content)).toBe("las");
    expect(textRangeToPlainText(document, selection)).toBe("rst\ndiagram\nlas");
  });

  it("replaces a backward cross-block range with inline text", () => {
    const first = createTextBlock({ content: "first" });
    const last = createTextBlock({ content: "last" });
    const result = replaceTextRangeWithInline(docWith([first, last]), {
      type: "text",
      anchor: { blockId: last.id, offset: 2 },
      focus: { blockId: first.id, offset: 2 },
    }, [{ type: "text", text: "X" }]);
    expect(getInlineText((result.document.blocks[0] as typeof first).content)).toBe("fiXst");
    expect(result.selection.focus.offset).toBe(3);
  });

  it("replaces a cross-block range with block content atomically", () => {
    const first = createTextBlock({ content: "first" });
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const last = createTextBlock({ content: "last" });
    const inserted = createTextBlock({ variant: "bullet", content: "inserted" });
    const result = replaceTextRangeWithBlocks(docWith([first, image, last]), {
      type: "text",
      anchor: { blockId: first.id, offset: 2 },
      focus: { blockId: last.id, offset: 2 },
    }, [inserted]);
    expect(result.document.blocks.map((block) => block.type === "text" ? getInlineText(block.content) : "")).toEqual(["fi", "inserted", "st"]);
  });

  it("rejects replacement blocks whose ids collide with surviving blocks", () => {
    const first = createTextBlock({ content: "first" });
    const last = createTextBlock({ content: "last" });
    const survivor = createTextBlock({ content: "survivor" });

    expect(() => replaceTextRangeWithBlocks(docWith([first, last, survivor]), {
      type: "text",
      anchor: { blockId: first.id, offset: 2 },
      focus: { blockId: last.id, offset: 2 },
    }, [survivor], false)).toThrow(RangeError);
  });
});
