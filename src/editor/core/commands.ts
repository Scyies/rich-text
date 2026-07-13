import { generateBlockId } from "./factories";
import { getInlineLength } from "./inline";
import { createHistory, type HistoryEntry } from "./history";
import { applyPatches, type DocumentPatch } from "./patches";
import { deleteTextRange as deleteDocumentTextRange, replaceTextRangeWithBlocks, replaceTextRangeWithInline } from "./ranges";
import { caretAt, clampSelection, selectionsEqual, type EditorSelection, type TextSelection } from "./selection";
import { getSection, getSectionTree, type Section, type SectionTree } from "./sections";
import type { Block, BlockMeta, ImageGroupEntry, InlineNode, WealthyDocument } from "./schema";
import * as transforms from "./transforms";
import type { TurnIntoTarget } from "./transforms";

/**
 * Headless editor engine (v0.2 — zero React). The engine owns the working
 * document (D10): every mutation flows through one transaction pipeline
 * that records history (D8) and notifies subscribers. Commands throw on
 * invalid input and leave the state untouched.
 */

export type ChangeOrigin = "command" | "patches" | "history" | "set-document" | "selection";

export interface ChangeInfo {
  origin: ChangeOrigin;
  /** The command name when origin is "command". */
  command?: string;
}

export type EngineListener<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
> = (
  document: WealthyDocument<TBlockMeta, TDocMeta>,
  info: ChangeInfo,
) => void;

export interface EditorEngineOptions<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
> {
  value: WealthyDocument<TBlockMeta, TDocMeta>;
  /** Maximum undo depth; engine creation time only. */
  limit?: number;
  /** Edits with the same coalesce key within this window merge. */
  coalesceWindowMs?: number;
}

