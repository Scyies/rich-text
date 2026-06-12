import { generateBlockId } from "./factories";
import { getInlineLength } from "./inline";
import { createHistory, type HistoryEntry, type HistoryOptions } from "./history";
import { applyPatches, type DocumentPatch } from "./patches";
import { clampSelection, type EditorSelection } from "./selection";
import { getSection, getSectionTree, type Section, type SectionTree } from "./sections";
import type { Block, BlockMeta, WealthyDocument } from "./schema";
import * as transforms from "./transforms";
import type { TurnIntoTarget } from "./transforms";

/**
 * Headless editor engine (v0.2 — zero React). The engine owns the working
 * document (D10): every mutation flows through one transaction pipeline
 * that records history (D8) and notifies subscribers. Commands throw on
 * invalid input and leave the state untouched.
 */

export type ChangeOrigin = "command" | "patches" | "history" | "set-document";

export interface ChangeInfo {
  origin: ChangeOrigin;
  /** The command name when origin is "command". */
  command?: string;
}

export type EngineListener<TMeta extends BlockMeta = BlockMeta> = (
  document: WealthyDocument<TMeta>,
  info: ChangeInfo,
) => void;

export interface EditorEngineOptions<TMeta extends BlockMeta = BlockMeta> extends HistoryOptions {
  value: WealthyDocument<TMeta>;
}

export interface EditorCommands<TMeta extends BlockMeta = BlockMeta> {
  updateBlock(blockId: string, patch: Record<string, unknown>): void;
  insertBlockAfter(afterBlockId: string | null, block: Block<TMeta>): string;
  deleteBlock(blockId: string): void;
  moveBlock(blockId: string, afterBlockId: string | null): void;
  turnInto(blockId: string, target: TurnIntoTarget): void;
  /** Returns the id of the new (second) block; caret belongs at its start. */
  splitBlock(blockId: string, offset: number): string;
  /** Returns the caret offset inside the merged block. */
  mergeWithPrevious(blockId: string): number;
  indent(blockId: string): void;
  outdent(blockId: string): void;
  moveSection(headingId: string, afterBlockId: string | null): void;
  deleteSection(headingId: string): void;
  /** Returns the duplicated section's new heading id. */
  duplicateSection(headingId: string): string;
  /** Single entry point for external (LLM/server) edits — atomic, undoable. */
  applyPatches(patches: unknown): DocumentPatch[];
  undo(): boolean;
  redo(): boolean;
}

export interface EditorEngine<TMeta extends BlockMeta = BlockMeta> {
  getDocument(): WealthyDocument<TMeta>;
  /** Document switch (D10: new `value` reference) — resets history. */
  setDocument(document: WealthyDocument<TMeta>): void;
  getSelection(): EditorSelection | null;
  /** Selection updates do not create history entries. */
  setSelection(selection: EditorSelection | null): void;
  subscribe(listener: EngineListener<TMeta>): () => void;
  getSectionTree(): SectionTree<TMeta>;
  getSection(headingId: string): Section<TMeta> | null;
  canUndo(): boolean;
  canRedo(): boolean;
  commands: EditorCommands<TMeta>;
}

