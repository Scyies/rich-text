// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCustomBlock, createEmptyImageGroupBlock, createHeadingBlock, createImageBlock, createImageGroupBlock, createTableBlock, createTextBlock } from "../core/factories";
import { createSeparatorBlock } from "../plugins/separator-core";
import { separatorPlugin } from "../plugins/separator";
import { SCHEMA_VERSION, type Block, type ImageBlock, type ImageGroupBlock, type TextBlock, type MogulDocument } from "../core/schema";
import { getInlineText } from "../core/inline";
import { setCaretOffset } from "./dom";
import { DocumentEditor } from "./DocumentEditor";

// Unmount after each test so renders don't accumulate in the shared jsdom
// document (otherwise document-wide queries can pick up a prior test's nodes).
afterEach(cleanup);

function docWith(blocks: Block[]): MogulDocument {
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

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("commits when focus leaves the editor", () => {
    const block = createTextBlock({ content: "hello" });
    const onCommit = vi.fn();
    render(<DocumentEditor value={docWith([block])} onCommit={onCommit} />);

    const element = getBlockElement(block.id);
    typeInto(element, "hello world");
    fireEvent.blur(element, { relatedTarget: document.body });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect((onCommit.mock.lastCall![0] as MogulDocument).blocks[0]).toMatchObject({
      content: [{ type: "text", text: "hello world" }],
    });
  });

  it("does not commit when focus moves inside the editor", () => {
    const first = createTextBlock({ content: "first" });
    const second = createTextBlock({ content: "second" });
    const onCommit = vi.fn();
    render(<DocumentEditor value={docWith([first, second])} onCommit={onCommit} />);

    const firstElement = getBlockElement(first.id);
    const secondElement = getBlockElement(second.id);
    typeInto(firstElement, "changed");
    fireEvent.blur(firstElement, { relatedTarget: secondElement });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Enter splits the block and Backspace at start merges back", () => {
    const block = createTextBlock({ content: "hello world" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    const element = getBlockElement(block.id);
    element.focus();
    setCaretOffset(element, 5);
    fireEvent.keyDown(element, { key: "Enter" });

    let latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(2);
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "hello" }]);
    expect((latest.blocks[1] as TextBlock).content).toEqual([{ type: "text", text: " world" }]);

    const second = getBlockElement(latest.blocks[1]!.id);
    second.focus();
    setCaretOffset(second, 0);
    fireEvent.keyDown(second, { key: "Backspace" });

    latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(1);
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("Enter on an empty list item exits the list instead of adding another (D2)", () => {
    const bullet = createTextBlock({ variant: "bullet", content: "" });
    const nested = createTextBlock({ variant: "bullet", content: "", indent: 1 });
    const numbered = createTextBlock({ variant: "numbered", content: "" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([bullet, nested, numbered])} onChange={onChange} />);

    // Empty top-level bullet → paragraph, no new block.
    const first = getBlockElement(bullet.id);
    first.focus();
    setCaretOffset(first, 0);
    fireEvent.keyDown(first, { key: "Enter" });
    let latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(3);
    expect(latest.blocks[0]).toMatchObject({ type: "text", variant: "paragraph" });

    // Empty nested bullet → outdent one level, still a bullet.
    const second = getBlockElement(nested.id);
    second.focus();
    setCaretOffset(second, 0);
    fireEvent.keyDown(second, { key: "Enter" });
    latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(3);
    expect(latest.blocks[1]).toMatchObject({ type: "text", variant: "bullet" });
    expect((latest.blocks[1] as TextBlock).indent ?? 0).toBe(0);

    // Empty numbered item → paragraph.
    const third = getBlockElement(numbered.id);
    third.focus();
    setCaretOffset(third, 0);
    fireEvent.keyDown(third, { key: "Enter" });
    latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(3);
    expect(latest.blocks[2]).toMatchObject({ type: "text", variant: "paragraph" });
  });

  it("Enter on a non-empty list item still splits into a new item", () => {
    const item = createTextBlock({ variant: "bullet", content: "item" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([item])} onChange={onChange} />);

    const element = getBlockElement(item.id);
    element.focus();
    setCaretOffset(element, 4);
    fireEvent.keyDown(element, { key: "Enter" });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(2);
    expect(latest.blocks[1]).toMatchObject({ type: "text", variant: "bullet" });
  });

  it("Backspace at start reverts bullet → paragraph before merging (D11)", () => {
    const bullet = createTextBlock({ variant: "bullet", content: "item" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([createTextBlock({ content: "above" }), bullet])} onChange={onChange} />);

    const element = getBlockElement(bullet.id);
    element.focus();
    setCaretOffset(element, 0);
    fireEvent.keyDown(element, { key: "Backspace" });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks[1]).toMatchObject({ variant: "paragraph" });
  });

  it("Tab indents and Shift+Tab outdents list blocks", () => {
    const bullet = createTextBlock({ variant: "bullet", content: "item" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([bullet])} onChange={onChange} />);

    const element = getBlockElement(bullet.id);
    fireEvent.keyDown(element, { key: "Tab" });
    expect((onChange.mock.lastCall![0] as MogulDocument).blocks[0]).toMatchObject({ indent: 1 });

    fireEvent.keyDown(element, { key: "Tab", shiftKey: true });
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect("indent" in latest.blocks[0]!).toBe(false);
  });

  it("markdown input rule: '## ' converts the paragraph to an H2 (D11)", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    typeInto(getBlockElement(block.id), "## ", 3);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks[0]).toMatchObject({ type: "heading", level: 2, content: [] });
  });

  it("markdown input rule: '- ' converts to a bullet and keeps the rest", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    // User typed "- " at the start of "task" (caret after the space).
    typeInto(getBlockElement(block.id), "- task", 2);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
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

    const latest = onChange.mock.lastCall![0] as MogulDocument;
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
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks[0]).toMatchObject({ type: "heading", level: 2 });

    typeInto(getBlockElement(block.id), "/", 1);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(getBlockElement(block.id), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("placeholder is offered only to the focused empty block", () => {
    const a = createTextBlock({ content: "" });
    const b = createTextBlock({ content: "" });
    render(<DocumentEditor value={docWith([a, b])} />);

    const first = getBlockElement(a.id);
    const second = getBlockElement(b.id);
    expect(first.getAttribute("data-placeholder")).toBeNull();
    expect(second.getAttribute("data-placeholder")).toBeNull();

    fireEvent.focus(first);
    expect(first.getAttribute("data-placeholder")).toBe("Type / for commands…");
    expect(second.getAttribute("data-placeholder")).toBeNull();

    fireEvent.blur(first);
    fireEvent.focus(second);
    expect(first.getAttribute("data-placeholder")).toBeNull();
    expect(second.getAttribute("data-placeholder")).toBe("Type / for commands…");
  });

  it("slash menu closes on mousedown outside the menu and its block", () => {
    const block = createTextBlock({ content: "" });
    const other = createTextBlock({ content: "elsewhere" });
    render(<DocumentEditor value={docWith([block, other])} />);

    const element = getBlockElement(block.id);
    typeInto(element, "/", 1);
    expect(screen.getByRole("listbox")).toBeTruthy();

    // Mousedown inside the menu keeps it open.
    fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(screen.queryByRole("listbox")).not.toBeNull();

    // Mousedown anywhere else closes it.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("slash menu closes when the block loses focus", () => {
    const block = createTextBlock({ content: "" });
    render(<DocumentEditor value={docWith([block])} />);

    const element = getBlockElement(block.id);
    typeInto(element, "/", 1);
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.blur(element);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("slash menu is positioned (fixed coordinates from the caret/block anchor)", () => {
    const block = createTextBlock({ content: "" });
    render(<DocumentEditor value={docWith([block])} />);

    typeInto(getBlockElement(block.id), "/", 1);
    const menu = screen.getByRole("listbox") as HTMLElement;
    expect(menu.style.top).not.toBe("");
    expect(menu.style.left).not.toBe("");
  });

  it("table controls add and remove rows and columns", () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([table])} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    let latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as ReturnType<typeof createTableBlock>).rows).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    latest = onChange.mock.lastCall![0] as MogulDocument;
    const widened = latest.blocks[0] as ReturnType<typeof createTableBlock>;
    expect(widened.columns).toHaveLength(3);
    for (const row of widened.rows) {
      expect(row.cells).toHaveLength(3);
    }

    fireEvent.click(screen.getByRole("button", { name: "Remove column" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove row" }));
    latest = onChange.mock.lastCall![0] as MogulDocument;
    const shrunk = latest.blocks[0] as ReturnType<typeof createTableBlock>;
    expect(shrunk.columns).toHaveLength(2);
    expect(shrunk.rows).toHaveLength(1);
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("renders table cells by column id, not cell array order", () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false });
    const [firstColumn, secondColumn] = table.columns;
    const row = table.rows[0]!;
    const firstCell = row.cells.find((cell) => cell.columnId === firstColumn!.id)!;
    const secondCell = row.cells.find((cell) => cell.columnId === secondColumn!.id)!;
    const shuffledTable = {
      ...table,
      rows: [
        {
          ...row,
          cells: [
            { ...secondCell, blocks: [createTextBlock({ content: "second column" })] },
            { ...firstCell, blocks: [createTextBlock({ content: "first column" })] },
          ],
        },
      ],
    };

    const { container } = render(<DocumentEditor value={docWith([shuffledTable])} />);

    const cells = Array.from(container.querySelectorAll("td")).map((cell) => cell.textContent);
    expect(cells).toEqual(["first column", "second column"]);
  });

  it("renders image blocks and edits captions", () => {
    const image = createImageBlock({
      source: { type: "url", url: "https://example.com/photo.png" },
      altText: "Photo",
      caption: "Initial",
      size: { width: 320, unit: "px" },
      align: "center",
    });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([image])} onChange={onChange} />);

    const img = container.querySelector(".wte-image__media") as HTMLImageElement;
    expect(img.src).toBe("https://example.com/photo.png");
    expect(img.alt).toBe("Photo");
    expect(img.style.width).toBe("320px");

    const caption = container.querySelector("figcaption.wte-inline-editor") as HTMLElement;
    caption.textContent = "Updated";
    fireEvent.input(caption);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as ImageBlock).caption).toEqual([{ type: "text", text: "Updated" }]);
  });

  it("resolves asset-backed image blocks through the host resolver", () => {
    const image = createImageBlock({ source: { type: "asset", id: "asset-1" }, altText: "Asset" });
    const { container } = render(
      <DocumentEditor
        value={docWith([image])}
        resolveImageSource={(block) => (block.source.type === "asset" ? `https://cdn.example/${block.source.id}.png` : undefined)}
      />,
    );
    expect((container.querySelector(".wte-image__media") as HTMLImageElement).src).toBe("https://cdn.example/asset-1.png");
  });

  it("resolves asset-backed image group entries through the image content resolver", () => {
    const group = createImageGroupBlock({
      images: [{ source: { type: "asset", id: "asset-1" }, altText: "Asset" }],
    });
    const resolveImageSource = vi.fn();
    const { container } = render(
      <DocumentEditor
        value={docWith([group])}
        resolveImageSource={resolveImageSource}
        resolveImageContentSource={(entry) =>
          entry.source.type === "asset" ? `https://cdn.example/${entry.source.id}.png` : undefined
        }
      />,
    );

    expect((container.querySelector(".wte-image__media") as HTMLImageElement).src).toBe("https://cdn.example/asset-1.png");
    expect(resolveImageSource).not.toHaveBeenCalled();
  });

  it("Backspace at the start of an empty caption deletes the image", () => {
    const para = createTextBlock({ content: "before" });
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([para, image])} onChange={onChange} />);

    const caption = getBlockElement(image.id);
    caption.focus();
    setCaretOffset(caption, 0);
    fireEvent.keyDown(caption, { key: "Backspace" });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks.map((b) => b.type)).toEqual(["text"]);
  });

  it("Backspace in a non-empty caption keeps the image (no merge target)", () => {
    const image = createImageBlock({
      source: { type: "url", url: "https://example.com/a.png" },
      caption: "Cap",
    });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([image])} onChange={onChange} />);

    const caption = getBlockElement(image.id);
    caption.focus();
    setCaretOffset(caption, 0);
    fireEvent.keyDown(caption, { key: "Backspace" });

    expect(container.querySelectorAll(".wte-image")).toHaveLength(1);
  });

  it("Enter in a caption exits the image into a new paragraph below it", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([image])} onChange={onChange} />);

    const caption = getBlockElement(image.id);
    caption.focus();
    setCaretOffset(caption, 0);
    fireEvent.keyDown(caption, { key: "Enter" });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks.map((b) => b.type)).toEqual(["image", "text"]);
  });

  it("ArrowDown/ArrowUp navigates into and out of an image caption", () => {
    const para = createTextBlock({ content: "above" });
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    render(<DocumentEditor value={docWith([para, image])} />);

    const above = getBlockElement(para.id);
    const caption = getBlockElement(image.id);
    above.focus();
    setCaretOffset(above, 2);
    fireEvent.keyDown(above, { key: "ArrowDown" });
    expect(document.activeElement).toBe(caption);

    fireEvent.keyDown(caption, { key: "ArrowUp" });
    expect(document.activeElement).toBe(above);
  });

  it("edits the targeted entry caption in an image group", () => {
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" }, caption: "A" },
        { source: { type: "url", url: "https://example.com/b.png" }, caption: "B" },
      ],
    });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([group])} onChange={onChange} />);

    const captions = container.querySelectorAll("figcaption.wte-inline-editor");
    expect(captions).toHaveLength(2);
    const second = captions[1] as HTMLElement;
    second.textContent = "B updated";
    fireEvent.input(second);

    const images = (onChange.mock.lastCall![0] as MogulDocument).blocks[0] as ImageGroupBlock;
    expect(images.images[0]!.caption).toEqual([{ type: "text", text: "A" }]);
    expect(images.images[1]!.caption).toEqual([{ type: "text", text: "B updated" }]);
  });

  it("ArrowDown/ArrowUp navigates into and out of an image group caption", () => {
    const para = createTextBlock({ content: "above" });
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" } },
        { source: { type: "url", url: "https://example.com/b.png" } },
      ],
    });
    const { container } = render(<DocumentEditor value={docWith([para, group])} />);

    const above = getBlockElement(para.id);
    const firstCaption = container.querySelector("figcaption.wte-inline-editor") as HTMLElement;
    above.focus();
    setCaretOffset(above, 2);
    fireEvent.keyDown(above, { key: "ArrowDown" });
    expect(document.activeElement).toBe(firstCaption);

    fireEvent.keyDown(firstCaption, { key: "ArrowUp" });
    expect(document.activeElement).toBe(above);
  });

  it("Enter in an image group caption exits into a new paragraph below it", () => {
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" } },
        { source: { type: "url", url: "https://example.com/b.png" } },
      ],
    });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([group])} onChange={onChange} />);

    const caption = container.querySelector("figcaption.wte-inline-editor") as HTMLElement;
    caption.focus();
    setCaretOffset(caption, 0);
    fireEvent.keyDown(caption, { key: "Enter" });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks.map((b) => b.type)).toEqual(["imageGroup", "text"]);
  });

  it("Backspace in an empty group caption removes the entry, collapsing to an image at one", () => {
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" } },
        { source: { type: "url", url: "https://example.com/b.png" } },
      ],
    });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([group])} onChange={onChange} />);

    const second = container.querySelectorAll("figcaption.wte-inline-editor")[1] as HTMLElement;
    second.focus();
    setCaretOffset(second, 0);
    fireEvent.keyDown(second, { key: "Backspace" });

    // 2 -> 1 collapses the group to a plain image block.
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks.map((b) => b.type)).toEqual(["image"]);
  });

  it("inserts an empty image-row grid via the /image row slash item", async () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    const onUploadImage = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} onUploadImage={onUploadImage} />);

    const element = getBlockElement(block.id);
    typeInto(element, "/", 1);
    typeInto(element, "/image", 6);
    const rowOption = screen.getAllByRole("option").find((option) => option.textContent?.startsWith("Image row"));
    expect(rowOption).toBeTruthy();
    fireEvent.mouseDown(rowOption!);

    await waitFor(() => {
      const latest = onChange.mock.lastCall![0] as MogulDocument;
      const group = latest.blocks.find((candidate) => candidate.type === "imageGroup");
      expect(group).toBeTruthy();
      // Two empty drop slots, no predetermined image.
      expect(group?.type === "imageGroup" && group.images.length).toBe(2);
      expect(group?.type === "imageGroup" && group.images.every((e) => e.source.type === "empty")).toBe(true);
    });
  });

  it("hides the /image row slash item without an uploader or URL opt-in", () => {
    const block = createTextBlock({ content: "" });
    render(<DocumentEditor value={docWith([block])} />);
    const element = getBlockElement(block.id);
    typeInto(element, "/", 1);
    typeInto(element, "/image", 6);
    expect(screen.queryAllByRole("option").some((o) => o.textContent?.startsWith("Image row"))).toBe(false);
  });

  it("shows a resize handle on editable images but not in read-only mode", () => {
    const image = createImageBlock({ source: { type: "url", url: "https://example.com/a.png" } });
    const editable = render(<DocumentEditor value={docWith([image])} />);
    expect(editable.container.querySelector(".wte-image__resize-handle")).not.toBeNull();
    editable.unmount();

    const readonly = render(<DocumentEditor value={docWith([image])} readOnly />);
    expect(readonly.container.querySelector(".wte-image__resize-handle")).toBeNull();
  });

  it("resizes images from the keyboard", () => {
    const image = createImageBlock({
      source: { type: "url", url: "https://example.com/a.png" },
      size: { width: 50, unit: "percent" },
    });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([image])} onChange={onChange} />);
    const handle = container.querySelector(".wte-image__resize-handle") as HTMLButtonElement;

    fireEvent.keyDown(handle, { key: "ArrowRight" });

    const latest = (onChange.mock.lastCall![0] as MogulDocument).blocks[0] as ImageBlock;
    expect(latest.size).toEqual({ width: 55, unit: "percent" });
  });

  it("resizes image group entries inside their own columns", () => {
    const group = createImageGroupBlock({
      images: [
        {
          source: { type: "url", url: "https://example.com/a.png" },
          size: { width: 50, unit: "percent" },
        },
        { source: { type: "url", url: "https://example.com/b.png" } },
      ],
    });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([group])} onChange={onChange} />);

    const items = container.querySelectorAll(".wte-image-group__item");
    const firstItem = items[0] as HTMLElement;
    const firstFrame = firstItem.querySelector(".wte-image__frame") as HTMLElement;
    const firstHandle = firstItem.querySelector(".wte-image__resize-handle") as HTMLButtonElement;
    expect(firstFrame.style.width).toBe("50%");
    expect(items[1]!.querySelector(".wte-image__frame")?.getAttribute("style") ?? "").not.toContain("width");

    Object.defineProperty(firstItem, "clientWidth", { configurable: true, value: 200 });
    firstFrame.getBoundingClientRect = () => ({ width: 100 }) as DOMRect;

    fireEvent.pointerDown(firstHandle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(firstHandle, { clientX: 40, pointerId: 1 });
    fireEvent.pointerUp(firstHandle, { clientX: 40, pointerId: 1 });

    const latest = (onChange.mock.lastCall![0] as MogulDocument).blocks[0] as ImageGroupBlock;
    expect(latest.images[0]!.size).toEqual({ width: 70, unit: "percent" });
    expect(latest.images[1]!.size).toBeUndefined();
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
    const latest = onChange.mock.lastCall![0] as MogulDocument;
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
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks[0]).toMatchObject({ data: { text: "clicked" } });
  });

  it("a single ArrowDown/ArrowUp at the boundary line jumps between blocks", () => {
    const a = createTextBlock({ content: "first" });
    const b = createTextBlock({ content: "second" });
    render(<DocumentEditor value={docWith([a, b])} />);

    const first = getBlockElement(a.id);
    const second = getBlockElement(b.id);
    first.focus();
    setCaretOffset(first, 2); // mid-text — but single-line, so one press jumps
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });

  it("ref exposes commands: host can insert a placeholder chip at the caret", () => {
    const block = createTextBlock({ content: "hello" });
    const onChange = vi.fn();
    let api: import("../hooks/useDocumentEditor").DocumentEditorApi | null = null;
    render(
      <DocumentEditor
        value={docWith([block])}
        onChange={onChange}
        ref={(value) => {
          api = value;
        }}
      />,
    );

    expect(api).not.toBeNull();
    let caret = 0;
    act(() => {
      caret = api!.commands.insertInlineNode(block.id, 5, {
        type: "object",
        kind: "placeholder",
        data: { key: "client", label: "Cliente" },
      });
    });
    expect(caret).toBe(6);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "text", text: "hello" },
      { type: "object", kind: "placeholder", data: { key: "client", label: "Cliente" } },
    ]);
    // Chip renders as an atomic contenteditable=false element.
    const chip = document.querySelector(".wte-inline-object");
    expect(chip?.getAttribute("contenteditable")).toBe("false");
    expect(chip?.textContent).toBe("Cliente");
  });

  it("typing {{Cliente}} converts to a placeholder chip with slugified key", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    typeInto(getBlockElement(block.id), "O cliente {{Nome do Cliente}}", 29);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "text", text: "O cliente " },
      { type: "object", kind: "placeholder", data: { key: "nome_do_cliente", label: "Nome do Cliente" } },
    ]);
  });

  it("inlineTagToNode can be customized or disabled", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    const { unmount } = render(
      <DocumentEditor
        value={docWith([block])}
        onChange={onChange}
        inlineTagToNode={(text) => ({ type: "object", kind: "mention", data: { name: text } })}
      />,
    );
    typeInto(getBlockElement(block.id), "{{ana}}", 7);
    let latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "object", kind: "mention", data: { name: "ana" } },
    ]);
    unmount();

    const plain = createTextBlock({ content: "" });
    const onChangeDisabled = vi.fn();
    render(<DocumentEditor value={docWith([plain])} onChange={onChangeDisabled} inlineTagToNode={false} />);
    typeInto(getBlockElement(plain.id), "{{ana}}", 7);
    latest = onChangeDisabled.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "{{ana}}" }]);
  });

  it("custom slash items appear in the menu and apply with the query", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    render(
      <DocumentEditor
        value={docWith([block])}
        onChange={onChange}
        slashItems={[
          {
            id: "placeholder",
            label: "Placeholder",
            keywords: ["campo"],
            apply: ({ insertInlineNode, query }) =>
              insertInlineNode({ type: "object", kind: "placeholder", data: { label: query || "Campo" } }),
          },
        ]}
      />,
    );

    const element = getBlockElement(block.id);
    typeInto(element, "/", 1);
    const option = screen.getAllByRole("option").find((candidate) => candidate.textContent === "Placeholder");
    expect(option).toBeTruthy();
    fireEvent.mouseDown(option!);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "object", kind: "placeholder", data: { label: "Campo" } },
    ]);
  });

  it("no longer offers a single /image slash item (images come from drop/paste)", () => {
    const block = createTextBlock({ content: "" });
    render(<DocumentEditor value={docWith([block])} onUploadImage={vi.fn()} />);

    const element = getBlockElement(block.id);
    typeInto(element, "/", 1);
    typeInto(element, "/img", 4);
    // The "Image row" item still matches "img", but the single "Image" does not.
    expect(screen.queryAllByRole("option").some((o) => o.textContent === "Imageimg")).toBe(false);
  });

  it("readOnly renders non-editable blocks without handles", () => {
    const block = createTextBlock({ content: "locked" });
    const { container } = render(<DocumentEditor value={docWith([block])} readOnly />);
    expect(container.querySelector(".wte-block__handle")).toBeNull();
    expect(container.querySelector(".wte-inline-editor")?.getAttribute("contenteditable")).toBe("false");
  });
});

