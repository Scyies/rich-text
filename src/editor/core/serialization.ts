import { validateDocument, type BlockMeta, type WealthyDocument } from "./schema";

/**
 * Serializes a document to JSON. The document is validated first so a
 * corrupt in-memory state fails loudly instead of being persisted.
 */
export function serializeDocument<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
>(document: WealthyDocument<TBlockMeta, TDocMeta>): string {
  return JSON.stringify(validateDocument(document));
}

/**
 * Parses and validates a serialized document. The `meta` bags on the
 * document, blocks, and inline objects round-trip untouched (D5) — the
 * library never interprets or strips keys inside them.
 */
export function deserializeDocument<
  TBlockMeta extends BlockMeta = BlockMeta,
  TDocMeta extends BlockMeta = BlockMeta,
>(json: string): WealthyDocument<TBlockMeta, TDocMeta> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(`deserializeDocument: input is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return validateDocument(parsed) as WealthyDocument<TBlockMeta, TDocMeta>;
}
