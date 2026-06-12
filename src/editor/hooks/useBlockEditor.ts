import { useMemo } from "react";
import type { ChangeInfo } from "../core/commands";
import type { EditorSelection } from "../core/selection";
import type { TurnIntoTarget } from "../core/transforms";
import { SCHEMA_VERSION, type Block, type BlockMeta, type WealthyDocument } from "../core/schema";
import { useDocumentEditor } from "./useDocumentEditor";

/**
 * Headless single-block editor (v0.3) — the hook behind <BlockEditor>.
 * Internally it is a one-block document on the same engine, so undo/redo,
 * validation, and the commit lifecycle behave exactly like the full editor.
 */

export interface UseBlockEditorOptions<TMeta extends BlockMeta = BlockMeta> {
  value: Block<TMeta>;
  /** Fires after every change to the block. */
  onChange?: ((block: Block<TMeta>, info: ChangeInfo) => void) | undefined;
  /** Fires on explicit `commit()` and on idle commit. */
  onCommit?: ((block: Block<TMeta>) => void) | undefined;
  commitIdleMs?: number | undefined;
  historyLimit?: number | undefined;
  coalesceWindowMs?: number | undefined;
}

export interface BlockEditorApi<TMeta extends BlockMeta = BlockMeta> {
  block: Block<TMeta>;
  /** Shallow patch with the same key whitelist + revalidation as updateBlock. */
  update(patch: Record<string, unknown>): void;
  turnInto(target: TurnIntoTarget): void;
  selection: EditorSelection | null;
  setSelection(selection: EditorSelection | null): void;
  undo(): boolean;
  redo(): boolean;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  commit(): void;
}

export function useBlockEditor<TMeta extends BlockMeta = BlockMeta>(
  options: UseBlockEditorOptions<TMeta>,
): BlockEditorApi<TMeta> {
  const { value, onChange, onCommit } = options;

  const documentValue = useMemo<WealthyDocument<TMeta>>(
    () => ({ schemaVersion: SCHEMA_VERSION, blocks: [value] }),
    [value],
  );

  const editor = useDocumentEditor<TMeta>({
    value: documentValue,
    onChange: onChange
      ? (document, info) => {
          const block = document.blocks[0];
          if (block !== undefined) {
            onChange(block, info);
          }
        }
      : undefined,
    onCommit: onCommit
      ? (document) => {
          const block = document.blocks[0];
          if (block !== undefined) {
            onCommit(block);
          }
        }
      : undefined,
    commitIdleMs: options.commitIdleMs,
    historyLimit: options.historyLimit,
    coalesceWindowMs: options.coalesceWindowMs,
  });

  const block = editor.document.blocks[0];
  if (block === undefined) {
    throw new Error("useBlockEditor: the block document is empty — this is a bug");
  }

  return {
    block,
    update: (patch) => editor.commands.updateBlock(block.id, patch),
    turnInto: (target) => editor.commands.turnInto(block.id, target),
    selection: editor.selection,
    setSelection: editor.setSelection,
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    isDirty: editor.isDirty,
    commit: editor.commit,
  };
}
