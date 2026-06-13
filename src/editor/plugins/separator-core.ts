import { createCustomBlock } from "../core/factories";
import type { BlockMeta, CustomBlock } from "../core/schema";

export const SEPARATOR_BLOCK_KIND = "separator";

export interface CreateSeparatorBlockInput<TMeta extends BlockMeta = BlockMeta> {
  data?: Record<string, unknown> | undefined;
  meta?: TMeta | undefined;
}

export function createSeparatorBlock<TMeta extends BlockMeta = BlockMeta>(
  input: CreateSeparatorBlockInput<TMeta> = {},
): CustomBlock<TMeta> {
  return createCustomBlock<TMeta>({
    kind: SEPARATOR_BLOCK_KIND,
    data: input.data ?? {},
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  });
}
