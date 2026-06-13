// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHeadingBlock, createTextBlock } from "../core/factories";
import { SCHEMA_VERSION, type Block, type TextBlock, type WealthyDocument } from "../core/schema";
import { useDocumentEditor, type UseDocumentEditorOptions } from "./useDocumentEditor";

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDocumentEditor", () => {
  it("re-renders with the new document after a command", () => {
    const block = createTextBlock({ content: "hello" });
    const { result } = renderHook(() => useDocumentEditor({ value: docWith([block]) }));

    act(() => {
      result.current.commands.updateBlock(block.id, { content: textContent("world") });
    });

    expect((result.current.document.blocks[0] as TextBlock).content).toEqual(textContent("world"));
  });

  it("fires onChange per transaction, but not for selection changes", () => {
    const block = createTextBlock({ content: "a" });
    const onChange = vi.fn();
    const { result } = renderHook(() => useDocumentEditor({ value: docWith([block]), onChange }));

    act(() => {
      result.current.commands.updateBlock(block.id, { content: textContent("b") });
      result.current.setSelection({ type: "text", blockId: block.id, anchor: 1, focus: 1 });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(result.current.document, {
      origin: "command",
      command: "updateBlock",
    });
    expect(result.current.selection).toMatchObject({ anchor: 1, focus: 1 });
  });

  it("echoing the onChange document back into value does NOT reset the editor", () => {
    const block = createTextBlock({ content: "a" });
    let latest: WealthyDocument | null = null;
    const initial = docWith([block]);
    const { result, rerender } = renderHook(
      (props: UseDocumentEditorOptions) => useDocumentEditor(props),
      { initialProps: { value: initial, onChange: (doc: WealthyDocument) => (latest = doc) } },
    );

    act(() => {
      result.current.commands.updateBlock(block.id, { content: textContent("b") });
    });
    expect(result.current.canUndo).toBe(true);

    rerender({ value: latest!, onChange: (doc: WealthyDocument) => (latest = doc) });

    expect(result.current.canUndo).toBe(true); // history survived
    expect(result.current.isDirty).toBe(true); // still uncommitted
    expect((result.current.document.blocks[0] as TextBlock).content).toEqual(textContent("b"));
  });

  it("a foreign value reference performs a document switch (D10)", () => {
    const block = createTextBlock({ content: "a" });
    const { result, rerender } = renderHook(
      (props: UseDocumentEditorOptions) => useDocumentEditor(props),
      { initialProps: { value: docWith([block]) } },
    );

    act(() => {
      result.current.commands.updateBlock(block.id, { content: textContent("edited") });
    });
    expect(result.current.canUndo).toBe(true);

    const fresh = docWith([createTextBlock({ content: "fresh" })]);
    rerender({ value: fresh });

    expect(result.current.document).toBe(fresh);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.selection).toBeNull();
  });

  it("tracks dirty state; commit fires onCommit once and clears it", () => {
    const block = createTextBlock({ content: "a" });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDocumentEditor({ value: docWith([block]), onCommit }));

    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.commands.updateBlock(block.id, { content: textContent("b") });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.commit();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.commit(); // nothing changed — no second commit
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("undoing back to the committed snapshot makes the editor clean again", () => {
    const block = createTextBlock({ content: "a" });
    const { result } = renderHook(() => useDocumentEditor({ value: docWith([block]) }));

    act(() => {
      result.current.commands.turnInto(block.id, { type: "heading", level: 1 });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.commands.undo();
    });
    expect(result.current.isDirty).toBe(false); // structural sharing → same reference
  });

  it("auto-commits after commitIdleMs of inactivity", () => {
    vi.useFakeTimers();
    const block = createTextBlock({ content: "a" });
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDocumentEditor({ value: docWith([block]), onCommit, commitIdleMs: 500 }),
    );

    act(() => {
      result.current.commands.updateBlock(block.id, { content: textContent("b") });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      result.current.commands.updateBlock(block.id, { content: textContent("c") }); // resets the timer
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(result.current.isDirty).toBe(false);
  });

  it("exposes a memoized section tree that follows edits", () => {
    const h1 = createHeadingBlock({ level: 1, content: "A" });
    const p = createTextBlock({ content: "body" });
    const { result } = renderHook(() => useDocumentEditor({ value: docWith([h1, p]) }));

    const treeBefore = result.current.sectionTree;
    expect(treeBefore.sections).toHaveLength(1);
    expect(result.current.sectionTree).toBe(treeBefore); // stable across reads

    act(() => {
      result.current.commands.turnInto(p.id, { type: "heading", level: 2 });
    });
    expect(result.current.sectionTree).not.toBe(treeBefore);
    expect(result.current.sectionTree.sections[0]!.subsections).toHaveLength(1);
  });

  it("collapse/expand is view state: hiddenBlockIds covers descendants, heading stays visible", () => {
    const h1 = createHeadingBlock({ level: 1, content: "A" });
    const p1 = createTextBlock({ content: "a-body" });
    const h2 = createHeadingBlock({ level: 2, content: "A.1" });
    const p2 = createTextBlock({ content: "a1-body" });
    const h1b = createHeadingBlock({ level: 1, content: "B" });
    const { result } = renderHook(() => useDocumentEditor({ value: docWith([h1, p1, h2, p2, h1b]) }));

    act(() => {
      result.current.toggleSectionCollapsed(h1.id);
    });

    expect(result.current.isSectionCollapsed(h1.id)).toBe(true);
    expect(result.current.hiddenBlockIds).toEqual(new Set([p1.id, h2.id, p2.id]));
    expect(result.current.hiddenBlockIds.has(h1.id)).toBe(false);
    expect(result.current.hiddenBlockIds.has(h1b.id)).toBe(false);
    // The document itself is untouched (D3.4).
    expect(result.current.document.blocks).toHaveLength(5);

    act(() => {
      result.current.expandAllSections();
    });
    expect(result.current.hiddenBlockIds.size).toBe(0);
  });

  it("hiddenBlockIds recomputes when edits change a collapsed section's extent", () => {
    const h1 = createHeadingBlock({ level: 1, content: "A" });
    const p1 = createTextBlock({ content: "a-body" });
    const { result } = renderHook(() => useDocumentEditor({ value: docWith([h1, p1]) }));

    act(() => {
      result.current.setSectionCollapsed(h1.id, true);
    });
    expect(result.current.hiddenBlockIds).toEqual(new Set([p1.id]));

    act(() => {
      // Promote the paragraph to a same-level heading — it leaves the section.
      result.current.commands.turnInto(p1.id, { type: "heading", level: 1 });
    });
    expect(result.current.hiddenBlockIds.size).toBe(0);
  });

  it("canUndo/canRedo are reactive", () => {
    const block = createTextBlock({ content: "a" });
    const { result } = renderHook(() => useDocumentEditor({ value: docWith([block]) }));

    expect(result.current.canUndo).toBe(false);
    act(() => {
      result.current.commands.indent(block.id);
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.commands.undo();
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });
});
