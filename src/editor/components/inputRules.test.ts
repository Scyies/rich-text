import { describe, expect, it } from "vitest";
import { matchInputRule } from "./inputRules";

describe("matchInputRule", () => {
  it("matches heading rules # through ######", () => {
    expect(matchInputRule("# ")).toEqual({ target: { type: "heading", level: 1 }, prefixLength: 2 });
    expect(matchInputRule("### ")).toEqual({ target: { type: "heading", level: 3 }, prefixLength: 4 });
    expect(matchInputRule("###### ")).toEqual({ target: { type: "heading", level: 6 }, prefixLength: 7 });
    expect(matchInputRule("####### ")).toBeNull();
  });

  it("matches bullet rules - and *", () => {
    expect(matchInputRule("- ")).toEqual({ target: { type: "text", variant: "bullet" }, prefixLength: 2 });
    expect(matchInputRule("* ")).toEqual({ target: { type: "text", variant: "bullet" }, prefixLength: 2 });
  });

  it("matches numbered rules with . and )", () => {
    expect(matchInputRule("1. ")).toEqual({ target: { type: "text", variant: "numbered" }, prefixLength: 3 });
    expect(matchInputRule("12) ")).toEqual({ target: { type: "text", variant: "numbered" }, prefixLength: 4 });
    expect(matchInputRule("123. ")).toBeNull();
  });

  it("requires the trailing space and nothing after it", () => {
    expect(matchInputRule("#")).toBeNull();
    expect(matchInputRule("# x")).toBeNull();
    expect(matchInputRule("-x ")).toBeNull();
    expect(matchInputRule("")).toBeNull();
  });
});
