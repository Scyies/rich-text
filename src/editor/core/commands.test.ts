import { describe, expect, it, vi } from "vitest";
import { createEditorEngine } from "./commands";
import { createHeadingBlock, createTextBlock } from "./factories";
import { SCHEMA_VERSION, type Block, type TextBlock, type WealthyDocument } from "./schema";

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

describe("createEditorEngine", () => {
  it("runs commands through the transaction pipeline and notifies subscribers", () => {
    const block = createTextBlock({ content: "hello" });
    const engine = createEditorEngine({ value: docWith([block]) });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.commands.updateBlock(block.id, { content: textContent("world") });

    expect(engine.getDocument().blocks[0]).toMatchObject({ content: textContent("world") });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(engine.getDocument(), { origin: "command", command: "updateBlock" });
  });

  it("failed commands change nothing and notify nobody", () => {
    const block = createTextBlock();
    const engine = createEditorEngine({ value: docWith([block]) });
    const before = engine.getDocument();
    const listener = vi.fn();
    engine.subscribe(listener);

    expect(() => engine.commands.deleteBlock("00000000-0000-4000-8000-000000000000")).toThrow(RangeError);
    expect(engine.getDocument()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(engine.canUndo()).toBe(false);
  });

  it("undo/redo restore document states", () => {
    const block = createTextBlock({ content: "v1" });
    const engine = createEditorEngine({ value: docWith([block]) });

    engine.commands.turnInto(block.id, { type: "heading", level: 2 });
    expect(engine.getDocument().blocks[0]!.type).toBe("heading");

    expect(engine.commands.undo()).toBe(true);
    expect(engine.getDocument().blocks[0]!.type).toBe("text");

    expect(engine.commands.redo()).toBe(true);
    expect(engine.getDocument().blocks[0]!.type).toBe("heading");

    expect(engine.commands.redo()).toBe(false);
  });

  it("typing coalesces: one undo reverts the whole run, structural ops break it", () => {
    const block = createTextBlock({ content: "" });
    const engine = createEditorEngine({ value: docWith([block]), coalesceWindowMs: 60_000 });

    for (const text of ["h", "he", "hel", "hell", "hello"]) {
      engine.commands.updateBlock(block.id, { content: textContent(text) });
    }
    engine.commands.turnInto(block.id, { type: "heading", level: 1 }); // structural — own entry
    engine.commands.updateBlock(block.id, { content: textContent("hello!") });

    engine.commands.undo(); // revert the "!" typing run
    expect(engine.getDocument().blocks[0]).toMatchObject({ type: "heading", content: textContent("hello") });
    engine.commands.undo(); // revert turnInto
    expect(engine.getDocument().blocks[0]).toMatchObject({ type: "text", content: textContent("hello") });
    engine.commands.undo(); // revert the whole typing run at once
    expect((engine.getDocument().blocks[0] as TextBlock).content).toEqual([]);
    expect(engine.commands.undo()).toBe(false);
  });

  it("splitBlock returns the new block id; mergeWithPrevious returns the caret offset", () => {
    const block = createTextBlock({ content: "hello world" });
    const engine = createEditorEngine({ value: docWith([block]) });

    const newId = engine.commands.splitBlock(block.id, 5);
    expect(engine.getDocument().blocks[1]!.id).toBe(newId);

    const caret = engine.commands.mergeWithPrevious(newId);
    expect(caret).toBe(5);
    expect(engine.getDocument().blocks).toHaveLength(1);
  });

  it("insertInlineNode returns the caret offset after the inserted node", () => {
    const block = createTextBlock({ content: "hello" });
    const engine = createEditorEngine({ value: docWith([block]) });

    const caret = engine.commands.insertInlineNode(block.id, 5, {
      type: "object",
      kind: "placeholder",
      data: { key: "k" },
    });
    expect(caret).toBe(6); // atomic object counts as 1 inline unit
    expect((engine.getDocument().blocks[0] as TextBlock).content).toHaveLength(2);

    engine.commands.undo();
    expect((engine.getDocument().blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("updateInlineObject / removeInlineNode edit a chip in place and are undoable", () => {
    const block = createTextBlock({
      content: [
        { type: "text", text: "Hi " },
        { type: "object", kind: "placeholder", data: { key: "name", label: "Name" } },
      ],
    });
    const engine = createEditorEngine({ value: docWith([block]) });

    engine.commands.updateInlineObject(block.id, 3, { data: { key: "name", value: "Ana" } });
    expect((engine.getDocument().blocks[0] as TextBlock).content[1]).toMatchObject({
      kind: "placeholder",
      data: { value: "Ana" },
    });

    engine.commands.removeInlineNode(block.id, 3);
    expect((engine.getDocument().blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "Hi " }]);

    engine.commands.undo(); // restore the chip
    expect((engine.getDocument().blocks[0] as TextBlock).content).toHaveLength(2);
  });

  it("applyPatches is undoable as a single step", () => {
    const heading = createHeadingBlock({ level: 1, content: "A" });
    const paragraph = createTextBlock({ content: "body" });
    const engine = createEditorEngine({ value: docWith([heading, paragraph]) });
    const listener = vi.fn();
    engine.subscribe(listener);

    const applied = engine.commands.applyPatches([
      { op: "update_block", blockId: paragraph.id, changes: { content: textContent("patched") } },
      { op: "turn_into", blockId: paragraph.id, target: { type: "text", variant: "bullet" } },
    ]);

    expect(applied).toHaveLength(2);
    expect(listener).toHaveBeenCalledWith(engine.getDocument(), { origin: "patches" });
    expect(engine.getDocument().blocks[1]).toMatchObject({ variant: "bullet" });

    engine.commands.undo();
    expect(engine.getDocument().blocks[1]).toMatchObject({ variant: "paragraph", content: textContent("body") });
  });

  it("selection is tracked, clamped after transforms, and restored by undo", () => {
    const block = createTextBlock({ content: "hello world" });
    const engine = createEditorEngine({ value: docWith([block]) });

    engine.setSelection({ type: "text", blockId: block.id, anchor: 11, focus: 11 });
    engine.commands.updateBlock(block.id, { content: textContent("hi") });
    expect(engine.getSelection()).toMatchObject({ anchor: 2, focus: 2 }); // clamped to new length

    engine.commands.undo();
    expect(engine.getSelection()).toMatchObject({ anchor: 11, focus: 11 }); // restored
  });

  it("setDocument switches documents and resets history (D10)", () => {
    const block = createTextBlock({ content: "a" });
    const engine = createEditorEngine({ value: docWith([block]) });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.commands.updateBlock(block.id, { content: textContent("b") });
    expect(engine.canUndo()).toBe(true);

    const fresh = docWith([createTextBlock({ content: "fresh" })]);
    engine.setDocument(fresh);
    expect(engine.getDocument()).toBe(fresh);
    expect(engine.canUndo()).toBe(false);
    expect(engine.getSelection()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(fresh, { origin: "set-document" });
  });

  it("exposes the derived section API", () => {
    const h1 = createHeadingBlock({ level: 1, content: "A" });
    const p = createTextBlock({ content: "body" });
    const engine = createEditorEngine({ value: docWith([h1, p]) });

    expect(engine.getSectionTree().sections).toHaveLength(1);
    expect(engine.getSection(h1.id)?.blocks).toEqual([p]);

    const newHeadingId = engine.commands.duplicateSection(h1.id);
    expect(engine.getSection(newHeadingId)).not.toBeNull();
    expect(engine.getDocument().blocks).toHaveLength(4);
  });

  it("unsubscribe stops notifications", () => {
    const block = createTextBlock();
    const engine = createEditorEngine({ value: docWith([block]) });
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    unsubscribe();
    engine.commands.indent(block.id);
    expect(listener).not.toHaveBeenCalled();
  });
});
