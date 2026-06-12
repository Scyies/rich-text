import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createEditorEngine,
  type ChangeInfo,
  type EditorCommands,
  type EditorEngine,
} from "../core/commands";
import { getSectionRange, type Section, type SectionTree } from "../core/sections";
import type { EditorSelection } from "../core/selection";
import type { BlockMeta, WealthyDocument } from "../core/schema";

/**
 * Headless document editor hook (v0.3).
 *
 * Data flow (D10): the engine owns the working document. `value` is the
 * initial state; passing a NEW reference that is not the engine's own
 * output performs a document switch (hard reset: history and selection
 * cleared, dirty state reset). Echoing the document you received from
 * `onChange` back into `value` is a no-op.
 */

export interface UseDocumentEditorOptions<TMeta extends BlockMeta = BlockMeta> {
  value: WealthyDocument<TMeta>;
  /** Fires after every transaction (commands, patches, undo/redo). */
  onChange?: ((document: WealthyDocument<TMeta>, info: ChangeInfo) => void) | undefined;
  /** Fires on explicit `commit()` and on idle commit. */
  onCommit?: ((document: WealthyDocument<TMeta>) => void) | undefined;
  /** Auto-commit after this many ms without a transaction. Off by default. */
  commitIdleMs?: number | undefined;
  /** Undo depth (engine creation time only). */
  historyLimit?: number | undefined;
  /** Typing coalesce window in ms (engine creation time only). */
  coalesceWindowMs?: number | undefined;
}

export interface DocumentEditorApi<TMeta extends BlockMeta = BlockMeta> {
  document: WealthyDocument<TMeta>;
  commands: EditorCommands<TMeta>;
  /** Escape hatch to the underlying engine. */
  engine: EditorEngine<TMeta>;
  selection: EditorSelection | null;
  setSelection(selection: EditorSelection | null): void;
  sectionTree: SectionTree<TMeta>;
  getSection(headingId: string): Section<TMeta> | null;
  canUndo: boolean;
  canRedo: boolean;
  /** True when the document changed since the last commit (or value switch). */
  isDirty: boolean;
  commit(): void;
  /** Collapse/expand is view state (D3.4) — never part of the document. */
  collapsedHeadingIds: ReadonlySet<string>;
  isSectionCollapsed(headingId: string): boolean;
  setSectionCollapsed(headingId: string, collapsed: boolean): void;
  toggleSectionCollapsed(headingId: string): void;
  expandAllSections(): void;
  /** Ids of blocks hidden by collapsed sections (headings stay visible). */
  hiddenBlockIds: ReadonlySet<string>;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * Hosts often rebuild the wrapper object ({ schemaVersion, blocks }) on
 * every render. Two documents are "the same" when their blocks are
 * identical by reference — only a genuinely different document (edited,
 * deserialized, or loaded) triggers a switch.
 */
function isSameDocument(a: WealthyDocument<BlockMeta>, b: WealthyDocument<BlockMeta>): boolean {
  if (a === b) {
    return true;
  }
  if (a.schemaVersion !== b.schemaVersion || a.meta !== b.meta) {
    return false;
  }
  if (a.blocks === b.blocks) {
    return true;
  }
  return a.blocks.length === b.blocks.length && a.blocks.every((block, index) => block === b.blocks[index]);
}

export function useDocumentEditor<TMeta extends BlockMeta = BlockMeta>(
  options: UseDocumentEditorOptions<TMeta>,
): DocumentEditorApi<TMeta> {
  const { value } = options;

  const [engine] = useState(() =>
    createEditorEngine<TMeta>({
      value,
      ...(options.historyLimit !== undefined ? { limit: options.historyLimit } : {}),
      ...(options.coalesceWindowMs !== undefined ? { coalesceWindowMs: options.coalesceWindowMs } : {}),
    }),
  );

  // Latest callbacks without re-subscribing.
  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;
  const onCommitRef = useRef(options.onCommit);
  onCommitRef.current = options.onCommit;
  const commitIdleMsRef = useRef(options.commitIdleMs);
  commitIdleMsRef.current = options.commitIdleMs;

  // Committed baseline: ref for timers, state for render reactivity.
  const [lastCommitted, setLastCommittedState] = useState(value);
  const lastCommittedRef = useRef(value);
  const setLastCommitted = useCallback((document: WealthyDocument<TMeta>) => {
    lastCommittedRef.current = document;
    setLastCommittedState(document);
  }, []);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const commit = useCallback(() => {
    clearIdleTimer();
    const document = engine.getDocument();
    if (document === lastCommittedRef.current) {
      return;
    }
    setLastCommitted(document);
    onCommitRef.current?.(document);
  }, [engine, clearIdleTimer, setLastCommitted]);

  const commitRef = useRef(commit);
  commitRef.current = commit;

  // One engine subscription drives both re-renders (version store) and
  // the change lifecycle (onChange + idle commit scheduling).
  const versionRef = useRef(0);
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      engine.subscribe((document, info) => {
        versionRef.current += 1;
        if (info.origin === "command" || info.origin === "patches" || info.origin === "history") {
          onChangeRef.current?.(document, info);
          const idleMs = commitIdleMsRef.current;
          if (idleMs !== undefined) {
            if (idleTimerRef.current !== null) {
              clearTimeout(idleTimerRef.current);
            }
            idleTimerRef.current = setTimeout(() => {
              idleTimerRef.current = null;
              commitRef.current();
            }, idleMs);
          }
        }
        onStoreChange();
      }),
    [engine],
  );
  useSyncExternalStore(
    subscribe,
    () => versionRef.current,
    () => versionRef.current,
  );

