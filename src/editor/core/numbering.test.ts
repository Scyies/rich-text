import { describe, expect, it } from "vitest";
import { createHeadingBlock, createTableBlock, createTextBlock } from "./factories";
import {
  formatHeadingNumber,
  getHeadingNumberLabel,
  getHeadingNumberPath,
  getListItemNumbers,
  getListMarkerPlan,
} from "./numbering";
import { SCHEMA_VERSION, type Block, type MogulDocument } from "./schema";

function docWith(blocks: Block[]): MogulDocument {
  return { schemaVersion: SCHEMA_VERSION, blocks };
}

describe("heading numbering", () => {
  it("numbers headings by tree position", () => {
    const a = createHeadingBlock({ level: 1 });
    const a1 = createHeadingBlock({ level: 2 });
    const a2 = createHeadingBlock({ level: 2 });
    const a2x = createHeadingBlock({ level: 3 });
    const b = createHeadingBlock({ level: 1 });
    const doc = docWith([a, a1, a2, a2x, b]);

    expect(getHeadingNumberPath(doc, a.id)).toEqual([1]);
    expect(getHeadingNumberPath(doc, a1.id)).toEqual([1, 1]);
    expect(getHeadingNumberPath(doc, a2.id)).toEqual([1, 2]);
    expect(getHeadingNumberPath(doc, a2x.id)).toEqual([1, 2, 1]);
    expect(getHeadingNumberLabel(doc, b.id)).toBe("2");
    expect(formatHeadingNumber([1, 2, 1])).toBe("1.2.1");
  });

  it("numbers by depth even with level gaps (H1 → H3 is still 1.1)", () => {
    const a = createHeadingBlock({ level: 1 });
    const skip = createHeadingBlock({ level: 3 });
    const doc = docWith([a, skip]);
    expect(getHeadingNumberPath(doc, skip.id)).toEqual([1, 1]);
  });

  it("returns null for non-headings and unknown ids", () => {
    const paragraph = createTextBlock();
    const doc = docWith([paragraph]);
    expect(getHeadingNumberPath(doc, paragraph.id)).toBeNull();
  });
});

describe("list marker plan", () => {
  it("labels alphabetic runs through aa and restarts after interruptions", () => {
    const items = Array.from({ length: 27 }, () => createTextBlock({ variant: "numbered", listMarker: "lower-alpha" }));
    const breaker = createTextBlock({ content: "break" });
    const restart = createTextBlock({ variant: "numbered", listMarker: "lower-alpha" });
    const plan = getListMarkerPlan(docWith([...items, breaker, restart]));
    expect(plan.get(items[0]!.id)).toMatchObject({ ordinal: 1, label: "a)", runId: `document:${items[0]!.id}` });
    expect(plan.get(items[26]!.id)?.label).toBe("aa)");
    expect(plan.get(restart.id)).toMatchObject({ ordinal: 1, label: "a)", runId: `document:${restart.id}` });
  });

  it("numbers each table cell in an independent deterministic scope", () => {
    const table = createTableBlock({ columnCount: 2, rowCount: 1 });
    for (const cell of table.rows[0]!.cells) cell.blocks[0] = createTextBlock({ variant: "numbered", listMarker: "lower-alpha" });
    const plan = getListMarkerPlan(docWith([table]));
    const left = plan.get(table.rows[0]!.cells[0]!.blocks[0]!.id)!;
    const right = plan.get(table.rows[0]!.cells[1]!.blocks[0]!.id)!;
    expect(left.ordinal).toBe(1);
    expect(right.ordinal).toBe(1);
    expect(left.runId).not.toBe(right.runId);
  });

  it("starts a new run when the ordered marker style changes", () => {
    const decimal = createTextBlock({ variant: "numbered" });
    const alpha = createTextBlock({ variant: "numbered", listMarker: "lower-alpha" });
    const decimalAgain = createTextBlock({ variant: "numbered" });
    const plan = getListMarkerPlan(docWith([decimal, alpha, decimalAgain]));
    expect(plan.get(decimal.id)).toMatchObject({ ordinal: 1, label: "1." });
    expect(plan.get(alpha.id)).toMatchObject({ ordinal: 1, label: "a)" });
    expect(plan.get(decimalAgain.id)).toMatchObject({ ordinal: 1, label: "1." });
    expect(new Set([plan.get(decimal.id)?.runId, plan.get(alpha.id)?.runId, plan.get(decimalAgain.id)?.runId]).size).toBe(3);
  });
});

