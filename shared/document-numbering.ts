import type { InlineNode, LegalDocument, LegalDocumentBlock } from "./document-schema";

const titleNumberingRoles = new Set<LegalDocumentBlock["role"]>([
  "facts",
  "preliminaries",
  "merit",
  "requests",
  "claim_value",
]);

export function getBlockTitleNumber(document: LegalDocument, block: LegalDocumentBlock): string | null {
  const counters: number[] = [];

  for (const candidate of document.blocks) {
    if (shouldNumberBlockTitle(candidate)) {
      incrementCounters(counters, getBlockNumberingLevel(candidate));
    }

    if (candidate.id === block.id) {
      return shouldNumberBlockTitle(candidate) ? getDisplayNumber(counters, getBlockNumberingLevel(candidate)) : null;
    }
  }

  return null;
}

export function getBlockTitleNumberLabel(document: LegalDocument, block: LegalDocumentBlock): string | null {
  const number = getBlockTitleNumber(document, block);
  return number === null ? null : number.toString();
}

export function getNumberedTitlePrefix(document: LegalDocument, block: LegalDocumentBlock): string | null {
  const label = getBlockTitleNumberLabel(document, block);
  return label === null ? null : `${label}. `;
}

export function isBlockTitleNumberingEnabled(block: LegalDocumentBlock): boolean {
  return shouldNumberBlockTitle(block);
}

export function getBlockNumberingLevel(block: LegalDocumentBlock): number {
  return block.numbering?.level ?? 1;
}

export function withNumberedTitlePrefix(title: InlineNode[], prefix: string | null): InlineNode[] {
  if (!prefix) {
    return title;
  }

  return [{ type: "text", text: prefix }, ...title];
}

function shouldNumberBlockTitle(block: LegalDocumentBlock): boolean {
  if (!hasVisibleTitle(block)) {
    return false;
  }

  if (block.numbering) {
    return block.numbering.enabled && block.numbering.includeInSequence && block.numbering.format === "decimal";
  }

  return titleNumberingRoles.has(block.role);
}

function incrementCounters(counters: number[], level: number): void {
  const index = level - 1;

  for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
    counters[currentIndex] = counters[currentIndex] || 1;
  }

  counters[index] = (counters[index] || 0) + 1;
  counters.length = level;
}

function getDisplayNumber(counters: number[], level: number): string {
  return counters.slice(0, level).join(".");
}

function hasVisibleTitle(block: LegalDocumentBlock): boolean {
  return "title" in block && Array.isArray(block.title) && block.title.length > 0;
}
