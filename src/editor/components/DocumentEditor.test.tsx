// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createHeadingBlock, createTextBlock } from "../core/factories";
import { SCHEMA_VERSION, type Block, type TextBlock, type WealthyDocument } from "../core/schema";
import { setCaretOffset } from "./dom";
import { DocumentEditor } from "./DocumentEditor";

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

function getBlockElement(blockId: string): HTMLElement {
  const element = document.querySelector(`[data-block-id="${blockId}"] .wte-inline-editor`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No inline editor for block ${blockId}`);
  }
  return element;
}

/** Simulates native-first typing: mutate the DOM, then fire input. */
function typeInto(element: HTMLElement, text: string, caret?: number): void {
  element.focus();
  element.textContent = text;
  setCaretOffset(element, caret ?? text.length);
  fireEvent.input(element);
}

describe("DocumentEditor", () => {
  it("renders heading levels, list markers, and computed list numbers", () => {
    const h2 = createHeadingBlock({ level: 2, content: "Title" });
    const bullet = createTextBlock({ variant: "bullet", content: "item b" });
    const one = createTextBlock({ variant: "numbered", content: "first" });
    const two = createTextBlock({ variant: "numbered", content: "second" });
    const { container } = render(<DocumentEditor value={docWith([h2, bullet, one, two])} />);

    expect(container.querySelector("h2.wte-inline-editor")?.textContent).toBe("Title");
    const markers = Array.from(container.querySelectorAll(".wte-block__marker")).map((el) => el.textContent);
    expect(markers).toEqual(["•", "1.", "2."]);
  });

  it("typing flows DOM → model via the input event (D16)", () => {
    const block = createTextBlock({ content: "hello" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    typeInto(getBlockElement(block.id), "hello world");

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("Enter splits the block and Backspace at start merges back", () => {
    const block = createTextBlock({ content: "hello world" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    const element = getBlockElement(block.id);
    element.focus();
    setCaretOffset(element, 5);
    fireEvent.keyDown(element, { key: "Enter" });

    let latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks).toHaveLength(2);
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "hello" }]);
    expect((latest.blocks[1] as TextBlock).content).toEqual([{ type: "text", text: " world" }]);

    const second = getBlockElement(latest.blocks[1]!.id);
    second.focus();
    setCaretOffset(second, 0);
    fireEvent.keyDown(second, { key: "Backspace" });

    latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks).toHaveLength(1);
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("Backspace at start reverts bullet → paragraph before merging (D11)", () => {
    const bullet = createTextBlock({ variant: "bullet", content: "item" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([createTextBlock({ content: "above" }), bullet])} onChange={onChange} />);

    const element = getBlockElement(bullet.id);
    element.focus();
    setCaretOffset(element, 0);
    fireEvent.keyDown(element, { key: "Backspace" });

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks[1]).toMatchObject({ variant: "paragraph" });
  });

  it("Tab indents and Shift+Tab outdents list blocks", () => {
    const bullet = createTextBlock({ variant: "bullet", content: "item" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([bullet])} onChange={onChange} />);

    const element = getBlockElement(bullet.id);
    fireEvent.keyDown(element, { key: "Tab" });
    expect((onChange.mock.lastCall![0] as WealthyDocument).blocks[0]).toMatchObject({ indent: 1 });

    fireEvent.keyDown(element, { key: "Tab", shiftKey: true });
    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect("indent" in latest.blocks[0]!).toBe(false);
  });

  it("markdown input rule: '## ' converts the paragraph to an H2 (D11)", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    typeInto(getBlockElement(block.id), "## ", 3);

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks[0]).toMatchObject({ type: "heading", level: 2, content: [] });
  });

  it("markdown input rule: '- ' converts to a bullet and keeps the rest", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    // User typed "- " at the start of "task" (caret after the space).
    typeInto(getBlockElement(block.id), "- task", 2);

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks[0]).toMatchObject({
      type: "text",
      variant: "bullet",
      content: [{ type: "text", text: "task" }],
    });
  });

  it("slash menu opens on '/', filters, and applies a block type", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    const element = getBlockElement(block.id);
    typeInto(element, "/", 1);
    expect(screen.getByRole("listbox")).toBeTruthy();

    typeInto(element, "/head", 5);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Heading 1#", "Heading 2##", "Heading 3###"]);

    fireEvent.mouseDown(options[1]!);

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks[0]).toMatchObject({ type: "heading", level: 2, content: [] });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("slash menu: Escape closes, arrows navigate, Enter applies", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    const element = getBlockElement(block.id);
    typeInto(element, "/", 1);
    fireEvent.keyDown(element, { key: "ArrowDown" });
    fireEvent.keyDown(element, { key: "Enter" });

    // Second item is Heading 2.
    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks[0]).toMatchObject({ type: "heading", level: 2 });

    typeInto(getBlockElement(block.id), "/", 1);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(getBlockElement(block.id), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("block selection via handle click; Delete removes the range in one undo step", () => {
    const a = createTextBlock({ content: "a" });
    const b = createTextBlock({ content: "b" });
    const c = createTextBlock({ content: "c" });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([a, b, c])} onChange={onChange} />);

    const handles = container.querySelectorAll(".wte-block__handle");
    fireEvent.click(handles[0]!);
    fireEvent.click(handles[2]!, { shiftKey: true });

    expect(container.querySelectorAll(".wte-block--selected")).toHaveLength(3);

    fireEvent.keyDown(container.querySelector(".wte-editor")!, { key: "Delete" });
    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks).toHaveLength(0);
    // Single undo restores all three (atomic patch application).
    expect((onChange.mock.lastCall![1] as { origin: string }).origin).toBe("patches");
  });

  it("collapsing a heading hides its section blocks but not the heading or siblings", () => {
    const h1 = createHeadingBlock({ level: 1, content: "A" });
    const p = createTextBlock({ content: "body" });
    const h1b = createHeadingBlock({ level: 1, content: "B" });
    const { container } = render(<DocumentEditor value={docWith([h1, p, h1b])} />);

    expect(container.querySelectorAll(".wte-block")).toHaveLength(3);
    fireEvent.click(container.querySelector(".wte-block__chevron")!);
    expect(container.querySelectorAll(".wte-block")).toHaveLength(2);
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("B");
    expect(container.textContent).not.toContain("body");
  });

  it("renders heading numbers when showHeadingNumbers is on", () => {
    const h1 = createHeadingBlock({ level: 1, content: "A" });
    const h2 = createHeadingBlock({ level: 2, content: "A.1" });
    const { container } = render(<DocumentEditor value={docWith([h1, h2])} showHeadingNumbers />);

    const numbers = Array.from(container.querySelectorAll(".wte-block__number")).map((el) => el.textContent);
    expect(numbers).toEqual(["1.", "1.1."]);
  });

  it("custom blocks render via renderBlock with a working update()", () => {
    const custom = { id: crypto.randomUUID(), type: "custom" as const, kind: "callout", data: { text: "hi" } };
    const onChange = vi.fn();
    render(
      <DocumentEditor
        value={docWith([custom])}
        onChange={onChange}
        renderBlock={({ block, update }) => (
          <button type="button" onClick={() => update({ data: { text: "clicked" } })}>
            {String(block.data["text"])}
          </button>
        )}
      />,
    );

    const button = screen.getByRole("button", { name: "hi" });
    fireEvent.click(button);
    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect(latest.blocks[0]).toMatchObject({ data: { text: "clicked" } });
  });

  it("readOnly renders non-editable blocks without handles", () => {
    const block = createTextBlock({ content: "locked" });
    const { container } = render(<DocumentEditor value={docWith([block])} readOnly />);
    expect(container.querySelector(".wte-block__handle")).toBeNull();
    expect(container.querySelector(".wte-inline-editor")?.getAttribute("contenteditable")).toBe("false");
  });
});
