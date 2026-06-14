import { describe, expect, it } from "vitest";
import { en, ptBR, resolveMessages, DEFAULT_LOCALE } from "./messages";

describe("i18n dictionaries", () => {
  it("en and pt-BR expose exactly the same keys", () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
  });

  it("every value is present (no empty strings) in both locales", () => {
    for (const dict of [en, ptBR]) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === "string") {
          expect(value.length, key).toBeGreaterThan(0);
        } else {
          expect(typeof value, key).toBe("function");
        }
      }
    }
  });

  it("the heading aria label interpolates the level", () => {
    expect(en.headingAriaLabel(2)).toBe("Heading 2");
    expect(ptBR.headingAriaLabel(2)).toBe("Título 2");
  });
});

describe("resolveMessages", () => {
  it("defaults to English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(resolveMessages()).toBe(en);
    expect(resolveMessages("en")).toBe(en);
  });

  it("resolves a locale", () => {
    expect(resolveMessages("pt-BR")).toBe(ptBR);
  });

  it("applies a shallow override without mutating the base dictionary", () => {
    const resolved = resolveMessages("en", { slashNoResults: "Nothing here" });
    expect(resolved.slashNoResults).toBe("Nothing here");
    expect(resolved.slashHeading1).toBe(en.slashHeading1);
    expect(en.slashNoResults).toBe("No results");
  });
});