describe("DocumentEditor — plugins (D5/D6)", () => {
  function chipBlock() {
    return createTextBlock({
      content: [
        { type: "text", text: "Olá " },
        { type: "object", kind: "placeholder", data: { key: "nome", label: "Nome" } },
      ],
    });
  }

  const fillablePlaceholder: import("../plugins/types").EditorPlugin = {
    name: "placeholder",
    inlineObjects: [
      {
        kind: "placeholder",
        getLabel: (node) =>
          typeof node.data["value"] === "string" && node.data["value"].length > 0
            ? node.data["value"]
            : `{${String(node.data["label"] ?? node.kind)}}`,
        getClassName: (node) => (node.data["value"] !== undefined ? "filled" : "empty"),
        renderEditor: (node, { update, remove }) => (
          <div>
            <input
              aria-label="fill"
              defaultValue={typeof node.data["value"] === "string" ? node.data["value"] : ""}
              onChange={(event) => update({ data: { ...node.data, value: event.currentTarget.value } })}
            />
            <button type="button" onClick={remove}>
              remove-chip
            </button>
          </div>
        ),
      },
    ],
  };

  it("renders a custom block via a plugin blockType (and overrides renderBlock)", () => {
    const custom = { id: crypto.randomUUID(), type: "custom" as const, kind: "callout", data: { text: "from-plugin" } };
    const { container } = render(
      <DocumentEditor
        value={docWith([custom])}
        renderBlock={() => <span>from-prop</span>}
        plugins={[
          { name: "callouts", blockTypes: [{ kind: "callout", render: ({ block }) => <span>{String(block.data["text"])}</span> }] },
        ]}
      />,
    );
    expect(within(container).getByText("from-plugin")).toBeTruthy();
    expect(within(container).queryByText("from-prop")).toBeNull();
  });

  it("renders a chip with the plugin's label/class and the interactive marker", () => {
    const { container } = render(<DocumentEditor value={docWith([chipBlock()])} plugins={[fillablePlaceholder]} />);
    const chip = container.querySelector(".wte-inline-object")!;
    expect(chip.textContent).toBe("{Nome}");
    expect(chip.className).toContain("empty");
    expect(chip.className).toContain("wte-inline-object--interactive");
  });

  it("clicking an interactive chip opens its popover; filling it updates the model", () => {
    const block = chipBlock();
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([block])} onChange={onChange} plugins={[fillablePlaceholder]} />,
    );

    expect(within(container).queryByRole("dialog")).toBeNull();
    fireEvent.pointerDown(container.querySelector(".wte-inline-object")!, { pointerId: 1, button: 0 });
    expect(within(container).getByRole("dialog")).toBeTruthy();

    fireEvent.change(within(container).getByLabelText("fill"), { target: { value: "Ana" } });
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content[1]).toMatchObject({
      kind: "placeholder",
      data: { key: "nome", label: "Nome", value: "Ana" },
    });
    // The chip's visible label now reflects the filled value.
    expect(container.querySelector(".wte-inline-object")!.textContent).toBe("Ana");
  });

  it("the popover's remove() deletes the chip", () => {
    const block = chipBlock();
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([block])} onChange={onChange} plugins={[fillablePlaceholder]} />,
    );

    fireEvent.pointerDown(container.querySelector(".wte-inline-object")!, { pointerId: 1, button: 0 });
    fireEvent.click(within(container).getByRole("button", { name: "remove-chip" }));

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "Olá " }]);
    expect(within(container).queryByRole("dialog")).toBeNull();
  });

  it("a non-interactive chip (no renderEditor) does not open a popover", () => {
    const plugin: import("../plugins/types").EditorPlugin = {
      name: "static",
      inlineObjects: [{ kind: "placeholder", getLabel: () => "static" }],
    };
    const { container } = render(<DocumentEditor value={docWith([chipBlock()])} plugins={[plugin]} />);
    const chip = container.querySelector(".wte-inline-object")!;
    expect(chip.className).not.toContain("wte-inline-object--interactive");
    fireEvent.mouseDown(chip);
    expect(within(container).queryByRole("dialog")).toBeNull();
  });

  it("a plugin toolbar item renders in the floating toolbar over a selection and fires", () => {
    const block = createTextBlock({ content: "abcdef" });
    const applied = vi.fn();
    let api: import("../hooks/useDocumentEditor").DocumentEditorApi | null = null;
    const { container } = render(
      <DocumentEditor
        value={docWith([block])}
        ref={(value) => {
          api = value;
        }}
        plugins={[{ name: "tb", toolbarItems: [{ id: "star", label: "★", title: "Star", apply: () => applied() }] }]}
      />,
    );

    // A non-collapsed text selection brings up the floating toolbar.
    act(() => api!.setSelection({ type: "text", anchor: { blockId: block.id, offset: 0 }, focus: { blockId: block.id, offset: 3 } }));
    const star = within(container).getByRole("button", { name: "★" });
    fireEvent.mouseDown(star);
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("does not re-render an unchanged sibling block while typing", () => {
    const text = createTextBlock({ content: "before" });
    const custom = createCustomBlock({ kind: "render-count", data: {} });
    const renderBlock = vi.fn(() => <div>stable sibling</div>);
    render(<DocumentEditor value={docWith([text, custom])} renderBlock={renderBlock} />);
    expect(renderBlock).toHaveBeenCalledTimes(1);

    typeInto(getBlockElement(text.id), "after");

    expect(renderBlock).toHaveBeenCalledTimes(1);
  });

  it("removes an existing AI-authored mark from the selected text", () => {
    const block = createTextBlock({
      content: [{ type: "text", text: "already bold", marks: [{ type: "bold" }] }],
    });
    const onChange = vi.fn();
    let api: import("../hooks/useDocumentEditor").DocumentEditorApi | null = null;
    const { container } = render(
      <DocumentEditor
        value={docWith([block])}
        onChange={onChange}
        ref={(value) => {
          api = value;
        }}
      />,
    );

    act(() => api!.setSelection({ type: "text", anchor: { blockId: block.id, offset: 0 }, focus: { blockId: block.id, offset: 12 } }));
    const boldButton = within(container).getByRole("button", { name: "B" });
    expect(boldButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.mouseDown(boldButton);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([{ type: "text", text: "already bold" }]);
  });

  it("turns inherited bold off instead of stacking another bold mark", () => {
    const block = createHeadingBlock({ level: 1, content: "styled heading" });
    const onChange = vi.fn();
    let api: import("../hooks/useDocumentEditor").DocumentEditorApi | null = null;
    const { container } = render(
      <DocumentEditor
        value={docWith([block])}
        onChange={onChange}
        getInheritedMarkTypes={() => new Set(["bold"])}
        ref={(value) => {
          api = value;
        }}
      />,
    );

    act(() => api!.setSelection({ type: "text", anchor: { blockId: block.id, offset: 0 }, focus: { blockId: block.id, offset: 14 } }));
    const boldButton = within(container).getByRole("button", { name: "B" });
    expect(boldButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.mouseDown(boldButton);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "text", text: "styled heading", marks: [{ type: "bold", enabled: false }] },
    ]);
  });

  it("a plugin slash item appears in the menu and applies", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor
        value={docWith([block])}
        onChange={onChange}
        plugins={[
          {
            name: "ph",
            slashItems: [
              {
                id: "ph-insert",
                label: "Campo",
                keywords: ["placeholder"],
                apply: ({ insertInlineNode }) =>
                  insertInlineNode({ type: "object", kind: "placeholder", data: { label: "Campo" } }),
              },
            ],
          },
        ]}
      />,
    );

    // Open the menu with "/", then confirm the plugin item is listed.
    typeInto(getBlockElement(block.id), "/", 1);
    const option = within(container)
      .getAllByRole("option")
      .find((candidate) => candidate.textContent?.includes("Campo"));
    expect(option).toBeTruthy();
    fireEvent.mouseDown(option!);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "object", kind: "placeholder", data: { label: "Campo" } },
    ]);
  });

  it("shows slash items as core → host → plugin and applies host before plugin on duplicate id", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor
        value={docWith([block])}
        onChange={onChange}
        slashItems={[
          {
            id: "duplicate",
            label: "Host duplicate",
            apply: ({ insertInlineNode }) =>
              insertInlineNode({ type: "object", kind: "source", data: { source: "host" } }),
          },
        ]}
        plugins={[
          {
            name: "plugin",
            slashItems: [
              {
                id: "duplicate",
                label: "Plugin duplicate",
                apply: ({ insertInlineNode }) =>
                  insertInlineNode({ type: "object", kind: "source", data: { source: "plugin" } }),
              },
            ],
          },
        ]}
      />,
    );

    typeInto(getBlockElement(block.id), "/", 1);
    const labels = within(container).getAllByRole("option").map((option) => option.textContent);
    expect(labels.slice(0, 7)).toEqual([
      "Heading 1#",
      "Heading 2##",
      "Heading 3###",
      "Text¶",
      "Bulleted list•",
      "Numbered list1.",
      "Table⊞",
    ]);
    expect(labels.slice(7)).toEqual(["Host duplicate", "Plugin duplicate"]);

    fireEvent.mouseDown(within(container).getByText("Plugin duplicate"));

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "object", kind: "source", data: { source: "host" } },
    ]);
  });

  it("separatorPlugin renders separator blocks and adds a slash command", () => {
    const block = createTextBlock({ content: "" });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([createSeparatorBlock(), block])} onChange={onChange} plugins={[separatorPlugin]} />,
    );

    expect(container.querySelector(".wte-separator")).toBeTruthy();

    typeInto(getBlockElement(block.id), "/", 1);
    typeInto(getBlockElement(block.id), "/sep", 4);
    const option = screen.getAllByRole("option").find((candidate) => candidate.textContent?.includes("Separator"));
    expect(option).toBeTruthy();
    fireEvent.mouseDown(option!);

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks[2]).toMatchObject({ type: "custom", kind: "separator" });
  });
});

