import type { BlockMeta } from "../core/schema";
import type {
  BlockTypeRegistration,
  CustomSlashItem,
  EditorPlugin,
  InlineObjectRegistration,
  ToolbarItemRegistration,
} from "./types";

/**
 * Resolves an array of plugins into the lookup structures the editor uses at
 * render time. Per-`kind` registrations (blocks, inline objects) follow a
 * later-wins rule, so a host can override an earlier plugin's renderer;
 * slash and toolbar items accumulate in registration order. Duplicate plugin
 * names throw — they signal an accidental double-registration.
 */

export interface PluginRegistry<TMeta extends BlockMeta = BlockMeta> {
  blockRenderers: Map<string, BlockTypeRegistration<TMeta>["render"]>;
  inlineObjects: Map<string, InlineObjectRegistration>;
  slashItems: CustomSlashItem<TMeta>[];
  toolbarItems: ToolbarItemRegistration<TMeta>[];
}

export function buildPluginRegistry<TMeta extends BlockMeta = BlockMeta>(
  plugins: EditorPlugin<TMeta>[],
): PluginRegistry<TMeta> {
  const blockRenderers = new Map<string, BlockTypeRegistration<TMeta>["render"]>();
  const inlineObjects = new Map<string, InlineObjectRegistration>();
  const slashItems: CustomSlashItem<TMeta>[] = [];
  const toolbarItems: ToolbarItemRegistration<TMeta>[] = [];
  const names = new Set<string>();

  for (const plugin of plugins) {
    if (names.has(plugin.name)) {
      throw new Error(`buildPluginRegistry: duplicate plugin name "${plugin.name}"`);
    }
    names.add(plugin.name);

    for (const registration of plugin.blockTypes ?? []) {
      blockRenderers.set(registration.kind, registration.render);
    }
    for (const registration of plugin.inlineObjects ?? []) {
      inlineObjects.set(registration.kind, registration);
    }
    if (plugin.slashItems !== undefined) {
      slashItems.push(...plugin.slashItems);
    }
    if (plugin.toolbarItems !== undefined) {
      toolbarItems.push(...plugin.toolbarItems);
    }
  }

  return { blockRenderers, inlineObjects, slashItems, toolbarItems };
}