describe("list numbering", () => {
  it("numbers contiguous runs and restarts after a break", () => {
    const one = createTextBlock({ variant: "numbered" });
    const two = createTextBlock({ variant: "numbered" });
    const breaker = createTextBlock({ variant: "paragraph" });
    const restart = createTextBlock({ variant: "numbered" });
    const numbers = getListItemNumbers(docWith([one, two, breaker, restart]));

    expect(numbers.get(one.id)).toBe(1);
    expect(numbers.get(two.id)).toBe(2);
    expect(numbers.get(restart.id)).toBe(1);
  });

  it("continues a run across deeper-indented nested items", () => {
    const one = createTextBlock({ variant: "numbered" });
    const nestedA = createTextBlock({ variant: "numbered", indent: 1 });
    const nestedB = createTextBlock({ variant: "numbered", indent: 1 });
    const two = createTextBlock({ variant: "numbered" });
    const numbers = getListItemNumbers(docWith([one, nestedA, nestedB, two]));

    expect(numbers.get(one.id)).toBe(1);
    expect(numbers.get(nestedA.id)).toBe(1);
    expect(numbers.get(nestedB.id)).toBe(2);
    expect(numbers.get(two.id)).toBe(2);
  });

  it("clamps marker planning at the rendered depth boundary", () => {
    const first = createTextBlock({ variant: "numbered", listMarker: "lower-alpha", indent: 8 });
    const beyond = createTextBlock({ variant: "numbered", listMarker: "lower-alpha", indent: 9 });
    const last = createTextBlock({ variant: "numbered", listMarker: "lower-alpha", indent: 8 });
    const huge = createTextBlock({ variant: "numbered", listMarker: "lower-alpha", indent: Number.MAX_SAFE_INTEGER });
    const plan = getListMarkerPlan(docWith([first, beyond, last, huge]));

    expect([first, beyond, last, huge].map((block) => plan.get(block.id)?.label)).toEqual(["a)", "b)", "c)", "d)"]);
    expect([first, beyond, last, huge].map((block) => plan.get(block.id)?.level)).toEqual([8, 8, 8, 8]);
    expect(new Set([first, beyond, last, huge].map((block) => plan.get(block.id)?.runId)).size).toBe(1);
  });

  it("nested runs restart when revisited after the parent advances", () => {
    const one = createTextBlock({ variant: "numbered" });
    const nested = createTextBlock({ variant: "numbered", indent: 1 });
    const two = createTextBlock({ variant: "numbered" });
    const nestedAgain = createTextBlock({ variant: "numbered", indent: 1 });
    const numbers = getListItemNumbers(docWith([one, nested, two, nestedAgain]));

    expect(numbers.get(nested.id)).toBe(1);
    expect(numbers.get(nestedAgain.id)).toBe(1); // not 2 — the indent-1 run was closed
  });

  it("a bullet breaks numbered runs at its indent and deeper, but not shallower", () => {
    const one = createTextBlock({ variant: "numbered" });
    const nested = createTextBlock({ variant: "numbered", indent: 1 });
    const bullet = createTextBlock({ variant: "bullet", indent: 1 });
    const nestedAgain = createTextBlock({ variant: "numbered", indent: 1 });
    const two = createTextBlock({ variant: "numbered" });
    const numbers = getListItemNumbers(docWith([one, nested, bullet, nestedAgain, two]));

    expect(numbers.get(nestedAgain.id)).toBe(1); // bullet broke the indent-1 run
    expect(numbers.get(two.id)).toBe(2); // indent-0 run survived the deeper bullet
  });

  it("headings break list runs", () => {
    const one = createTextBlock({ variant: "numbered" });
    const heading = createHeadingBlock({ level: 2 });
    const restart = createTextBlock({ variant: "numbered" });
    const numbers = getListItemNumbers(docWith([one, heading, restart]));
    expect(numbers.get(restart.id)).toBe(1);
  });

  it("bullets are not numbered", () => {
    const bullet = createTextBlock({ variant: "bullet" });
    expect(getListItemNumbers(docWith([bullet])).has(bullet.id)).toBe(false);
  });
});
