import { describe, expect, it } from "vitest";
import { createHeadingBlock, createTextBlock } from "./factories";
import { getImpliedLevelAt, getSection, getSectionRange, getSectionTree } from "./sections";
import { SCHEMA_VERSION, type MogulDocument } from "./schema";

const h1 = createHeadingBlock({ level: 1, content: "H1" });
const h1p1 = createTextBlock({ content: "h1 paragraph" });
const h2a = createHeadingBlock({ level: 2, content: "H2a" });
const h2aP = createTextBlock({ content: "h2a paragraph" });
const h3 = createHeadingBlock({ level: 3, content: "H3" });
const h3p = createTextBlock({ content: "h3 paragraph" });
const h2b = createHeadingBlock({ level: 2, content: "H2b" });
const h1b = createHeadingBlock({ level: 1, content: "second H1" });
const tail = createTextBlock({ content: "tail" });

const doc: MogulDocument = {
  schemaVersion: SCHEMA_VERSION,
  blocks: [h1, h1p1, h2a, h2aP, h3, h3p, h2b, h1b, tail],
};

describe("getSectionTree", () => {
  it("derives nested sections from heading levels", () => {
    const tree = getSectionTree(doc);
    expect(tree.preamble).toEqual([]);
    expect(tree.sections).toHaveLength(2);

    const first = tree.sections[0]!;
    expect(first.heading.id).toBe(h1.id);
    expect(first.blocks).toEqual([h1p1]);
    expect(first.subsections.map((section) => section.heading.id)).toEqual([h2a.id, h2b.id]);

    const h2aSection = first.subsections[0]!;
    expect(h2aSection.blocks).toEqual([h2aP]);
    expect(h2aSection.subsections.map((section) => section.heading.id)).toEqual([h3.id]);
    expect(h2aSection.subsections[0]!.blocks).toEqual([h3p]);

    const second = tree.sections[1]!;
    expect(second.heading.id).toBe(h1b.id);
    expect(second.blocks).toEqual([tail]);
  });

  it("puts blocks before the first heading in the preamble", () => {
    const intro = createTextBlock({ content: "intro" });
    const tree = getSectionTree({ schemaVersion: SCHEMA_VERSION, blocks: [intro, h1, h1p1] });
    expect(tree.preamble).toEqual([intro]);
    expect(tree.sections).toHaveLength(1);
  });

  it("handles level gaps: H1 followed by H3 nests directly", () => {
    const deep = createHeadingBlock({ level: 3, content: "deep" });
    const tree = getSectionTree({ schemaVersion: SCHEMA_VERSION, blocks: [h1, deep] });
    expect(tree.sections[0]!.subsections.map((section) => section.heading.id)).toEqual([deep.id]);
  });

  it("a same-level heading closes the previous section", () => {
    const tree = getSectionTree(doc);
    // h2b must be a sibling of h2a, not nested under h3.
    expect(tree.sections[0]!.subsections.map((section) => section.heading.id)).toEqual([h2a.id, h2b.id]);
  });

  it("turning a paragraph into a heading recaptures containment automatically (D1)", () => {
    // The same flat array with h2aP as a level-2 heading: following blocks reflow.
    const promoted = { ...h2aP, type: "heading" as const, level: 2 as const, content: h2aP.content };
    const { variant: _variant, ...promotedHeading } = promoted as typeof promoted & { variant?: unknown };
    const reflowed = getSectionTree({
      schemaVersion: SCHEMA_VERSION,
      blocks: [h1, h1p1, h2a, promotedHeading as never, h3, h3p, h2b],
    });
    const first = reflowed.sections[0]!;
    // h2a lost its paragraph; the promoted heading now owns h3.
    expect(first.subsections.map((section) => section.heading.id)).toEqual([
      h2a.id,
      promotedHeading.id,
      h2b.id,
    ]);
    expect(first.subsections[0]!.blocks).toEqual([]);
    expect(first.subsections[1]!.subsections[0]!.heading.id).toBe(h3.id);
  });
});

describe("getSection / getSectionRange", () => {
  it("finds nested sections by heading id", () => {
    expect(getSection(doc, h3.id)?.blocks).toEqual([h3p]);
    expect(getSection(doc, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("returns the flat range covering the heading and all descendants", () => {
    expect(getSectionRange(doc, h1.id)).toEqual({ start: 0, end: 7 });
    expect(getSectionRange(doc, h2a.id)).toEqual({ start: 2, end: 6 });
    expect(getSectionRange(doc, h3.id)).toEqual({ start: 4, end: 6 });
    expect(getSectionRange(doc, h1b.id)).toEqual({ start: 7, end: 9 });
  });

  it("returns null for non-heading blocks", () => {
    expect(getSectionRange(doc, h1p1.id)).toBeNull();
  });
});

describe("getImpliedLevelAt (D4)", () => {
  it("is 1 at the top of the document", () => {
    expect(getImpliedLevelAt(doc, 0)).toBe(1);
  });

  it("is one deeper than the innermost open section", () => {
    expect(getImpliedLevelAt(doc, 2)).toBe(2); // inside H1
    expect(getImpliedLevelAt(doc, 4)).toBe(3); // inside H2a
    expect(getImpliedLevelAt(doc, 6)).toBe(4); // inside H3
    expect(getImpliedLevelAt(doc, 7)).toBe(3); // after H2b heading
  });

  it("clamps at 6", () => {
    const h6 = createHeadingBlock({ level: 6, content: "deepest" });
    const docWithH6: MogulDocument = { schemaVersion: SCHEMA_VERSION, blocks: [h6] };
    expect(getImpliedLevelAt(docWithH6, 1)).toBe(6);
  });
});
