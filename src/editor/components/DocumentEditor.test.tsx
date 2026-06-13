// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHeadingBlock, createTableBlock, createTextBlock } from "../core/factories";
import { SCHEMA_VERSION, type Block, type TextBlock, type WealthyDocument } from "../core/schema";
import { setCaretOffset } from "./dom";
import { DocumentEditor } from "./DocumentEditor";

// Unmount after each test so renders don't accumulate in the shared jsdom
// document (otherwise document-wide queries can pick up a prior test's nodes).
afterEach(cleanup);

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
    let latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect((latest.blocks[0] as ReturnType<typeof createTableBlock>).rows).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    latest = onChange.mock.lastCall![0] as WealthyDocument;
    const widened = latest.blocks[0] as ReturnType<typeof createTableBlock>;
    expect(widened.columns).toHaveLength(3);
    for (const row of widened.rows) {
      expect(row.cells).toHaveLength(3);
    }

    fireEvent.click(screen.getByRole("button", { name: "Remove column" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove row" }));
    latest = onChange.mock.lastCall![0] as WealthyDocument;
    const shrunk = latest.blocks[0] as ReturnType<typeof createTableBlock>;
    expect(shrunk.columns).toHaveLength(2);
    expect(shrunk.rows).toHaveLength(1);
    expect(container.querySelectorAll("td")).toHaveLength(2);
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

  it("apiRef exposes commands: host can insert a placeholder chip at the caret", () => {
    const block = createTextBlock({ content: "hello" });
    const onChange = vi.fn();
    let api: import("../hooks/useDocumentEditor").DocumentEditorApi | null = null;
    render(
      <DocumentEditor
        value={docWith([block])}
        onChange={onChange}
        apiRef={(value) => {
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

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
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

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
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
    let latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "object", kind: "mention", data: { name: "ana" } },
    ]);
    unmount();

    const plain = createTextBlock({ content: "" });
    const onChangeDisabled = vi.fn();
    render(<DocumentEditor value={docWith([plain])} onChange={onChangeDisabled} inlineTagToNode={false} />);
    typeInto(getBlockElement(plain.id), "{{ana}}", 7);
    latest = onChangeDisabled.mock.lastCall![0] as WealthyDocument;
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

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "object", kind: "placeholder", data: { label: "Campo" } },
    ]);
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
    fireEvent.mouseDown(container.querySelector(".wte-inline-object")!);
    expect(within(container).getByRole("dialog")).toBeTruthy();

    fireEvent.change(within(container).getByLabelText("fill"), { target: { value: "Ana" } });
    const latest = onChange.mock.lastCall![0] as WealthyDocument;
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

    fireEvent.mouseDown(container.querySelector(".wte-inline-object")!);
    fireEvent.click(within(container).getByRole("button", { name: "remove-chip" }));

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
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
        apiRef={(value) => {
          api = value;
        }}
        plugins={[{ name: "tb", toolbarItems: [{ id: "star", label: "★", title: "Star", apply: () => applied() }] }]}
      />,
    );

    // A non-collapsed text selection brings up the floating toolbar.
    act(() => api!.setSelection({ type: "text", blockId: block.id, anchor: 0, focus: 3 }));
    const star = within(container).getByRole("button", { name: "★" });
    fireEvent.mouseDown(star);
    expect(applied).toHaveBeenCalledTimes(1);
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

    const latest = onChange.mock.lastCall![0] as WealthyDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([
      { type: "object", kind: "placeholder", data: { label: "Campo" } },
    ]);
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
