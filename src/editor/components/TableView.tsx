import { createTextBlock, generateBlockId } from "../core/factories";
import type { InlineNode, TableBlock, TextBlock } from "../core/schema";
import { getListMarkerPlan } from "../core/numbering";
import { MAX_INDENT, SCHEMA_VERSION } from "../core/schema";
import { useMessages } from "../i18n";
import { InlineEditor } from "./InlineEditor";

/**
 * Table rendering for v0.4: each cell hosts its restricted block list (D9
 * — text-variant blocks only), each editable inline, plus minimal
 * structural controls (add/remove row and column) shown on hover/focus.
 * Column resize and per-position insertion land in v0.5.
 */

export interface TableViewProps {
  block: TableBlock;
  readOnly?: boolean | undefined;
  /** Patch with new columns and/or rows (flows into updateBlock). */
  onTableChange(patch: { columns?: TableBlock["columns"]; rows?: TableBlock["rows"] }): void;
}

export function TableView({ block, readOnly = false, onTableChange }: TableViewProps) {
  const messages = useMessages();
  const listPlan = getListMarkerPlan({ schemaVersion: SCHEMA_VERSION, blocks: [block] });

  function updateCellBlock(rowIndex: number, columnId: string, blockIndex: number, content: InlineNode[]): void {
    const rows = block.rows.map((row, currentRowIndex) => {
      if (currentRowIndex !== rowIndex) {
        return row;
      }
      return {
        ...row,
        cells: row.cells.map((cell) => {
          if (cell.columnId !== columnId) {
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
    onTableChange({ rows });
  }

  function addRow(): void {
    const row = {
      id: generateBlockId(),
      cells: block.columns.map((column) => ({ columnId: column.id, blocks: [createTextBlock()] })),
    };
    onTableChange({ rows: [...block.rows, row] });
  }

  function removeRow(): void {
    if (block.rows.length <= 1) {
      return;
    }
    onTableChange({ rows: block.rows.slice(0, -1) });
  }

  function addColumn(): void {
    const column = { id: generateBlockId() };
    onTableChange({
      columns: [...block.columns, column],
      rows: block.rows.map((row) => ({
        ...row,
        cells: [...row.cells, { columnId: column.id, blocks: [createTextBlock()] }],
      })),
    });
  }

  function removeColumn(): void {
    if (block.columns.length <= 1) {
      return;
    }
    const removed = block.columns[block.columns.length - 1]!;
    onTableChange({
      columns: block.columns.slice(0, -1),
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.filter((cell) => cell.columnId !== removed.id),
      })),
    });
  }

  const [headerRow, ...bodyRows] = block.showHeader
    ? [block.rows[0], ...block.rows.slice(1)]
    : [undefined, ...block.rows];

  function renderCell(cellBlocks: TextBlock[], rowIndex: number, columnId: string) {
    return cellBlocks.map((cellBlock, blockIndex) => (
      <div
        className="wte-block__line"
        data-block-id={cellBlock.id}
        key={cellBlock.id}
        style={cellBlock.indent !== undefined ? { paddingLeft: `${Math.min(cellBlock.indent, MAX_INDENT) * 1.5}rem` } : undefined}
      >
        {cellBlock.variant === "bullet" && <span className="wte-block__marker">•</span>}
        {cellBlock.variant === "numbered" && <span className="wte-block__marker">{listPlan.get(cellBlock.id)?.label ?? "1."}</span>}
        <InlineEditor
          as="p"
          content={cellBlock.content}
          readOnly={readOnly}
          style={cellBlock.align !== undefined ? { textAlign: cellBlock.align } : undefined}
          onContentChange={(content) => updateCellBlock(rowIndex, columnId, blockIndex, content)}
          ariaLabel={messages.tableCellAriaLabel}
        />
      </div>
    ));
  }

  return (
    <div className="wte-table-wrapper">
      <table className="wte-table">
        {headerRow !== undefined && (
          <thead>
            <tr>
              {block.columns.map((column) => {
                const cell = headerRow.cells.find((candidate) => candidate.columnId === column.id);
                return (
                  <th key={column.id} style={columnStyle(block, column.id)}>
                    {cell !== undefined ? renderCell(cell.blocks, 0, column.id) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((row, bodyIndex) => {
            const rowIndex = block.showHeader ? bodyIndex + 1 : bodyIndex;
            return (
              <tr key={row.id}>
                {block.columns.map((column) => {
                  const cell = row.cells.find((candidate) => candidate.columnId === column.id);
                  return (
                    <td key={column.id} style={columnStyle(block, column.id)}>
                      {cell !== undefined ? renderCell(cell.blocks, rowIndex, column.id) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && (
        <div className="wte-table__controls" contentEditable={false}>
          <button type="button" aria-label={messages.tableAddRow} onClick={addRow}>
            + {messages.tableRowLabel}
          </button>
          <button
            type="button"
            aria-label={messages.tableRemoveRow}
            onClick={removeRow}
            disabled={block.rows.length <= 1}
          >
            − {messages.tableRowLabel}
          </button>
          <button type="button" aria-label={messages.tableAddColumn} onClick={addColumn}>
            + {messages.tableColumnLabel}
          </button>
          <button
            type="button"
            aria-label={messages.tableRemoveColumn}
            onClick={removeColumn}
            disabled={block.columns.length <= 1}
          >
            − {messages.tableColumnLabel}
          </button>
        </div>
      )}
    </div>
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
