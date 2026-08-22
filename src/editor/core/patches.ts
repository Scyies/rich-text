import { z } from "zod";
import { generateBlockId } from "./factories";
import {
  blockIdSchema,
  blockSchema,
  documentSchema,
  headingLevelSchema,
  orderedListMarkerSchema,
  type Block,
  type BlockMeta,
  type MogulDocument,
} from "./schema";
import {
  deleteBlock,
  deleteSection,
  duplicateSection,
  insertBlockAfter,
  moveBlock,
  moveSection,
  turnInto,
  updateBlock,
  type TurnIntoTarget,
} from "./transforms";

/**
 * Patch pipeline (D10): the single entry point for external edits —
 * LLM-generated, server-generated, or host-driven. Patches are wire data:
 * validated with Zod, applied sequentially, and atomic (any failure leaves
 * the document untouched). The final document is fully re-validated, since
 * patch authors are untrusted.
 */

/** Inserted blocks may omit `id`; one is generated on the way in. */
const insertableBlockSchema = z.preprocess((value) => {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && !("id" in value)) {
    return { ...value, id: generateBlockId() };
  }
  return value;
}, blockSchema);

export const turnIntoTargetSchema = z.union([
  z.object({ type: z.literal("heading"), level: headingLevelSchema }),
  z.object({ type: z.literal("text"), variant: z.literal("numbered"), listMarker: orderedListMarkerSchema.optional() }),
  z.object({ type: z.literal("text"), variant: z.enum(["paragraph", "bullet"]) }),
]);

const documentPatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update_block"),
    blockId: blockIdSchema,
    changes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("insert_block_after"),
    afterBlockId: blockIdSchema.nullable(),
    block: insertableBlockSchema,
  }),
  z.object({
    op: z.literal("delete_block"),
    blockId: blockIdSchema,
  }),
  z.object({
    op: z.literal("move_block"),
    blockId: blockIdSchema,
    afterBlockId: blockIdSchema.nullable(),
  }),
  z.object({
    op: z.literal("turn_into"),
    blockId: blockIdSchema,
    target: turnIntoTargetSchema,
  }),
  z.object({
    op: z.literal("move_section"),
    headingId: blockIdSchema,
    afterBlockId: blockIdSchema.nullable(),
  }),
  z.object({
    op: z.literal("delete_section"),
    headingId: blockIdSchema,
  }),
  z.object({
    op: z.literal("duplicate_section"),
    headingId: blockIdSchema,
  }),
]);

type WithOptionalId<T> = T extends Block ? Omit<T, "id"> & { id?: string } : never;
export type InsertableBlock = WithOptionalId<Block>;
export type DocumentPatch =
  | { op: "update_block"; blockId: string; changes: Record<string, unknown> }
  | { op: "insert_block_after"; afterBlockId: string | null; block: Block | InsertableBlock }
  | { op: "delete_block"; blockId: string }
  | { op: "move_block"; blockId: string; afterBlockId: string | null }
  | { op: "turn_into"; blockId: string; target: TurnIntoTarget }
  | { op: "move_section"; headingId: string; afterBlockId: string | null }
  | { op: "delete_section"; headingId: string }
  | { op: "duplicate_section"; headingId: string };

export class PatchError extends Error {
  constructor(
    message: string,
    public readonly patchIndex: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PatchError";
  }
}

export interface ApplyPatchesResult<
  TMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
> {
  document: MogulDocument<TMeta, TDocMeta>;
  /** The validated patches that were applied, in order. */
  applied: DocumentPatch[];
}

export function applyPatches<TMeta extends BlockMeta, TDocMeta extends BlockMeta = BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  patches: unknown,
): ApplyPatchesResult<TMeta, TDocMeta> {
  const parsed = z.array(documentPatchSchema).safeParse(patches);
  if (!parsed.success) {
    throw new PatchError(`applyPatches: invalid patches: ${parsed.error.message}`, null, {
      cause: parsed.error,
    });
  }

  let result = document;
  parsed.data.forEach((patch, index) => {
    try {
      result = applyPatch(result, patch as DocumentPatch);
    } catch (error) {
      throw new PatchError(
        `applyPatches: patch ${index} (${patch.op}) failed: ${(error as Error).message}`,
        index,
        { cause: error },
      );
    }
  });

  const validated = documentSchema.safeParse(result);
  if (!validated.success) {
    throw new PatchError(
      `applyPatches: resulting document is invalid: ${validated.error.message}`,
      null,
      { cause: validated.error },
    );
  }

  return { document: result, applied: parsed.data as DocumentPatch[] };
}

function applyPatch<TMeta extends BlockMeta, TDocMeta extends BlockMeta>(
  document: MogulDocument<TMeta, TDocMeta>,
  patch: DocumentPatch,
): MogulDocument<TMeta, TDocMeta> {
  switch (patch.op) {
    case "update_block":
      return updateBlock(document, patch.blockId, patch.changes);
    case "insert_block_after":
      return insertBlockAfter(
        document,
        patch.afterBlockId,
        patch.block as MogulDocument<TMeta, TDocMeta>["blocks"][number],
      );
    case "delete_block":
      return deleteBlock(document, patch.blockId);
    case "move_block":
      return moveBlock(document, patch.blockId, patch.afterBlockId);
    case "turn_into":
      return turnInto(document, patch.blockId, patch.target as TurnIntoTarget);
    case "move_section":
      return moveSection(document, patch.headingId, patch.afterBlockId);
    case "delete_section":
      return deleteSection(document, patch.headingId);
    case "duplicate_section":
      return duplicateSection(document, patch.headingId).document;
  }
}