describe("DocumentEditor — paste (D11)", () => {
  type Api = import("../hooks/useDocumentEditor").DocumentEditorApi;

  function setup(blocks: Block[], props: Partial<ComponentProps<typeof DocumentEditor>> = {}) {
    const onChange = vi.fn();
    let api: Api | null = null;
    render(
      <DocumentEditor
        value={docWith(blocks)}
        onChange={onChange}
        {...props}
        ref={(value) => {
          api = value;
        }}
      />,
    );
    return { onChange, getApi: () => api! };
  }

  function paste(api: Api, blockId: string, offset: number, payload: { html?: string; text?: string; files?: File[] }): void {
    const element = getBlockElement(blockId);
    element.focus();
    act(() => api.setSelection({ type: "text", anchor: { blockId, offset }, focus: { blockId, offset } }));
    const clipboardData = {
      getData: (type: string) => (type === "text/html" ? (payload.html ?? "") : (payload.text ?? "")),
      files: payload.files ?? [],
      items: [],
    };
    fireEvent.paste(element, { clipboardData });
  }

  function summary(doc: MogulDocument): string[] {
    return doc.blocks.map((block) =>
      block.type === "text" || block.type === "heading"
        ? block.content.map((node) => (node.type === "text" ? node.text : "▢")).join("")
        : `[${block.type === "custom" ? block.kind : block.type}]`,
    );
  }

  it("pastes multi-line plain text as paragraphs after the caret", () => {
    const block = createTextBlock({ content: "abc" });
    const { onChange, getApi } = setup([block]);
    paste(getApi(), block.id, 3, { text: "X\nY" });
    expect(summary(onChange.mock.lastCall![0] as MogulDocument)).toEqual(["abc", "X", "Y"]);
  });

  it("splices a single pasted paragraph inline at the caret", () => {
    const block = createTextBlock({ content: "abcdef" });
    const { onChange, getApi } = setup([block]);
    paste(getApi(), block.id, 3, { html: "<p>XY</p>" });
    expect(summary(onChange.mock.lastCall![0] as MogulDocument)).toEqual(["abcXYdef"]);
  });

  it("pastes rich HTML (heading + paragraph) replacing an empty line", () => {
    const block = createTextBlock({ content: "" });
    const { onChange, getApi } = setup([block]);
    paste(getApi(), block.id, 0, { html: "<h2>H</h2><p>P</p>" });
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks.map((b) => b.type)).toEqual(["heading", "text"]);
    expect(summary(latest)).toEqual(["H", "P"]);
  });

  it("maps a pasted <hr> to the separator block", () => {
    const block = createTextBlock({ content: "" });
    const { onChange, getApi } = setup([block]);
    paste(getApi(), block.id, 0, { html: "<p>a</p><hr><p>b</p>" });
    expect(summary(onChange.mock.lastCall![0] as MogulDocument)).toEqual(["a", "[separator]", "b"]);
  });

  it("pastes HTML image blocks at the caret when allowDroppedImageUrls is set", () => {
    const block = createTextBlock({ content: "abc" });
    const { onChange, getApi } = setup([block], { allowDroppedImageUrls: true });
    paste(getApi(), block.id, 3, { html: '<figure><img src="/pasted.png" alt="P"><figcaption>Caption</figcaption></figure>' });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(2);
    expect(latest.blocks[1]).toMatchObject({
      type: "image",
      source: { type: "url", url: new URL("/pasted.png", document.baseURI).href },
      altText: "P",
      caption: [{ type: "text", text: "Caption" }],
    });
  });

  it("strips pasted HTML images by default but keeps surrounding text", () => {
    const block = createTextBlock({ content: "" });
    const { onChange, getApi } = setup([block]);
    paste(getApi(), block.id, 0, { html: '<p>before</p><figure><img src="/pasted.png" alt="P"></figure><p>after</p>' });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks.some((b) => b.type === "image")).toBe(false);
    expect(summary(latest)).toEqual(["before", "after"]);
  });

  it("uploads pasted image files through the host callback", async () => {
    const block = createTextBlock({ content: "" });
    const imageFile = new File(["image"], "photo.png", { type: "image/png" });
    const onUploadImage = vi.fn(async (file: File) => ({
      source: { type: "asset" as const, id: file.name },
      altText: "Uploaded",
    }));
    const { onChange, getApi } = setup([block], { onUploadImage });

    paste(getApi(), block.id, 0, { files: [imageFile] });

    await waitFor(() => {
      const latest = onChange.mock.lastCall?.[0] as MogulDocument | undefined;
      expect(latest?.blocks[0]).toMatchObject({
        type: "image",
        source: { type: "asset", id: "photo.png" },
        altText: "Uploaded",
      });
    });
    expect(onUploadImage).toHaveBeenCalledWith(imageFile);
  });

  it("falls back to clipboard text when every image upload fails", async () => {
    const block = createTextBlock({ content: "" });
    const imageFile = new File(["image"], "broken.png", { type: "image/png" });
    const { onChange, getApi } = setup([block], {
      onUploadImage: vi.fn(async () => Promise.reject(new Error("upload failed"))),
    });

    paste(getApi(), block.id, 0, { files: [imageFile], text: "fallback" });

    await waitFor(() => expect(summary(onChange.mock.lastCall![0] as MogulDocument)).toEqual(["fallback"]));
  });

  it("does not replay stale paste offsets after an asynchronous upload", async () => {
    const block = createTextBlock({ content: "abc" });
    const imageFile = new File(["image"], "late.png", { type: "image/png" });
    let resolveUpload!: (value: { source: { type: "asset"; id: string } }) => void;
    const upload = new Promise<{ source: { type: "asset"; id: string } }>((resolve) => {
      resolveUpload = resolve;
    });
    const { onChange, getApi } = setup([block], { onUploadImage: vi.fn(() => upload) });

    paste(getApi(), block.id, 1, { files: [imageFile] });
    act(() => getApi().commands.updateBlock(block.id, { content: [{ type: "text", text: "changed" }] }));
    resolveUpload({ source: { type: "asset", id: "late.png" } });

    await waitFor(() => expect(summary(onChange.mock.lastCall![0] as MogulDocument)).toEqual(["changed", "[image]"]));
  });

  it("is a single undo step (atomic block paste)", () => {
    const block = createTextBlock({ content: "abc" });
    const { onChange, getApi } = setup([block]);
    paste(getApi(), block.id, 3, { text: "X\nY" });
    act(() => {
      getApi().commands.undo();
    });
    expect(summary(onChange.mock.lastCall![0] as MogulDocument)).toEqual(["abc"]);
  });

  it("drops image files using the upload callback after the target block", async () => {
    const block = createTextBlock({ content: "target" });
    const imageFile = new File(["image"], "drop.png", { type: "image/png" });
    const onUploadImage = vi.fn(async () => ({
      source: { type: "url" as const, url: "https://cdn.example/drop.png" },
      altText: "Dropped",
    }));
    const { container, onChange } = (() => {
      const onChangeInner = vi.fn();
      const rendered = render(
        <DocumentEditor value={docWith([block])} onChange={onChangeInner} onUploadImage={onUploadImage} />,
      );
      return { ...rendered, onChange: onChangeInner };
    })();

    fireEvent.drop(container.querySelector(`[data-block-id="${block.id}"]`)!, {
      clientY: 1,
      dataTransfer: {
        getData: (type: string) => (type === "text/wte-block" ? "" : ""),
        files: [imageFile],
        items: [],
      },
    });

    await waitFor(() => {
      const latest = onChange.mock.lastCall?.[0] as MogulDocument | undefined;
      expect(latest?.blocks[1]).toMatchObject({
        type: "image",
        source: { type: "url", url: "https://cdn.example/drop.png" },
        altText: "Dropped",
      });
    });
  });

  it("drops URI-list image URLs as URL image blocks when allowDroppedImageUrls is set", () => {
    const block = createTextBlock({ content: "target" });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([block])} onChange={onChange} allowDroppedImageUrls />,
    );

    fireEvent.drop(container.querySelector(`[data-block-id="${block.id}"]`)!, {
      clientY: 1,
      dataTransfer: {
        getData: (type: string) =>
          type === "text/wte-block" ? "" : type === "text/uri-list" ? "# source\nhttps://example.com/drop.png" : "",
        files: [],
        items: [],
      },
    });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks[1]).toMatchObject({
      type: "image",
      source: { type: "url", url: "https://example.com/drop.png" },
    });
  });

  it("ignores dropped image URLs by default (allowDroppedImageUrls off)", () => {
    const block = createTextBlock({ content: "target" });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([block])} onChange={onChange} />);

    fireEvent.drop(container.querySelector(`[data-block-id="${block.id}"]`)!, {
      clientY: 1,
      dataTransfer: {
        getData: (type: string) => (type === "text/uri-list" ? "https://example.com/drop.png" : ""),
        files: [],
        items: [],
      },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores non-http(s) dropped URLs instead of creating doomed image blocks", () => {
    const block = createTextBlock({ content: "target" });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([block])} onChange={onChange} allowDroppedImageUrls />,
    );

    fireEvent.drop(container.querySelector(`[data-block-id="${block.id}"]`)!, {
      clientY: 1,
      dataTransfer: {
        getData: (type: string) => (type === "text/uri-list" ? "javascript:alert(1)" : ""),
        files: [],
        items: [],
      },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not accept external drops in read-only mode", () => {
    const block = createTextBlock({ content: "target" });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([block])} onChange={onChange} readOnly />);

    fireEvent.drop(container.querySelector(`[data-block-id="${block.id}"]`)!, {
      clientY: 1,
      dataTransfer: {
        getData: (type: string) => (type === "text/uri-list" ? "https://example.com/drop.png" : ""),
        files: [],
        items: [],
      },
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DocumentEditor — cross-block text ranges", () => {
  type Api = import("../hooks/useDocumentEditor").DocumentEditorApi;

  function renderRangeEditor() {
    const first = createTextBlock({ content: "first" });
    const second = createTextBlock({ content: "last" });
    const onChange = vi.fn();
    let api: Api | null = null;
    const rendered = render(
      <DocumentEditor
        value={docWith([first, second])}
        onChange={onChange}
        ref={(value) => { api = value; }}
      />,
    );
    const select = () => {
      getBlockElement(second.id).focus();
      act(() => api!.setSelection({
        type: "text",
        anchor: { blockId: first.id, offset: 2 },
        focus: { blockId: second.id, offset: 2 },
      }));
    };
    return { ...rendered, first, second, onChange, getApi: () => api!, select };
  }

  it("copies plain text, HTML, and the structured fragment", () => {
    const { second, select } = renderRangeEditor();
    select();
    const values = new Map<string, string>();
    fireEvent.copy(getBlockElement(second.id), {
      clipboardData: { setData: (type: string, value: string) => values.set(type, value) },
    });
    expect(values.get("text/plain")).toBe("rst\nla");
    expect(values.get("text/html")).toContain("<p>rst</p>");
    expect(values.get("application/x-mogul-text+json")).toContain('"schemaVersion":1');
  });

  it("deletes and merges the range in one undoable command", () => {
    const { second, onChange, getApi, select } = renderRangeEditor();
    select();
    fireEvent.keyDown(getBlockElement(second.id), { key: "Backspace" });
    let latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(1);
    expect(getInlineText((latest.blocks[0] as TextBlock).content)).toBe("fist");
    act(() => getApi().commands.undo());
    latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(2);
  });

  it("replaces the range when pasting plain text", () => {
    const { second, onChange, select } = renderRangeEditor();
    select();
    fireEvent.paste(getBlockElement(second.id), {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "X" : "", files: [], items: [] },
    });
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(1);
    expect(getInlineText((latest.blocks[0] as TextBlock).content)).toBe("fiXst");
  });

  it("replaces a real drag range when focus remains on the anchor block", () => {
    const { first, onChange, select } = renderRangeEditor();
    select();
    // Real browser drags leave activeElement at the drag anchor even though
    // the engine focus endpoint is in the second block.
    getBlockElement(first.id).focus();
    const handled = !fireEvent.paste(getBlockElement(first.id), {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "X" : "", files: [], items: [] },
    });

    expect(handled).toBe(true);
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(1);
    expect(getInlineText((latest.blocks[0] as TextBlock).content)).toBe("fiXst");
  });

  it("does not create a mixed caption-to-block drag range", () => {
    const image = createImageBlock({
      source: { type: "url", url: "https://example.com/a.png" },
      caption: "caption",
    });
    const text = createTextBlock({ content: "text" });
    let api: Api | null = null;
    const { container } = render(
      <DocumentEditor value={docWith([image, text])} ref={(value) => { api = value; }} />,
    );
    const caption = container.querySelector("figcaption.wte-inline-editor") as HTMLElement;
    const target = getBlockElement(text.id);

    fireEvent.pointerDown(caption, { button: 0, buttons: 1, pointerId: 7, clientX: 1, clientY: 1 });
    fireEvent.pointerMove(target, { button: 0, buttons: 1, pointerId: 7, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(target, { button: 0, buttons: 0, pointerId: 7, clientX: 10, clientY: 10 });

    const selection = api!.engine.getSelection();
    expect(
      selection?.type === "text" &&
      ((selection.anchor.entryId === undefined) !== (selection.focus.entryId === undefined)),
    ).toBe(false);
    expect(() => fireEvent.keyDown(target, { key: "Backspace" })).not.toThrow();
  });

  it("applies a toolbar mark across every selected text slice", () => {
    const { container, onChange, select } = renderRangeEditor();
    select();
    fireEvent.mouseDown(within(container).getByRole("button", { name: "B" }));
    const latest = onChange.mock.lastCall![0] as MogulDocument;
    const textBlocks = latest.blocks as TextBlock[];
    expect(textBlocks.every((block) => block.content.some((node) => node.type === "text" && node.marks?.some((mark) => mark.type === "bold")))).toBe(true);
  });
});

