// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { InlineNode } from "../core/schema";
import { InlineEditor, type InlineEditorHandle } from "./InlineEditor";

afterEach(cleanup);

describe("InlineEditor host-element swap (heading re-level on drag)", () => {
  it("keeps its text when the tag changes (h2 -> h3) with the same content reference", () => {
    const content: InlineNode[] = [{ type: "text", text: "My title" }];
    const ref = createRef<InlineEditorHandle>();

    const { rerender, container } = render(
      <InlineEditor ref={ref} as="h2" content={content} onContentChange={() => {}} />,
    );

    expect(container.querySelector("h2")?.textContent).toBe("My title");

    // moveSection re-levels: a NEW heading object but the SAME content array.
    rerender(<InlineEditor ref={ref} as="h3" content={content} onContentChange={() => {}} />);

    const h3 = container.querySelector("h3");
    expect(h3).not.toBeNull();
    expect(h3?.textContent).toBe("My title");
  });
});
