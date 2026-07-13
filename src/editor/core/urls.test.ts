import { describe, expect, it } from "vitest";
import { isSafeLinkHref, sanitizeLinkHref } from "./urls";

describe("safe link URLs", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "mailto:legal@example.com",
    "tel:+5511999999999",
    "/documents/123",
    "../documents/123",
    "#section",
    "//cdn.example.com/file",
  ])("allows %s", (href) => expect(isSafeLinkHref(href)).toBe(true));

  it.each(["javascript:alert(1)", "data:text/html,x", "vbscript:msgbox(1)", "java\nscript:alert(1)", ""])(
    "rejects %s",
    (href) => expect(isSafeLinkHref(href)).toBe(false),
  );

  it("trims safe targets", () => expect(sanitizeLinkHref("  https://example.com  ")).toBe("https://example.com"));
});
