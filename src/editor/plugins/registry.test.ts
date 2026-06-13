import { describe, expect, it } from "vitest";
import { buildPluginRegistry } from "./registry";
import type { EditorPlugin } from "./types";

describe("buildPluginRegistry", () => {
  it("indexes block + inline-object renderers by kind and accumulates items", () => {
    const plugin: EditorPlugin = {
      name: "demo",
      blockTypes: [{ kind: "callout", render: () => null }],
      inlineObjects: [{ kind: "placeholder", getLabel: () => "x" }],
      slashItems: [{ id: "ph", label: "Placeholder", apply: () => {} }],
      toolbarItems: [{ id: "hl", label: "H", apply: () => {} }],
    };
    const registry = buildPluginRegistry([plugin]);

    expect(registry.blockRenderers.has("callout")).toBe(true);
    expect(registry.inlineObjects.get("placeholder")?.getLabel?.({ type: "object", kind: "placeholder", data: {} })).toBe("x");
    expect(registry.slashItems).toHaveLength(1);
    expect(registry.toolbarItems).toHaveLength(1);
  });

  it("lets a later plugin override an earlier renderer for the same kind", () => {
    const first = () => "first" as unknown as null;
    const second = () => "second" as unknown as null;
    const registry = buildPluginRegistry([
      { name: "a", blockTypes: [{ kind: "callout", render: first }] },
      { name: "b", blockTypes: [{ kind: "callout", render: second }] },
    ]);
    expect(registry.blockRenderers.get("callout")).toBe(second);
  });

  it("throws on duplicate plugin names", () => {
    expect(() => buildPluginRegistry([{ name: "dup" }, { name: "dup" }])).toThrow(/duplicate plugin name/);
  });

  it("tolerates plugins that register nothing", () => {
    const registry = buildPluginRegistry([{ name: "empty" }]);
    expect(registry.blockRenderers.size).toBe(0);
    expect(registry.slashItems).toHaveLength(0);
  });
});
