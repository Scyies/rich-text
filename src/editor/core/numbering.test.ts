import { describe, expect, it } from "vitest";
import { createHeadingBlock, createTextBlock } from "./factories";
import {
  formatHeadingNumber,
  getHeadingNumberLabel,
  getHeadingNumberPath,
  getListItemNumbers,
} from "./numbering";
import { SCHEMA_VERSION, type Block, type WealthyDocument } from "./schema";

function docWith(blocks: Block[]): WealthyDocument {
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
