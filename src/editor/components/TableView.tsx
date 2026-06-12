import type { InlineNode, TableBlock, TextBlock } from "../core/schema";
import { InlineEditor } from "./InlineEditor";

/**
 * Minimal table rendering for v0.4: each cell hosts its restricted block
 * list (D9 — text-variant blocks only), each editable inline. Structural
 * table UX (add/remove rows and columns, resize) lands in v0.5; the data
 * operations already exist via updateBlock.
 */

export interface TableViewProps {
  block: TableBlock;
  readOnly?: boolean | undefined;
  onRowsChange(rows: TableBlock["rows"]): void;
}

export function TableView({ block, readOnly = false, onRowsChange }: TableViewProps) {
  function updateCellBlock(rowIndex: number, cellIndex: number, blockIndex: number, content: InlineNode[]): void {
    const rows = block.rows.map((row, currentRowIndex) => {
      if (currentRowIndex !== rowIndex) {
        return row;
      }
      return {
        ...row,
        cells: row.cells.map((cell, currentCellIndex) => {
          if (currentCellIndex !== cellIndex) {
            return cell;
          }
          return {
            ...cell,
            blocks: cell.blocks.map((cellBlock, currentBlockIndex) =>
              currentBlockIndex === blockIndex ? { ...cellBlock, content } : cellBlock,
            ),
          };
        }),
      };
    });
    onRowsChange(rows);
  }

  const [headerRow, ...bodyRows] = block.showHeader ? [block.rows[0], ...block.rows.slice(1)] : [undefined, ...block.rows];

  function renderCell(cellBlocks: TextBlock[], rowIndex: number, cellIndex: number) {
    return cellBlocks.map((cellBlock, blockIndex) => (
      <InlineEditor
        key={cellBlock.id}
        content={cellBlock.content}
        readOnly={readOnly}
        onContentChange={(content) => updateCellBlock(rowIndex, cellIndex, blockIndex, content)}
        ariaLabel="Table cell"
      />
    ));
  }

  return (
    <table className="wte-table">
      {headerRow !== undefined && (
        <thead>
          <tr>
            {headerRow.cells.map((cell, cellIndex) => (
              <th key={cell.columnId} style={columnStyle(block, cell.columnId)}>
                {renderCell(cell.blocks, 0, cellIndex)}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {bodyRows.map((row, bodyIndex) => {
          const rowIndex = block.showHeader ? bodyIndex + 1 : bodyIndex;
          return (
            <tr key={row.id}>
              {row.cells.map((cell, cellIndex) => (
                <td key={cell.columnId} style={columnStyle(block, cell.columnId)}>
                  {renderCell(cell.blocks, rowIndex, cellIndex)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function columnStyle(block: TableBlock, columnId: string): React.CSSProperties | undefined {
  const column = block.columns.find((candidate) => candidate.id === columnId);
  if (column === undefined) {
    return undefined;
  }
  const style: React.CSSProperties = {};
  if (column.align !== undefined) {
    style.textAlign = column.align;
  }
  if (column.width !== undefined) {
    style.width = column.width.unit === "percent" ? `${column.width.value}%` : `${column.width.value}px`;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}
