// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextBlock } from "../core/factories";
import { SCHEMA_VERSION, type TextBlock, type MogulDocument } from "../core/schema";
import { setCaretOffset } from "./dom";
import { DocumentEditor } from "./DocumentEditor";

afterEach(cleanup);

describe("typing coalescing through the component stack", () => {
  it("one Ctrl+Z reverts a whole typing run (uncontrolled)", () => {
    const block = createTextBlock({ content: "" });
    const value: MogulDocument = { schemaVersion: SCHEMA_VERSION, blocks: [block] };
    const onChange = vi.fn();
    const { container } = render(<DocumentEditor value={value} onChange={onChange} />);

    const element = container.querySelector(".wte-inline-editor") as HTMLElement;
    element.focus();
    for (const text of ["a", "ab", "abc"]) {
      element.textContent = text;
      setCaretOffset(element, text.length);
      fireEvent.input(element);
    }

    fireEvent.keyDown(container.querySelector(".wte-editor")!, { key: "z", ctrlKey: true });

    const latest = onChange.mock.lastCall![0] as MogulDocument;
    expect((latest.blocks[0] as TextBlock).content).toEqual([]);
  });

  it("one Ctrl+Z reverts a whole typing run (StrictMode + controlled echo, like the demo)", () => {
    const block = createTextBlock({ content: "" });
    const initial: MogulDocument = { schemaVersion: SCHEMA_VERSION, blocks: [block] };
    let latest: MogulDocument = initial;

    function Controlled() {
      const [doc, setDoc] = useState(initial);
      return (
        <DocumentEditor
          value={doc}
          onChange={(next) => {
            latest = next;
            setDoc(next);
          }}
        />
      );
    }

    const { container } = render(
      <StrictMode>
        <Controlled />
      </StrictMode>,
    );

    const element = container.querySelector(".wte-inline-editor") as HTMLElement;
    element.focus();
    for (const text of ["a", "ab", "abc"]) {
      element.textContent = text;
      setCaretOffset(element, text.length);
      fireEvent.input(element);
    }

    fireEvent.keyDown(container.querySelector(".wte-editor")!, { key: "z", ctrlKey: true });

    expect((latest.blocks[0] as TextBlock).content).toEqual([]);
  });
});
