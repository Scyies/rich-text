// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableBlock } from "../core/factories";
import { en } from "../i18n/messages";
import { TableView } from "./TableView";

afterEach(cleanup);

describe("TableView structural controls", () => {
  it("removes a row when more than one remains", () => {
    const block = createTableBlock({ columnCount: 2, rowCount: 2, showHeader: false });
    const onTableChange = vi.fn();
    const { getByLabelText } = render(<TableView block={block} onTableChange={onTableChange} />);

    fireEvent.click(getByLabelText(en.tableRemoveRow));

    expect(onTableChange).toHaveBeenCalledTimes(1);
    expect(onTableChange.mock.lastCall![0].rows).toHaveLength(1);
  });

  it("refuses to remove the last row and disables the control", () => {
    const block = createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false });
    const onTableChange = vi.fn();
    const { getByLabelText } = render(<TableView block={block} onTableChange={onTableChange} />);

    const removeRow = getByLabelText(en.tableRemoveRow) as HTMLButtonElement;
    expect(removeRow.disabled).toBe(true);

    fireEvent.click(removeRow);
    expect(onTableChange).not.toHaveBeenCalled();
  });

  it("removes a column when more than one remains", () => {
    const block = createTableBlock({ columnCount: 2, rowCount: 1, showHeader: false });
    const onTableChange = vi.fn();
    const { getByLabelText } = render(<TableView block={block} onTableChange={onTableChange} />);

    fireEvent.click(getByLabelText(en.tableRemoveColumn));

    expect(onTableChange).toHaveBeenCalledTimes(1);
    expect(onTableChange.mock.lastCall![0].columns).toHaveLength(1);
  });

  it("refuses to remove the last column and disables the control", () => {
    const block = createTableBlock({ columnCount: 1, rowCount: 1, showHeader: false });
    const onTableChange = vi.fn();
    const { getByLabelText } = render(<TableView block={block} onTableChange={onTableChange} />);

    const removeColumn = getByLabelText(en.tableRemoveColumn) as HTMLButtonElement;
    expect(removeColumn.disabled).toBe(true);

    fireEvent.click(removeColumn);
    expect(onTableChange).not.toHaveBeenCalled();
  });
});
