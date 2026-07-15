import { describe, expect, it } from "vitest";
import { createEmptyDocument, createTextBlock } from "./factories";
import { createHistory, type HistoryEntry } from "./history";
import { SCHEMA_VERSION, type MogulDocument } from "./schema";

function entry(label: string): HistoryEntry {
  const doc: MogulDocument = {
    schemaVersion: SCHEMA_VERSION,
    blocks: [createTextBlock({ content: label })],
  };
  return { document: doc, selection: null };
}

describe("createHistory", () => {
  it("undo returns recorded states LIFO; redo walks back forward", () => {
    const history = createHistory();
    const [a, b, current] = [entry("a"), entry("b"), entry("current")];

    history.record(a, null);
    history.record(b, null);

    expect(history.undo(current)).toBe(b);
    expect(history.undo(b)).toBe(a);
    expect(history.undo(a)).toBeNull();

    expect(history.redo(a)).toBe(b);
    expect(history.redo(b)).toBe(current);
    expect(history.redo(current)).toBeNull();
  });

  it("recording clears the redo stack", () => {
    const history = createHistory();
    const [a, b, c] = [entry("a"), entry("b"), entry("c")];
    history.record(a, null);
    history.undo(b);
    expect(history.canRedo()).toBe(true);
    history.record(c, null);
    expect(history.canRedo()).toBe(false);
  });

  it("coalesces same-key records inside the window", () => {
    let time = 0;
    const history = createHistory({ now: () => time, coalesceWindowMs: 1000 });
    const beforeTyping = entry("before");

    history.record(beforeTyping, "content:b1");
    time = 500;
    history.record(entry("typing-1"), "content:b1"); // coalesced — not pushed
    time = 900;
    history.record(entry("typing-2"), "content:b1"); // coalesced

    expect(history.undo(entry("current"))).toBe(beforeTyping);
    expect(history.canUndo()).toBe(false);
  });

  it("does not coalesce across the window, different keys, or null keys", () => {
    let time = 0;
    const history = createHistory({ now: () => time, coalesceWindowMs: 1000 });

    history.record(entry("a"), "content:b1");
    time = 2000;
    history.record(entry("b"), "content:b1"); // window expired → new entry
    time = 2100;
    history.record(entry("c"), "content:OTHER"); // different key → new entry
    time = 2200;
    history.record(entry("d"), null); // null never coalesces
    time = 2300;
    history.record(entry("e"), null);

    let count = 0;
    let cursor = entry("current");
    while (history.canUndo()) {
      cursor = history.undo(cursor)!;
      count += 1;
    }
    expect(count).toBe(5);
  });

  it("undo breaks a coalescing run (typing after undo starts a fresh entry)", () => {
    let time = 0;
    const history = createHistory({ now: () => time, coalesceWindowMs: 1000 });
    const a = entry("a");
    history.record(a, "content:b1");
    history.undo(entry("current"));
    history.redo(a);
    time = 100;
    history.record(entry("b"), "content:b1"); // same key, in window — but run was broken
    expect(history.canUndo()).toBe(true);
    history.undo(entry("x"));
    expect(history.canUndo()).toBe(true); // both entries present
  });

  it("drops the oldest entries beyond the limit", () => {
    const history = createHistory({ limit: 2 });
    history.record(entry("a"), null);
    history.record(entry("b"), null);
    history.record(entry("c"), null);

    let count = 0;
    let cursor: HistoryEntry = entry("current");
    while (history.canUndo()) {
      cursor = history.undo(cursor)!;
      count += 1;
    }
    expect(count).toBe(2);
  });

  it("clear empties both stacks", () => {
    const history = createHistory();
    history.record({ document: createEmptyDocument(), selection: null }, null);
    history.undo({ document: createEmptyDocument(), selection: null });
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
