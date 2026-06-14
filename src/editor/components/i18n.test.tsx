// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createTableBlock, createTextBlock } from "../core/factories";
import { SCHEMA_VERSION, type Block, type WealthyDocument } from "../core/schema";
import { DocumentEditor } from "./DocumentEditor";

afterEach(cleanup);

function docWith(blocks: Block[]): WealthyDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

describe("DocumentEditor i18n", () => {
  it("defaults to English chrome", () => {
    const { container } = render(<DocumentEditor value={docWith([createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false })])} />);
    expect(within(container).getByRole("button", { name: "Add row" })).toBeTruthy();
    expect(within(container).getByLabelText("Document editor")).toBeTruthy();
  });

  it("locale=\"pt-BR\" swaps visible labels and aria labels", () => {
    const { container } = render(<DocumentEditor value={docWith([createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false })])} locale="pt-BR" />);
    expect(within(container).getByRole("button", { name: "Adicionar linha" })).toBeTruthy();
    expect(within(container).getByLabelText("Editor de documento")).toBeTruthy();
    // English label is gone.
    expect(within(container).queryByRole("button", { name: "Add row" })).toBeNull();
  });

  it("placeholder of the focused block follows the locale", () => {
    const en = render(<DocumentEditor value={docWith([createTextBlock({ content: [] })])} />);
    const editableEn = en.container.querySelector(".wte-block--paragraph .wte-inline-editor") as HTMLElement;
    fireEvent.focus(editableEn);
    expect(editableEn.getAttribute("data-placeholder")).toBe("Type / for commands…");

    const pt = render(<DocumentEditor value={docWith([createTextBlock({ content: [] })])} locale="pt-BR" />);
    const editablePt = pt.container.querySelector(".wte-block--paragraph .wte-inline-editor") as HTMLElement;
    fireEvent.focus(editablePt);
    expect(editablePt.getAttribute("data-placeholder")).toBe("Digite / para comandos…");
  });

  it("messages override wins over the resolved locale", () => {
    const { container } = render(
      <DocumentEditor
        value={docWith([createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false })])}
        locale="pt-BR"
        messages={{ tableAddRow: "Nova fileira" }}
      />,
    );
    expect(within(container).getByRole("button", { name: "Nova fileira" })).toBeTruthy();
    // Other strings still come from the pt-BR dictionary.
    expect(within(container).getByRole("button", { name: "Adicionar coluna" })).toBeTruthy();
  });
});
