import { describe, expect, it } from "vitest";
import { createHeadingBlock, createImageBlock, createTextBlock } from "./factories";
import { planSetAlignment, planToggleMark } from "./formatting";
import { SCHEMA_VERSION, type Block, type MogulDocument } from "./schema";

const docWith = (blocks: Block[]): MogulDocument => ({ schemaVersion: SCHEMA_VERSION, blocks });

describe("formatting planners", () => {
  it("plans a reverse multi-block mark toggle and drops zero-length boundary slices", () => {
    const first = createTextBlock({ content: "one" });
    const second = createHeadingBlock({ level: 2, content: "two" });
    const patches = planToggleMark(docWith([first, second]), {
      type: "text", anchor: { blockId: second.id, offset: 3 }, focus: { blockId: first.id, offset: 3 },
    }, { type: "bold" });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ op: "update_block", blockId: second.id });
  });

  it("plans supported alignment without no-op or invalid justify patches", () => {
    const text = createTextBlock({ align: "left" });
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    expect(planSetAlignment(docWith([text, image]), { type: "blocks", anchorBlockId: text.id, focusBlockId: image.id }, "justify"))
      .toEqual([{ op: "update_block", blockId: text.id, changes: { align: "justify" } }]);
  });

  it("does not plan a mark update for an inline-object-only range", () => {
    const block = createTextBlock({
      content: [
        { type: "object", kind: "placeholder", data: { label: "Name" } },
        { type: "text", text: "tail" },
      ],
    });
    expect(planToggleMark(docWith([block]), {
      type: "text", anchor: { blockId: block.id, offset: 0 }, focus: { blockId: block.id, offset: 1 },
    }, { type: "bold" })).toEqual([]);
  });
});