export function createEditorEngine<TMeta extends BlockMeta = BlockMeta>(
  options: EditorEngineOptions<TMeta>,
): EditorEngine<TMeta> {
  let document = options.value;
  let selection: EditorSelection | null = null;
  const history = createHistory<TMeta>(options);
  const listeners = new Set<EngineListener<TMeta>>();

  function notify(info: ChangeInfo): void {
    for (const listener of listeners) {
      listener(document, info);
    }
  }

  function snapshot(): HistoryEntry<TMeta> {
    return { document, selection };
  }

  /**
   * Runs a pure transform as a transaction: on success, records the
   * pre-change state, swaps the document, clamps the selection, and
   * notifies. On throw, nothing changes.
   */
  function transact<TResult>(
    command: string,
    coalesceKey: string | null,
    run: (current: WealthyDocument<TMeta>) => { document: WealthyDocument<TMeta>; result: TResult },
    origin: ChangeOrigin = "command",
  ): TResult {
    const previous = snapshot();
    const { document: next, result } = run(document);
    history.record(previous, coalesceKey);
    document = next;
    selection = clampSelection(document, selection);
    notify(origin === "command" ? { origin, command } : { origin });
    return result;
  }

  const commands: EditorCommands<TMeta> = {
    updateBlock(blockId, patch) {
      // Pure content updates coalesce (typing); anything else is discrete.
      const keys = Object.keys(patch);
      const coalesceKey = keys.length === 1 && keys[0] === "content" ? `content:${blockId}` : null;
      transact("updateBlock", coalesceKey, (current) => ({
        document: transforms.updateBlock(current, blockId, patch),
        result: undefined,
      }));
    },

    insertBlockAfter(afterBlockId, block) {
      return transact("insertBlockAfter", null, (current) => ({
        document: transforms.insertBlockAfter(current, afterBlockId, block),
        result: block.id,
      }));
    },

    deleteBlock(blockId) {
      transact("deleteBlock", null, (current) => ({
        document: transforms.deleteBlock(current, blockId),
        result: undefined,
      }));
    },

    moveBlock(blockId, afterBlockId) {
      transact("moveBlock", null, (current) => ({
        document: transforms.moveBlock(current, blockId, afterBlockId),
        result: undefined,
      }));
    },

    turnInto(blockId, target) {
      transact("turnInto", null, (current) => ({
        document: transforms.turnInto(current, blockId, target),
        result: undefined,
      }));
    },

    splitBlock(blockId, offset) {
      const newBlockId = generateBlockId();
      return transact("splitBlock", null, (current) => ({
        document: transforms.splitBlock(current, blockId, offset, newBlockId),
        result: newBlockId,
      }));
    },

    mergeWithPrevious(blockId) {
      return transact("mergeWithPrevious", null, (current) => {
        const index = current.blocks.findIndex((block) => block.id === blockId);
        const previous = index > 0 ? current.blocks[index - 1] : undefined;
        const caretOffset =
          previous !== undefined && (previous.type === "heading" || previous.type === "text")
            ? getInlineLength(previous.content)
            : 0;
        return {
          document: transforms.mergeWithPrevious(current, blockId),
          result: caretOffset,
        };
      });
    },

    indent(blockId) {
      transact("indent", null, (current) => ({
        document: transforms.indentBlock(current, blockId),
        result: undefined,
      }));
    },

    outdent(blockId) {
      transact("outdent", null, (current) => ({
        document: transforms.outdentBlock(current, blockId),
        result: undefined,
      }));
    },

    moveSection(headingId, afterBlockId) {
      transact("moveSection", null, (current) => ({
        document: transforms.moveSection(current, headingId, afterBlockId),
        result: undefined,
      }));
    },

    deleteSection(headingId) {
      transact("deleteSection", null, (current) => ({
        document: transforms.deleteSection(current, headingId),
        result: undefined,
      }));
    },

    duplicateSection(headingId) {
      return transact("duplicateSection", null, (current) => {
        const { document: next, newHeadingId } = transforms.duplicateSection(current, headingId);
        return { document: next, result: newHeadingId };
      });
    },

    applyPatches(patches) {
      return transact(
        "applyPatches",
        null,
        (current) => {
          const { document: next, applied } = applyPatches(current, patches);
          return { document: next, result: applied };
        },
        "patches",
      );
    },

    undo() {
      const entry = history.undo(snapshot());
      if (entry === null) {
        return false;
      }
      document = entry.document;
      selection = clampSelection(document, entry.selection);
      notify({ origin: "history", command: "undo" });
      return true;
    },

    redo() {
      const entry = history.redo(snapshot());
      if (entry === null) {
        return false;
      }
      document = entry.document;
      selection = clampSelection(document, entry.selection);
      notify({ origin: "history", command: "redo" });
      return true;
    },
  };

  return {
    getDocument: () => document,

    setDocument(next) {
      document = next;
      selection = null;
      history.clear();
      notify({ origin: "set-document" });
    },

    getSelection: () => selection,

    setSelection(next) {
      selection = clampSelection(document, next);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSectionTree: () => getSectionTree(document),
    getSection: (headingId) => getSection(document, headingId),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    commands,
  };
}