describe("DocumentEditor — trailing non-editable block", () => {
  const separator = () => ({ id: crypto.randomUUID(), type: "custom" as const, kind: "sep", data: {} });

  it("ArrowDown past a trailing non-editable block adds and focuses a new line", () => {
    const foo = createTextBlock({ content: "foo" });
    const onChange = vi.fn();
    render(<DocumentEditor value={docWith([foo, separator()])} onChange={onChange} />);

    const element = getBlockElement(foo.id);
    element.focus();
    setCaretOffset(element, 3);
    fireEvent.keyDown(element, { key: "ArrowDown" });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(3);
    expect(latest.blocks[2]).toMatchObject({ type: "text", variant: "paragraph", content: [] });
  });

  it("renders a trailing click target that adds a line, then hides itself", () => {
    const foo = createTextBlock({ content: "foo" });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([foo, separator()])} onChange={onChange} />);

    fireEvent.click(within(container).getByRole("button", { name: "Add a line below" }));

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks).toHaveLength(3);
    expect(latest.blocks[2]).toMatchObject({ type: "text", content: [] });
    // The last block is editable again, so the affordance is gone.
    expect(within(container).queryByRole("button", { name: "Add a line below" })).toBeNull();
  });

  it("does not show the trailing affordance when the last block is editable", () => {
    const { container } = render(<DocumentEditor value={docWith([createTextBlock({ content: "only" })])} />);
    expect(within(container).queryByRole("button", { name: "Add a line below" })).toBeNull();
  });

  it("does not show the trailing affordance for a hidden collapsed-section tail", () => {
    const heading = createHeadingBlock({ level: 1, content: "A" });
    const separatorBlock = createSeparatorBlock();
    const { container } = render(<DocumentEditor value={docWith([heading, separatorBlock])} />);

    expect(within(container).getByRole("button", { name: "Add a line below" })).toBeTruthy();

    fireEvent.click(container.querySelector(".wte-block__chevron")!);

    expect(within(container).queryByRole("button", { name: "Add a line below" })).toBeNull();
  });

  it("ArrowDown from a collapsed final heading does not add a hidden line", () => {
    const heading = createHeadingBlock({ level: 1, content: "A" });
    const separatorBlock = createSeparatorBlock();
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([heading, separatorBlock])} onChange={onChange} />);

    fireEvent.click(container.querySelector(".wte-block__chevron")!);
    const element = getBlockElement(heading.id);
    element.focus();
    setCaretOffset(element, 1);
    fireEvent.keyDown(element, { key: "ArrowDown" });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DocumentEditor — image rows", () => {
  const pngUpload = (file: File) => ({
    source: { type: "url" as const, url: `https://cdn.example/${file.name}` },
    altText: file.name,
  });
  const items = (container: HTMLElement, blockId: string) =>
    Array.from(container.querySelectorAll(`[data-block-id="${blockId}"] .wte-image-group__item`));

  it("fills an empty slot from a dropped file and appends extra files as columns", async () => {
    const group = createEmptyImageGroupBlock({ columns: 2 });
    const onChange = vi.fn();
    const onUploadImage = vi.fn(async (file: File) => pngUpload(file));
    const { container } = render(
      <DocumentEditor value={docWith([group])} onChange={onChange} onUploadImage={onUploadImage} />,
    );

    const fileA = new File(["a"], "a.png", { type: "image/png" });
    const fileB = new File(["b"], "b.png", { type: "image/png" });
    fireEvent.drop(items(container, group.id)[0]!, {
      dataTransfer: { getData: () => "", files: [fileA, fileB], items: [] },
    });

    await waitFor(() => {
      const latest = onChange.mock.lastCall?.[0] as MogulDocument | undefined;
      const result = latest?.blocks[0] as ImageGroupBlock | undefined;
      // slot[0] filled with a.png, b.png appended as a new column, slot[1] still empty.
      expect(result?.images.map((e) => e.source.type)).toEqual(["url", "url", "empty"]);
      expect(result?.images[0]).toMatchObject({ source: { url: "https://cdn.example/a.png" } });
      expect(result?.images[1]).toMatchObject({ source: { url: "https://cdn.example/b.png" } });
    });
  });

  it("replaces a filled slot when an image is dropped onto it", async () => {
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/old.png" } },
        { source: { type: "url", url: "https://example.com/keep.png" } },
      ],
    });
    const onChange = vi.fn();
    const onUploadImage = vi.fn(async (file: File) => pngUpload(file));
    const { container } = render(
      <DocumentEditor value={docWith([group])} onChange={onChange} onUploadImage={onUploadImage} />,
    );

    fireEvent.drop(items(container, group.id)[0]!, {
      dataTransfer: { getData: () => "", files: [new File(["n"], "new.png", { type: "image/png" })], items: [] },
    });

    await waitFor(() => {
      const result = onChange.mock.lastCall?.[0] as MogulDocument | undefined;
      const images = (result?.blocks[0] as ImageGroupBlock | undefined)?.images;
      expect(images?.[0]).toMatchObject({ source: { url: "https://cdn.example/new.png" } });
      expect(images?.[1]).toMatchObject({ source: { url: "https://example.com/keep.png" } });
    });
  });

  it("adds and removes columns", () => {
    const group = createEmptyImageGroupBlock({ columns: 2 });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([group])} onChange={onChange} onUploadImage={vi.fn()} />,
    );

    fireEvent.mouseDown(container.querySelector(".wte-image-group__add")!);
    fireEvent.click(container.querySelector(".wte-image-group__add")!);
    let result = onChange.mock.lastCall![0] as MogulDocument;
    expect((result.blocks[0] as ImageGroupBlock).images).toHaveLength(3);

    fireEvent.click(container.querySelectorAll(".wte-image-group__remove")[0]!);
    result = onChange.mock.lastCall![0] as MogulDocument;
    expect((result.blocks[0] as ImageGroupBlock).images).toHaveLength(2);
  });

  it("rejects dropped image URLs into a slot without the opt-in, with feedback", () => {
    const group = createEmptyImageGroupBlock({ columns: 2 });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([group])} onChange={onChange} onUploadImage={vi.fn()} />,
    );

    fireEvent.drop(items(container, group.id)[0]!, {
      dataTransfer: {
        getData: (type: string) => (type === "text/uri-list" ? "https://example.com/x.png" : ""),
        files: [],
        items: [],
      },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".wte-image__feedback")?.textContent).toBe("Image links aren't allowed here");
  });

  it("prunes a moved-on empty row on blur, collapsing a one-image row to an image", () => {
    const para = createTextBlock({ content: "after" });
    const filledGroup = createImageGroupBlock({
      images: [{ source: { type: "url", url: "https://example.com/a.png" } }, { source: { type: "empty" } }],
    });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([filledGroup, para])} onChange={onChange} onUploadImage={vi.fn()} />,
    );

    // Last touched the paragraph, then leave the editor: the row is not spared.
    getBlockElement(para.id).focus();
    fireEvent.blur(container.querySelector(".wte-editor")!, { relatedTarget: document.body });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks[0]).toMatchObject({ type: "image", source: { url: "https://example.com/a.png" } });
  });

  it("spares the last-touched row on blur (user stepping out to grab a file)", () => {
    const group = createEmptyImageGroupBlock({ columns: 2 });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([group])} onChange={onChange} onUploadImage={vi.fn()} />,
    );

    // Focus a slot (as after creating the row), then leave to pick a file.
    (items(container, group.id)[0] as HTMLElement).focus();
    fireEvent.blur(container.querySelector(".wte-editor")!, { relatedTarget: document.body });

    // The row survives so the user can come back and drop into it.
    expect(items(container, group.id)).toHaveLength(2);
    expect(container.querySelectorAll(".wte-image-slot")).toHaveLength(2);
  });

  it("on blur prunes other rows but keeps the last-focused one", () => {
    const rowA = createEmptyImageGroupBlock({ columns: 2 });
    const rowB = createEmptyImageGroupBlock({ columns: 2 });
    const onChange = vi.fn();
    const { container } = render(
      <DocumentEditor value={docWith([rowA, rowB])} onChange={onChange} onUploadImage={vi.fn()} />,
    );

    (items(container, rowB.id)[0] as HTMLElement).focus();
    fireEvent.blur(container.querySelector(".wte-editor")!, { relatedTarget: document.body });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect(latest.blocks.map((b) => b.id)).toEqual([rowB.id]);
  });

  it("shows feedback on the target block when a dropped image URL is disabled", () => {
    const block = createTextBlock({ content: "target" });
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={docWith([block])} onChange={onChange} onUploadImage={vi.fn()} />);

    fireEvent.drop(container.querySelector(`[data-block-id="${block.id}"]`)!, {
      clientY: 1,
      dataTransfer: {
        getData: (type: string) => (type === "text/uri-list" ? "https://example.com/x.png" : ""),
        files: [],
        items: [],
      },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".wte-image__feedback")?.textContent).toBe("Image links aren't allowed here");
  });

  it("ArrowDown from a paragraph lands on an empty row instead of skipping it", () => {
    const para = createTextBlock({ content: "above" });
    const group = createEmptyImageGroupBlock({ columns: 2 });
    const { container } = render(<DocumentEditor value={docWith([para, group])} onUploadImage={vi.fn()} />);

    const above = getBlockElement(para.id);
    above.focus();
    setCaretOffset(above, 2);
    fireEvent.keyDown(above, { key: "ArrowDown" });

    expect(document.activeElement).toBe(items(container, group.id)[0]);
  });

  it("preserves the column when moving between empty rows with ArrowDown", () => {
    const rowA = createEmptyImageGroupBlock({ columns: 3 });
    const rowB = createEmptyImageGroupBlock({ columns: 3 });
    const { container } = render(<DocumentEditor value={docWith([rowA, rowB])} onUploadImage={vi.fn()} />);

    const secondOfA = items(container, rowA.id)[1] as HTMLElement;
    secondOfA.focus();
    fireEvent.keyDown(secondOfA, { key: "ArrowDown" });

    expect(document.activeElement).toBe(items(container, rowB.id)[1]);
  });

  it("ArrowDown between rows keeps item-surface focus even when the target column is filled", () => {
    const rowA = createEmptyImageGroupBlock({ columns: 2 });
    const rowB = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" }, caption: "A" },
        { source: { type: "url", url: "https://example.com/b.png" }, caption: "B" },
      ],
    });
    const { container } = render(<DocumentEditor value={docWith([rowA, rowB])} onUploadImage={vi.fn()} />);

    const secondOfA = items(container, rowA.id)[1] as HTMLElement;
    secondOfA.focus();
    fireEvent.keyDown(secondOfA, { key: "ArrowDown" });

    expect(document.activeElement).toBe(items(container, rowB.id)[1]);
    expect(document.activeElement).not.toBe(container.querySelectorAll("figcaption.wte-inline-editor")[1]);
  });

  it("labels item surfaces with role=group and an accessible name", () => {
    const group = createEmptyImageGroupBlock({ columns: 1 });
    const { container } = render(<DocumentEditor value={docWith([group])} onUploadImage={vi.fn()} />);
    const item = items(container, group.id)[0] as HTMLElement;
    expect(item.getAttribute("role")).toBe("group");
    expect(item.getAttribute("aria-label")).toBe("Drag or paste an image here");
  });

  it("read-only rendering omits empty slots and renders only filled images", () => {
    const group = createImageGroupBlock({
      images: [{ source: { type: "url", url: "https://example.com/a.png" } }, { source: { type: "empty" } }],
    });
    const { container } = render(<DocumentEditor value={docWith([group])} readOnly />);
    expect(items(container, group.id)).toHaveLength(1);
    expect(container.querySelector(".wte-image-slot")).toBeNull();
  });

  it("moves focus between row items with Left/Right arrows", () => {
    const group = createEmptyImageGroupBlock({ columns: 2 });
    const { container } = render(<DocumentEditor value={docWith([group])} onUploadImage={vi.fn()} />);
    const [first, second] = items(container, group.id) as HTMLElement[];

    first!.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first); // wraps
  });
});

describe("test isolation", () => {
  // Runs last: after dozens of render() calls above. If afterEach(cleanup)
  // were missing, those renders would accumulate and this count would be > 1.
  it("unmounts previous renders so only the current editor is in the document", () => {
    render(<DocumentEditor value={docWith([createTextBlock({ content: "only" })])} />);
    expect(document.querySelectorAll(".wte-editor")).toHaveLength(1);
  });
});