export interface EditorCommands<TBlockMeta extends BlockMeta = BlockMeta> {
  updateBlock(blockId: string, patch: Record<string, unknown>): void;
  insertBlockAfter(afterBlockId: string | null, block: Block<TBlockMeta>): string;
  deleteBlock(blockId: string): void;
  /** Deletes and merges a top-level document text range as one undoable edit. */
  deleteTextRange(selection: TextSelection): void;
  /** Replaces a document text range with inline nodes as one undoable edit. */
  replaceTextRange(selection: TextSelection, content: InlineNode[]): void;
  /** Replaces a range with blocks as one undoable edit. */
  replaceTextRangeWithBlocks(selection: TextSelection, blocks: Block<TBlockMeta>[], inlineSingleParagraph?: boolean): void;
  moveBlock(blockId: string, afterBlockId: string | null): void;
  turnInto(blockId: string, target: TurnIntoTarget): void;
  /** Returns the id of the new (second) block; caret belongs at its start. */
  splitBlock(blockId: string, offset: number): string;
  /** Deletes a document text range and splits at its start as one undoable edit. */
  splitTextRange(selection: TextSelection): string;
  /** Returns the caret offset inside the merged block. */
  mergeWithPrevious(blockId: string): number;
  /**
   * Splices an inline node (text or atomic object, e.g. a placeholder
   * chip) into a text-like block. Returns the caret offset after it.
   */
  insertInlineNode(blockId: string, offset: number, node: InlineNode): number;
  /**
   * Edits the inline object at `offset` in place (chip editing, D6):
   * replaces its data/meta, keeps its kind. Throws if no object is there.
   */
  updateInlineObject(
    blockId: string,
    offset: number,
    patch: { data?: Record<string, unknown>; meta?: Record<string, unknown> },
  ): void;
  /** Removes the inline node (one inline unit, e.g. a chip) at `offset`. */
  removeInlineNode(blockId: string, offset: number): void;
  /** Inserts an image-group entry after `afterEntryId` (null = at the start). */
  insertImageGroupEntry(
    groupId: string,
    afterEntryId: string | null,
    entry: ImageGroupEntry<TBlockMeta>,
  ): void;
  /** Shallow-merges a patch into one image-group entry (`id` is immutable). */
  updateImageGroupEntry(
    groupId: string,
    entryId: string,
    patch: Partial<Omit<ImageGroupEntry<TBlockMeta>, "id">>,
  ): void;
  /**
   * Removes an image-group entry. The last entry deletes the block; reducing
   * the group to one entry collapses it to a plain image block (same slot).
   */
  removeImageGroupEntry(groupId: string, entryId: string): void;
  /** Splits a group before `beforeEntryId`. Returns the new (second) block id. */
  splitImageGroup(groupId: string, beforeEntryId: string): string;
  /**
   * Removes empty draft slots from image groups as one undoable change (no-op
   * when there are none). Pass `exceptBlockId` to spare the row currently being
   * edited so its unfilled slots survive while the user fills it.
   */
  pruneEmptyImageSlots(exceptBlockId?: string): void;
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

export interface EditorEngine<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
> {
  getDocument(): WealthyDocument<TBlockMeta, TDocMeta>;
  /** Document switch (D10: new `value` reference) — resets history. */
  setDocument(document: WealthyDocument<TBlockMeta, TDocMeta>): void;
  getSelection(): EditorSelection | null;
  /**
   * Selection updates notify subscribers (origin "selection") but never
   * create history entries.
   */
  setSelection(selection: EditorSelection | null): void;
  subscribe(listener: EngineListener<TBlockMeta, TDocMeta>): () => void;
  getSectionTree(): SectionTree<TBlockMeta>;
  getSection(headingId: string): Section<TBlockMeta> | null;
  canUndo(): boolean;
  canRedo(): boolean;
  commands: EditorCommands<TBlockMeta>;
}

export function createEditorEngine<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
>(
  options: EditorEngineOptions<TBlockMeta, TDocMeta>,
): EditorEngine<TBlockMeta, TDocMeta> {
  let document = options.value;
  let selection: EditorSelection | null = null;
  const history = createHistory<TBlockMeta, TDocMeta>(options);
  const listeners = new Set<EngineListener<TBlockMeta, TDocMeta>>();

  function notify(info: ChangeInfo): void {
    for (const listener of listeners) {
      listener(document, info);
    }
  }

  function snapshot(): HistoryEntry<TBlockMeta, TDocMeta> {
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
    run: (current: WealthyDocument<TBlockMeta, TDocMeta>) => {
      document: WealthyDocument<TBlockMeta, TDocMeta>;
      result: TResult;
      selection?: EditorSelection | null;
    },
    origin: ChangeOrigin = "command",
  ): TResult {
    const previous = snapshot();
    const outcome = run(document);
    const { document: next, result } = outcome;
    history.record(previous, coalesceKey);
    document = next;
    selection = clampSelection(document, "selection" in outcome ? (outcome.selection ?? null) : selection);
    notify(origin === "command" ? { origin, command } : { origin });
    return result;
  }

  const commands: EditorCommands<TBlockMeta> = {
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

    deleteTextRange(textSelection) {
      transact("deleteTextRange", null, (current) => {
        const result = deleteDocumentTextRange(current, textSelection);
        return { document: result.document, selection: result.selection, result: undefined };
      });
    },

    replaceTextRange(textSelection, content) {
      transact("replaceTextRange", null, (current) => {
        const result = replaceTextRangeWithInline(current, textSelection, content);
        return { document: result.document, selection: result.selection, result: undefined };
      });
    },

    replaceTextRangeWithBlocks(textSelection, blocks, inlineSingleParagraph = true) {
      transact("replaceTextRangeWithBlocks", null, (current) => {
        const result = replaceTextRangeWithBlocks(current, textSelection, blocks, inlineSingleParagraph);
        return { document: result.document, selection: result.selection, result: undefined };
      });
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

    splitTextRange(textSelection) {
      const newBlockId = generateBlockId();
      return transact("splitTextRange", null, (current) => {
        const deleted = deleteDocumentTextRange(current, textSelection);
        const point = deleted.selection.focus;
        return {
          document: transforms.splitBlock(deleted.document, point.blockId, point.offset, newBlockId),
          selection: caretAt(newBlockId, 0),
          result: newBlockId,
        };
      });
    },

    insertImageGroupEntry(groupId, afterEntryId, entry) {
      transact("insertImageGroupEntry", null, (current) => ({
        document: transforms.insertImageGroupEntry(current, groupId, afterEntryId, entry),
        result: undefined,
      }));
    },

    updateImageGroupEntry(groupId, entryId, patch) {
      // Caption typing coalesces per entry, like primary-content edits.
      const keys = Object.keys(patch);
      const coalesceKey = keys.length === 1 && keys[0] === "caption" ? `caption:${groupId}:${entryId}` : null;
      transact("updateImageGroupEntry", coalesceKey, (current) => ({
        document: transforms.updateImageGroupEntry(current, groupId, entryId, patch),
        result: undefined,
      }));
    },

    removeImageGroupEntry(groupId, entryId) {
      transact("removeImageGroupEntry", null, (current) => ({
        document: transforms.removeImageGroupEntry(current, groupId, entryId),
        result: undefined,
      }));
    },

    splitImageGroup(groupId, beforeEntryId) {
      const newBlockId = generateBlockId();
      return transact("splitImageGroup", null, (current) => ({
        document: transforms.splitImageGroup(current, groupId, beforeEntryId, newBlockId),
        result: newBlockId,
      }));
    },

    pruneEmptyImageSlots(exceptBlockId) {
      // Skip the transaction (and its history entry) when there is nothing to prune.
      if (transforms.pruneEmptyImageSlots(document, { exceptBlockId }) === document) {
        return;
      }
      transact("pruneEmptyImageSlots", null, (current) => ({
        document: transforms.pruneEmptyImageSlots(current, { exceptBlockId }),
        result: undefined,
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

    insertInlineNode(blockId, offset, node) {
      return transact("insertInlineNode", null, (current) => ({
        document: transforms.insertInlineNode(current, blockId, offset, node),
        result: offset + transforms.getInlineNodeLength(node),
      }));
    },

    updateInlineObject(blockId, offset, patch) {
      transact("updateInlineObject", null, (current) => ({
        document: transforms.updateInlineObjectAt(current, blockId, offset, patch),
        result: undefined,
      }));
    },

    removeInlineNode(blockId, offset) {
      transact("removeInlineNode", null, (current) => ({
        document: transforms.removeInlineNodeAt(current, blockId, offset),
        result: undefined,
      }));
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
      const clamped = clampSelection(document, next);
      if (selectionsEqual(selection, clamped)) {
        return;
      }
      selection = clamped;
      notify({ origin: "selection" });
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