  // Document switch on new `value` reference (D10). Two kinds of new
  // references are NOT switches: a re-created wrapper around the same
  // blocks (host re-render), and an echo of the engine's own onChange
  // output (controlled usage).
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (value === lastValueRef.current) {
      return;
    }
    const previousValue = lastValueRef.current;
    lastValueRef.current = value;
    if (isSameDocument(value, previousValue) || isSameDocument(value, engine.getDocument())) {
      return;
    }
    clearIdleTimer();
    engine.setDocument(value);
    setLastCommitted(value);
  }, [value, engine, clearIdleTimer, setLastCommitted]);

  useEffect(() => clearIdleTimer, [clearIdleTimer]);

  const document = engine.getDocument();

  const sectionTree = useMemo(() => engine.getSectionTree(), [engine, document]);

  const getSection = useCallback((headingId: string) => engine.getSection(headingId), [engine]);

  const setSelection = useCallback(
    (selection: EditorSelection | null) => engine.setSelection(selection),
    [engine],
  );

  // ---- Collapse/expand view state (D3.4) ----
  const [collapsedHeadingIds, setCollapsedHeadingIds] = useState<ReadonlySet<string>>(EMPTY_SET);

  const setSectionCollapsed = useCallback((headingId: string, collapsed: boolean) => {
    setCollapsedHeadingIds((previous) => {
      if (previous.has(headingId) === collapsed) {
        return previous;
      }
      const next = new Set(previous);
      if (collapsed) {
        next.add(headingId);
      } else {
        next.delete(headingId);
      }
      return next;
    });
  }, []);

  const toggleSectionCollapsed = useCallback((headingId: string) => {
    setCollapsedHeadingIds((previous) => {
      const next = new Set(previous);
      if (next.has(headingId)) {
        next.delete(headingId);
      } else {
        next.add(headingId);
      }
      return next;
    });
  }, []);

  const expandAllSections = useCallback(() => setCollapsedHeadingIds(EMPTY_SET), []);

  const isSectionCollapsed = useCallback(
    (headingId: string) => collapsedHeadingIds.has(headingId),
    [collapsedHeadingIds],
  );

  const hiddenBlockIds = useMemo<ReadonlySet<string>>(() => {
    if (collapsedHeadingIds.size === 0) {
      return EMPTY_SET;
    }
    const hidden = new Set<string>();
    for (const headingId of collapsedHeadingIds) {
      const range = getSectionRange(document, headingId);
      if (range !== null) {
        for (let index = range.start + 1; index < range.end; index += 1) {
          hidden.add(document.blocks[index]!.id);
        }
      }
    }
    return hidden;
  }, [document, collapsedHeadingIds]);

  return {
    document,
    commands: engine.commands,
    engine,
    selection: engine.getSelection(),
    setSelection,
    sectionTree,
    getSection,
    canUndo: engine.canUndo(),
    canRedo: engine.canRedo(),
    isDirty: document !== lastCommitted,
    commit,
    collapsedHeadingIds,
    isSectionCollapsed,
    setSectionCollapsed,
    toggleSectionCollapsed,
    expandAllSections,
    hiddenBlockIds,
  };
}
