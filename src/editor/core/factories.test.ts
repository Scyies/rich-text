import { describe, expect, it } from "vitest";
import { cloneBlocksWithFreshIds, createImageGroupBlock, createTableBlock } from "./factories";

describe("cloneBlocksWithFreshIds", () => {
  it("regenerates nested table and image-group ids while preserving content", () => {
    const table = createTableBlock({ rowCount: 2, columnCount: 2 });
    const group = createImageGroupBlock({
      images: [
        { source: { type: "url", url: "https://example.com/a.png" } },
        { source: { type: "url", url: "https://example.com/b.png" } },
      ],
    });
    const [clonedTable, clonedGroup] = cloneBlocksWithFreshIds([table, group]);
    expect(clonedTable?.id).not.toBe(table.id);
    expect(clonedGroup?.id).not.toBe(group.id);
    if (clonedTable?.type !== "table" || clonedGroup?.type !== "imageGroup") return;
    expect(clonedTable.columns.map((column) => column.id)).not.toEqual(table.columns.map((column) => column.id));
    expect(clonedTable.rows[0]!.cells[0]!.columnId).toBe(clonedTable.columns[0]!.id);
    expect(clonedTable.rows[0]!.cells[0]!.blocks[0]!.id).not.toBe(table.rows[0]!.cells[0]!.blocks[0]!.id);
    expect(clonedGroup.images.map((image) => image.id)).not.toEqual(group.images.map((image) => image.id));
    expect(clonedGroup.images.map((image) => image.source)).toEqual(group.images.map((image) => image.source));
  });
});
