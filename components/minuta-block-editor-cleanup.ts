import type { ContentNode, InlineNode, LegalDocumentBlock } from "../shared/document-schema";

function replaceBlock(block: LegalDocumentBlock, update: (draft: LegalDocumentBlock) => void): LegalDocumentBlock {
  const draft = structuredClone(block) as LegalDocumentBlock;
  update(draft);
  return draft;
}

function getInlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.text;
      }

      return node.key;
    })
    .join("");
}

function normalizeInlineNodesForEdit(nodes: InlineNode[]): InlineNode[] {
  const normalized = nodes.map((node): InlineNode => {
    if (node.type === "text") {
      return node;
    }

    return {
      type: "text",
      text: node.key,
      origin: {
        type: "placeholder",
        key: node.key,
      },
      placeholderState: "unfilled",
      ...(node.marks ? { marks: node.marks } : {}),
    };
  });

  return normalized.length > 0 ? normalized : [{ type: "text", text: "" }];
}

function isInlineTextBlank(nodes: InlineNode[]): boolean {
  return getInlineText(normalizeInlineNodesForEdit(nodes)).trim().length === 0;
}

function isBlankParagraphNode(node: ContentNode): boolean {
  return node.type === "paragraph" && isInlineTextBlank(node.children);
}

function cleanupContentRowsForSave(content: ContentNode[]): ContentNode[] {
  const cleanedNodes = content.flatMap((node): ContentNode[] => {
    if (node.type === "paragraph") {
      return isBlankParagraphNode(node) ? [] : [node];
    }

    if (node.type === "bulletList" || node.type === "numberedList") {
      const items = node.items.filter((item) => !isInlineTextBlank(item.children));
      return items.length > 0 ? [{ ...node, items }] : [];
    }

    return [node];
  });

  while (cleanedNodes.length > 0 && isBlankParagraphNode(cleanedNodes[cleanedNodes.length - 1])) {
    cleanedNodes.pop();
  }

  return cleanedNodes;
}

export function cleanupManualEditBlockForSave(block: LegalDocumentBlock): LegalDocumentBlock {
  if (block.type !== "section" && block.type !== "content") {
    return block;
  }

  return replaceBlock(block, (draft) => {
    if (draft.type === "section" || draft.type === "content") {
      draft.content = cleanupContentRowsForSave(draft.content);
    }
  });
}
