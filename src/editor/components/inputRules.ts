import type { TurnIntoTarget } from "../core/transforms";
import type { HeadingLevel } from "../core/schema";

/**
 * Markdown input rules (D11). A rule fires when a paragraph's text starts
 * with the pattern and the caret sits right after the trailing space —
 * i.e. the user just typed it. The matched prefix is stripped and the
 * block converts. Backspace at offset 0 reverts the conversion.
 */

export interface InputRuleMatch {
  target: TurnIntoTarget;
  /** Length of the matched prefix (including the trailing space). */
  prefixLength: number;
}

const HEADING_RULE = /^(#{1,6}) $/;
const BULLET_RULE = /^[-*] $/;
const NUMBERED_RULE = /^\d{1,2}[.)] $/;
const ALPHA_RULE = /^a\) $/i;

/**
 * Matches against the text up to the caret. Pass exactly the leading text
 * of the block (plain text of the first inline nodes up to the caret).
 */
export function matchInputRule(textBeforeCaret: string): InputRuleMatch | null {
  const heading = HEADING_RULE.exec(textBeforeCaret);
  if (heading !== null) {
    return {
      target: { type: "heading", level: heading[1]!.length as HeadingLevel },
      prefixLength: textBeforeCaret.length,
    };
  }
  if (BULLET_RULE.test(textBeforeCaret)) {
    return { target: { type: "text", variant: "bullet" }, prefixLength: textBeforeCaret.length };
  }
  if (NUMBERED_RULE.test(textBeforeCaret)) {
    return { target: { type: "text", variant: "numbered" }, prefixLength: textBeforeCaret.length };
  }
  if (ALPHA_RULE.test(textBeforeCaret)) {
    return { target: { type: "text", variant: "numbered", listMarker: "lower-alpha" }, prefixLength: textBeforeCaret.length };
  }
  return null;
}
