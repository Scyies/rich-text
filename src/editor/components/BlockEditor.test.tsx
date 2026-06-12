// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createTableBlock, createTextBlock } from "../core/factories";
import type { Block, TableBlock, TextBlock } from "../core/schema";
import { setCaretOffset } from "./dom";
import { BlockEditor } from "./BlockEditor";

describe("BlockEditor", () => {
  it("edits a text block through the same pipeline", () => {
    const block = createTextBlock({ content: "hello" });
    const onChange = vi.fn();
    const { container } = render(<BlockEditor value={block} onChange={onChange} />);

    const element = container.querySelector(".wte-inline-editor") as HTMLElement;
    element.focus();
    element.textContent = "hello!";
    setCaretOffset(element, 6);
    fireEvent.input(element);

    expect((onChange.mock.lastCall![0] as TextBlock).content).toEqual([{ type: "text", text: "hello!" }]);
  });

  it("edits table cells", () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false });
    const onChange = vi.fn();
    const { container } = render(<BlockEditor value={table as Block} onChange={onChange} />);

    const firstCell = container.querySelector("td .wte-inline-editor") as HTMLElement;
    firstCell.textContent = "cell text";
    fireEvent.input(firstCell);

    const latest = onChange.mock.lastCall![0] as TableBlock;
    expect(latest.rows[0]!.cells[0]!.blocks[0]!.content).toEqual([{ type: "text", text: "cell text" }]);
  });
});
