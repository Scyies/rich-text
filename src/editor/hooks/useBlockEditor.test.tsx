// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextBlock } from "../core/factories";
import type { Block, TextBlock } from "../core/schema";
import { useBlockEditor, type UseBlockEditorOptions } from "./useBlockEditor";

afterEach(cleanup);

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

describe("useBlockEditor", () => {
  it("updates the block through the same validation pipeline", () => {
    const block = createTextBlock({ content: "hello" });
    const { result } = renderHook(() => useBlockEditor({ value: block }));

    act(() => {
      result.current.update({ variant: "bullet", indent: 1 });
    });
    expect(result.current.block).toMatchObject({ variant: "bullet", indent: 1 });

    expect(() =>
      act(() => {
        result.current.update({ level: 2 }); // not patchable on a text block
      }),
    ).toThrow(RangeError);
  });

  it("fires onChange with the block and supports turnInto + undo", () => {
    const block = createTextBlock({ content: "title" });
    const onChange = vi.fn();
    const { result } = renderHook(() => useBlockEditor({ value: block, onChange }));

    act(() => {
      result.current.turnInto({ type: "heading", level: 2 });
    });
    expect(result.current.block.type).toBe("heading");
    expect(onChange).toHaveBeenLastCalledWith(result.current.block, {
      origin: "command",
      command: "turnInto",
    });

    act(() => {
      result.current.undo();
    });
    expect(result.current.block.type).toBe("text");
    expect(result.current.canRedo).toBe(true);
  });

  it("tracks dirty state and commits the block", () => {
    const block = createTextBlock({ content: "a" });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useBlockEditor({ value: block, onCommit }));

    act(() => {
      result.current.update({ content: textContent("b") });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.commit();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect((onCommit.mock.calls[0]![0] as TextBlock).content).toEqual(textContent("b"));
    expect(result.current.isDirty).toBe(false);
  });

  it("a new value reference switches blocks and resets history", () => {
    const block = createTextBlock({ content: "a" });
    const { result, rerender } = renderHook(
      (props: UseBlockEditorOptions) => useBlockEditor(props),
      { initialProps: { value: block as Block } },
    );

    act(() => {
      result.current.update({ content: textContent("edited") });
    });
    expect(result.current.canUndo).toBe(true);

    const fresh = createTextBlock({ content: "fresh" });
    rerender({ value: fresh });

    expect(result.current.block).toBe(fresh);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it("selection works within the block", () => {
    const block = createTextBlock({ content: "hello" });
    const { result } = renderHook(() => useBlockEditor({ value: block }));

    act(() => {
      result.current.setSelection({ type: "text", blockId: block.id, anchor: 0, focus: 99 });
    });
    expect(result.current.selection).toMatchObject({ anchor: 0, focus: 5 }); // clamped
  });
});
