import type { BlockMeta, MogulDocument } from "./schema";
import type { EditorSelection } from "./selection";

/**
 * Snapshot history (D8). The document is immutable JSON, so entries share
 * structure and snapshots are cheap. Consecutive edits carrying the same
 * coalesce key within the time window collapse into one entry: undo
 * returns to the state before the typing run began.
 */

export interface HistoryEntry<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
> {
  document: MogulDocument<TBlockMeta, TDocMeta>;
  selection: EditorSelection | null;
}

export interface HistoryOptions {
  /** Maximum undo depth; oldest entries are dropped beyond it. */
  limit?: number;
  /** Edits with the same coalesce key within this window merge. */
  coalesceWindowMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface History<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
> {
  /**
   * Records the state being replaced. Call BEFORE applying a change, with
   * the pre-change document. `coalesceKey: null` forces a new entry.
   */
  record(entry: HistoryEntry<TBlockMeta, TDocMeta>, coalesceKey: string | null): void;
  /** Steps back: stores `current` for redo, returns the previous entry. */
  undo(current: HistoryEntry<TBlockMeta, TDocMeta>): HistoryEntry<TBlockMeta, TDocMeta> | null;
  /** Steps forward: stores `current` for undo, returns the next entry. */
  redo(current: HistoryEntry<TBlockMeta, TDocMeta>): HistoryEntry<TBlockMeta, TDocMeta> | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export const DEFAULT_HISTORY_LIMIT = 100;
export const DEFAULT_COALESCE_WINDOW_MS = 1000;

export function createHistory<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
>(
  options: HistoryOptions = {},
): History<TBlockMeta, TDocMeta> {
  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
  const coalesceWindowMs = options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
  const now = options.now ?? (() => Date.now());

  let undoStack: HistoryEntry<TBlockMeta, TDocMeta>[] = [];
  let redoStack: HistoryEntry<TBlockMeta, TDocMeta>[] = [];
  let lastKey: string | null = null;
  let lastTime = 0;

  return {
    record(entry, coalesceKey) {
      redoStack = [];
      const time = now();
      const coalesces =
        coalesceKey !== null && coalesceKey === lastKey && time - lastTime <= coalesceWindowMs;
      lastKey = coalesceKey;
      lastTime = time;
      if (coalesces) {
        return;
      }
      undoStack.push(entry);
      if (undoStack.length > limit) {
        undoStack.shift();
      }
    },

    undo(current) {
      const entry = undoStack.pop();
      if (entry === undefined) {
        return null;
      }
      redoStack.push(current);
      lastKey = null;
      return entry;
    },

    redo(current) {
      const entry = redoStack.pop();
      if (entry === undefined) {
        return null;
      }
      undoStack.push(current);
      lastKey = null;
      return entry;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    clear() {
      undoStack = [];
      redoStack = [];
      lastKey = null;
      lastTime = 0;
    },
  };
}
