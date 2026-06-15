// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageBlock, createTableBlock, createTextBlock } from "../core/factories";
import type { Block, ImageBlock, TableBlock, TextBlock } from "../core/schema";
import { setCaretOffset } from "./dom";
import { BlockEditor } from "./BlockEditor";

afterEach(cleanup);

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

  it("commits when focus leaves the editor", () => {
    const block = createTextBlock({ content: "hello" });
    const onCommit = vi.fn();
    const { container } = render(<BlockEditor value={block} onCommit={onCommit} />);

    const element = container.querySelector(".wte-inline-editor") as HTMLElement;
    element.focus();
    element.textContent = "hello!";
    setCaretOffset(element, 6);
    fireEvent.input(element);
    fireEvent.blur(element, { relatedTarget: document.body });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect((onCommit.mock.lastCall![0] as TextBlock).content).toEqual([{ type: "text", text: "hello!" }]);
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

  it("edits image captions", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const onChange = vi.fn();
    const { container } = render(<BlockEditor value={image as Block} onChange={onChange} />);

    const caption = container.querySelector("figcaption.wte-inline-editor") as HTMLElement;
    caption.textContent = "caption";
    fireEvent.input(caption);

    expect((onChange.mock.lastCall![0] as ImageBlock).caption).toEqual([{ type: "text", text: "caption" }]);
  });
});
