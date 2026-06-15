import type { ImageGroupEntry } from "./schema";

/**
 * Resolves image-group column widths for rendering/export without mutating the
 * document. Explicit widths are honored when possible; missing widths split the
 * remainder. Fully explicit rows below 100% are scaled up to fill the row.
 */
export function resolveImageGroupColumnWidths(
  entries: readonly Pick<ImageGroupEntry, "columnWidth">[],
): number[] {
  if (entries.length === 0) {
    return [];
  }

  const explicitSum = entries.reduce((sum, entry) => sum + (entry.columnWidth?.value ?? 0), 0);
  const missingCount = entries.filter((entry) => entry.columnWidth === undefined).length;

  if (explicitSum <= 0) {
    return entries.map(() => 100 / entries.length);
  }

  if (explicitSum > 100) {
    return entries.map((entry) => ((entry.columnWidth?.value ?? 0) / explicitSum) * 100);
  }

  if (missingCount > 0) {
    const missingWidth = (100 - explicitSum) / missingCount;
    return entries.map((entry) => entry.columnWidth?.value ?? missingWidth);
  }

  return entries.map((entry) => ((entry.columnWidth?.value ?? 0) / explicitSum) * 100);
}
