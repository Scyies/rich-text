import { z } from "zod";

export const schemaVersion = "0.1.0";

export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const textAlignmentSchema = z.enum(["left", "center", "right", "justify"]);

export const customIdSchema = z.string().regex(/^custom:[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const documentTypeIdSchema = z.union([
  z.enum(["initial_petition", "answer", "reply", "interlocutory_motion"]),
  customIdSchema,
]);

export const blockRoleSchema = z.union([
  z.enum([
    "court_addressing",
    "party_qualification",
    "document_title",
    "facts",
    "preliminaries",
    "merit",
    "requests",
    "claim_value",
    "closing",
    "signature",
  ]),
  customIdSchema,
]);

export const proceduralRoleSchema = z.union([
  z.enum(["author", "defendant", "third_party", "interested_party", "representative"]),
  customIdSchema,
]);

export const documentPartyRefSchema = z.object({
  partyId: uuidSchema,
  proceduralRole: proceduralRoleSchema,
});

export const jurisdictionOverrideSchema = z.object({
  country: z.literal("BR"),
  courtSystem: z.enum(["state", "federal", "labor", "electoral", "military"]).optional(),
  state: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  court: z.string().trim().min(1).optional(),
});

export const pageSetupSchema = z.object({
  paperSize: z.enum(["A4", "Letter"]),
  orientation: z.enum(["portrait", "landscape"]),
  margins: z.object({
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
    left: z.number().nonnegative(),
    unit: z.literal("mm"),
  }),
});

export const documentPageSetupSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("style_template"),
  }),
  z.object({
    source: z.literal("document_override"),
    override: pageSetupSchema,
  }),
]);

export const placeholderBehaviorSchema = z.enum(["manual_fill", "llm_fill", "case_field"]);
export const placeholderExpectedOutputTypeSchema = z.union([
  z.enum(["short_text", "paragraph", "multi_paragraph", "money", "date", "party_name", "legal_argument"]),
  customIdSchema,
]);

export const placeholderDefinitionSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  expectedInformation: z.string().trim().min(1).optional(),
  expectedOutputType: placeholderExpectedOutputTypeSchema.optional(),
  defaultBehavior: placeholderBehaviorSchema,
  fillStrategy: z.enum(["global", "per_occurrence"]),
});

export const inlinePlaceholderStateSchema = z.enum(["unfilled", "llm_filled", "user_corrected"]);

export const inlineMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("underline") }),
  z.object({
    type: z.literal("color"),
    token: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("highlight"),
    token: z.string().trim().min(1),
  }),
]);

export const textInlineNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(inlineMarkSchema).optional(),
  origin: z
    .object({
      type: z.literal("placeholder"),
      key: z.string().trim().min(1),
    })
    .optional(),
  placeholderState: inlinePlaceholderStateSchema.optional(),
});

export const placeholderInlineNodeSchema = z.object({
  type: z.literal("placeholder"),
  key: z.string().trim().min(1),
  occurrenceId: uuidSchema.optional(),
  behaviorOverride: placeholderBehaviorSchema.optional(),
  marks: z.array(inlineMarkSchema).optional(),
});

export const inlineNodeSchema = z.discriminatedUnion("type", [textInlineNodeSchema, placeholderInlineNodeSchema]);

export const paragraphNodeSchema = z.object({
  type: z.literal("paragraph"),
  children: z.array(inlineNodeSchema),
  style: z
    .object({
      alignment: textAlignmentSchema.optional(),
      fontSizePt: z.number().positive().optional(),
    })
    .optional(),
});

export const listMarkerStyleSchema = z.enum(["decimal", "bullet", "lower_letter", "upper_letter", "lower_roman", "upper_roman"]);

export const listItemNodeSchema = z.object({
  id: uuidSchema,
  children: z.array(inlineNodeSchema),
});

export const bulletListNodeSchema = z.object({
  type: z.literal("bulletList"),
  items: z.array(listItemNodeSchema),
});

export const numberedListNodeSchema = z.object({
  type: z.literal("numberedList"),
  markerStyle: listMarkerStyleSchema.nullable().optional(),
  items: z.array(listItemNodeSchema),
});

export type InlineMark = z.infer<typeof inlineMarkSchema>;
export type TextInlineNode = z.infer<typeof textInlineNodeSchema>;
export type PlaceholderInlineNode = z.infer<typeof placeholderInlineNodeSchema>;
export type InlineNode = z.infer<typeof inlineNodeSchema>;

export interface ParagraphNode {
  type: "paragraph";
  children: InlineNode[];
  style?: {
    alignment?: "left" | "center" | "right" | "justify";
    fontSizePt?: number;
  };
}

export interface ListItemNode {
  id: string;
  children: InlineNode[];
}

export interface BulletListNode {
  type: "bulletList";
  items: ListItemNode[];
}

export interface NumberedListNode {
  type: "numberedList";
  markerStyle?: z.infer<typeof listMarkerStyleSchema> | null;
  items: ListItemNode[];
}

export interface TableNode {
  type: "table";
  columns: Array<{
    id: string;
    header?: InlineNode[];
    width?: {
      value: number;
      unit: "percent" | "px";
    };
    align?: "left" | "center" | "right";
  }>;
  rows: Array<{
    id: string;
    cells: Array<{
      columnId: string;
      children: ContentNode[];
    }>;
  }>;
  showHeader: boolean;
}

export interface ImageNode {
  type: "image";
  assetId: string;
  altText?: string;
  caption?: InlineNode[];
  size?: {
    width?: number;
    height?: number;
    unit: "px" | "percent";
  };
  alignment?: "left" | "center" | "right";
}

export type SnapshotStatus = "synced" | "modified" | "source_missing";

export interface CitationNode {
  type: "citation";
  citationId: string;
  snapshot: {
    label?: string;
    text: InlineNode[];
    source?: string;
    capturedAt: string;
    status: SnapshotStatus;
  };
  displayMode: "full" | "short" | "custom";
  customText?: InlineNode[];
}

export interface JurisprudenceNode {
  type: "jurisprudence";
  jurisprudenceId: string;
  snapshot: {
    label?: string;
    summary?: InlineNode[];
    quote?: InlineNode[];
    court?: string;
    caseNumber?: string;
    rapporteur?: string;
    judgmentDate?: string;
    publicationDate?: string;
    sourceUrl?: string;
    capturedAt: string;
    status: SnapshotStatus;
  };
  displayMode: "summary" | "quote" | "full" | "custom";
  customText?: InlineNode[];
}

export interface SignatureLineNode {
  type: "signatureLine";
  lawyerId: string;
  name: InlineNode[];
  oabText?: InlineNode[];
  roleLabel?: string;
}

export type ContentNode =
  | ParagraphNode
  | BulletListNode
  | NumberedListNode
  | TableNode
  | ImageNode
  | CitationNode
  | JurisprudenceNode
  | SignatureLineNode;

export const contentNodeSchema: z.ZodType<ContentNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    paragraphNodeSchema,
    bulletListNodeSchema,
    numberedListNodeSchema,
    tableNodeSchema,
    imageNodeSchema,
    citationNodeSchema,
    jurisprudenceNodeSchema,
    signatureLineNodeSchema,
  ]),
);

export const tableNodeSchema: z.ZodType<TableNode> = z.object({
  type: z.literal("table"),
  columns: z.array(
    z.object({
      id: uuidSchema,
      header: z.array(inlineNodeSchema).optional(),
      width: z
        .object({
          value: z.number().positive(),
          unit: z.enum(["percent", "px"]),
        })
        .optional(),
      align: z.enum(["left", "center", "right"]).optional(),
    }),
  ),
  rows: z.array(
    z.object({
      id: uuidSchema,
      cells: z.array(
        z.object({
          columnId: uuidSchema,
          children: z.array(contentNodeSchema),
        }),
      ),
    }),
  ),
  showHeader: z.boolean(),
});

export const imageNodeSchema: z.ZodType<ImageNode> = z.object({
  type: z.literal("image"),
  assetId: uuidSchema,
  altText: z.string().trim().min(1).optional(),
  caption: z.array(inlineNodeSchema).optional(),
  size: z
    .object({
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      unit: z.enum(["px", "percent"]),
    })
    .optional(),
  alignment: z.enum(["left", "center", "right"]).optional(),
});

export const snapshotStatusSchema = z.enum(["synced", "modified", "source_missing"]);

export const citationNodeSchema: z.ZodType<CitationNode> = z.object({
  type: z.literal("citation"),
  citationId: uuidSchema,
  snapshot: z.object({
    label: z.string().trim().min(1).optional(),
    text: z.array(inlineNodeSchema),
    source: z.string().trim().min(1).optional(),
    capturedAt: isoDateTimeSchema,
    status: snapshotStatusSchema,
  }),
  displayMode: z.enum(["full", "short", "custom"]),
  customText: z.array(inlineNodeSchema).optional(),
});

export const jurisprudenceNodeSchema: z.ZodType<JurisprudenceNode> = z.object({
  type: z.literal("jurisprudence"),
  jurisprudenceId: uuidSchema,
  snapshot: z.object({
    label: z.string().trim().min(1).optional(),
    summary: z.array(inlineNodeSchema).optional(),
    quote: z.array(inlineNodeSchema).optional(),
    court: z.string().trim().min(1).optional(),
    caseNumber: z.string().trim().min(1).optional(),
    rapporteur: z.string().trim().min(1).optional(),
    judgmentDate: z.string().trim().min(1).optional(),
    publicationDate: z.string().trim().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    capturedAt: isoDateTimeSchema,
    status: snapshotStatusSchema,
  }),
  displayMode: z.enum(["summary", "quote", "full", "custom"]),
  customText: z.array(inlineNodeSchema).optional(),
});

export const signatureLineNodeSchema: z.ZodType<SignatureLineNode> = z.object({
  type: z.literal("signatureLine"),
  lawyerId: uuidSchema,
  name: z.array(inlineNodeSchema),
  oabText: z.array(inlineNodeSchema).optional(),
  roleLabel: z.string().trim().min(1).optional(),
});

export const blockSourcesSchema = z.object({
  evidenceIds: z.array(uuidSchema),
  knowledgeItemIds: z.array(uuidSchema),
  sourceBlockIds: z.array(uuidSchema),
});

export const blockStyleRefSchema = z.object({
  styleRole: z.string().trim().min(1),
  styleIdOverride: uuidSchema.nullable(),
});

export const blockLayoutSchema = z.object({
  spacingBefore: z.enum(["none", "xs", "sm", "md", "lg"]).optional(),
  spacingAfter: z.enum(["none", "xs", "sm", "md", "lg"]).optional(),
  keepTogether: z.boolean().optional(),
  pageBreakBefore: z.boolean().optional(),
  alignment: textAlignmentSchema.optional(),
  fontSizePt: z.number().positive().optional(),
});

export const blockNumberingSchema = z.object({
  enabled: z.boolean(),
  includeInSequence: z.boolean(),
  format: z.literal("decimal"),
  level: z.number().int().min(1).max(6).optional(),
});

export const blockRequiredSchema = z.object({
  value: z.boolean(),
  source: z.enum(["document_type", "template", "user"]),
});

export const sourceBindingSchema = z.object({
  mode: z.enum(["live", "snapshot", "manual"]),
  sourceRefs: z.array(z.string().trim().min(1)),
  lastGeneratedAt: isoDateTimeSchema.optional(),
});

export const blockProvenanceSchema = z.object({
  createdBy: z.enum(["user", "llm", "template", "system"]),
  createdAt: isoDateTimeSchema,
  updatedBy: z.enum(["user", "llm", "system"]),
  updatedAt: isoDateTimeSchema,
  lastInstruction: z.string().trim().min(1).optional(),
});

export const blockWorkflowSchema = z.object({
  locked: z.boolean(),
});

const baseBlockSchema = z.object({
  id: uuidSchema,
  role: blockRoleSchema,
  legalTopic: z.string().trim().min(1).optional(),
  required: blockRequiredSchema,
  style: blockStyleRefSchema,
  layout: blockLayoutSchema.optional(),
  numbering: blockNumberingSchema.optional(),
  sources: blockSourcesSchema,
  sourceBinding: sourceBindingSchema.optional(),
  provenance: blockProvenanceSchema,
  workflow: blockWorkflowSchema.default({ locked: false }),
});

export const headingBlockSchema = baseBlockSchema.extend({
  type: z.literal("heading"),
  title: z.array(inlineNodeSchema),
});

export const sectionBlockSchema = baseBlockSchema.extend({
  type: z.literal("section"),
  title: z.array(inlineNodeSchema).nullable(),
  level: z.number().int().min(1).max(6),
  parentBlockId: uuidSchema.nullable(),
  content: z.array(contentNodeSchema),
});

export const contentBlockSchema = baseBlockSchema.extend({
  type: z.literal("content"),
  title: z.array(inlineNodeSchema).nullable(),
  content: z.array(contentNodeSchema),
});

export const requestCategorySchema = z.enum(["procedural", "merit", "urgent_relief", "evidence", "costs", "other"]);

export const legalRequestSchema = z.object({
  id: uuidSchema,
  text: z.array(inlineNodeSchema),
  style: z
    .object({
      alignment: textAlignmentSchema.optional(),
      fontSizePt: z.number().positive().optional(),
    })
    .optional(),
  category: requestCategorySchema,
  required: z.boolean(),
  sources: z.object({
    supportingBlockIds: z.array(uuidSchema),
    evidenceIds: z.array(uuidSchema),
    knowledgeItemIds: z.array(uuidSchema),
  }),
});

export const requestListStyleSchema = z.object({
  styleRole: z.literal("request_list"),
  markerOverride: listMarkerStyleSchema.nullable(),
});

export const requestListBlockSchema = baseBlockSchema.extend({
  type: z.literal("request_list"),
  role: z.literal("requests"),
  title: z.array(inlineNodeSchema).nullable(),
  listStyle: requestListStyleSchema,
  requests: z.array(legalRequestSchema),
});

export const signatureBlockSchema = baseBlockSchema.extend({
  type: z.literal("signature"),
  role: z.literal("signature"),
  title: z.array(inlineNodeSchema).nullable(),
  content: z.array(signatureLineNodeSchema),
});

export const legalDocumentBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  sectionBlockSchema,
  contentBlockSchema,
  requestListBlockSchema,
  signatureBlockSchema,
]);

export const legalDocumentSchema = z.object({
  id: uuidSchema,
  schemaVersion: z.literal(schemaVersion),
  kind: z.enum(["template", "case_document"]),
  documentType: documentTypeIdSchema,
  title: z.string().trim().min(1),
  status: z.enum(["draft", "archived"]),
  language: z.literal("pt-BR"),
  contextRefs: z.object({
    workspaceId: uuidSchema,
    caseId: uuidSchema.optional(),
    partyRefs: z.array(documentPartyRefSchema),
    lawyerRefs: z.array(uuidSchema),
  }),
  contextOverrides: z
    .object({
      jurisdiction: jurisdictionOverrideSchema.optional(),
    })
    .optional(),
  styleTemplate: z.object({
    templateId: uuidSchema,
  }),
  pageSetup: documentPageSetupSchema.optional(),
  placeholders: z.array(placeholderDefinitionSchema),
  blocks: z.array(legalDocumentBlockSchema),
  metadata: z.object({
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  }),
});

export const validationIssueSchema = z.object({
  id: uuidSchema,
  severity: z.enum(["error", "warning", "info"]),
  code: z.union([
    z.enum([
      "required_block_empty",
      "invalid_document_structure",
      "export_unresolvable_content",
      "unresolved_placeholder",
      "request_without_supporting_block",
      "block_without_sources",
      "empty_optional_block",
      "missing_common_role",
      "missing_style_template",
      "missing_block_style_override",
      "missing_color_token",
      "missing_document_type",
      "missing_citation_source",
      "missing_jurisprudence_source",
    ]),
    customIdSchema,
  ]),
  message: z.string().trim().min(1),
  blockId: uuidSchema.optional(),
  requestId: uuidSchema.optional(),
});

export const documentRevisionSchema = z.object({
  id: uuidSchema,
  documentId: uuidSchema,
  createdAt: isoDateTimeSchema,
  createdBy: z.enum(["user", "llm", "system"]),
  reason: z.enum(["manual_save", "before_llm_edit", "before_export", "restore_point"]),
  label: z.string().trim().min(1).optional(),
  snapshot: legalDocumentSchema,
});

const editableBlockChangesSchema = z.object({
  role: blockRoleSchema.optional(),
  legalTopic: z.string().trim().min(1).nullable().optional(),
  required: blockRequiredSchema.optional(),
  style: blockStyleRefSchema.optional(),
  layout: blockLayoutSchema.nullable().optional(),
  numbering: blockNumberingSchema.nullable().optional(),
  sources: blockSourcesSchema.optional(),
  title: z.array(inlineNodeSchema).nullable().optional(),
  content: z.array(contentNodeSchema).optional(),
  level: z.number().int().min(1).max(6).optional(),
  parentBlockId: uuidSchema.nullable().optional(),
});

const newBlockInputSchema = z.discriminatedUnion("type", [
  headingBlockSchema.omit({ id: true, provenance: true }),
  sectionBlockSchema.omit({ id: true, provenance: true }),
  contentBlockSchema.omit({ id: true, provenance: true }),
  requestListBlockSchema.omit({ id: true, provenance: true }),
  signatureBlockSchema.omit({ id: true, provenance: true }),
]);

const newRequestInputSchema = legalRequestSchema.omit({
  id: true,
});

export const documentPatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update_block"),
    blockId: uuidSchema,
    changes: editableBlockChangesSchema,
  }),
  z.object({
    op: z.literal("insert_block_after"),
    afterBlockId: uuidSchema.nullable(),
    block: newBlockInputSchema,
  }),
  z.object({
    op: z.literal("delete_block"),
    blockId: uuidSchema,
  }),
  z.object({
    op: z.literal("move_block"),
    blockId: uuidSchema,
    afterBlockId: uuidSchema.nullable(),
  }),
  z.object({
    op: z.literal("update_request"),
    blockId: uuidSchema,
    requestId: uuidSchema,
    changes: legalRequestSchema.partial().omit({ id: true }),
  }),
  z.object({
    op: z.literal("insert_request"),
    blockId: uuidSchema,
    afterRequestId: uuidSchema.nullable(),
    request: newRequestInputSchema,
  }),
  z.object({
    op: z.literal("delete_request"),
    blockId: uuidSchema,
    requestId: uuidSchema,
  }),
]);

export const llmEditSessionMetricsSchema = z.object({
  id: uuidSchema,
  documentId: uuidSchema,
  createdAt: isoDateTimeSchema,
  instruction: z.string().trim().min(1),
  targetBlockIds: z.array(uuidSchema),
  proposedPatchCount: z.number().int().nonnegative(),
  acceptedPatchCount: z.number().int().nonnegative(),
  rejectedPatchCount: z.number().int().nonnegative(),
  userAdjustmentCount: z.number().int().nonnegative(),
  finalOutcome: z.enum(["accepted", "partially_accepted", "rejected"]),
});

export type DocumentTypeId = z.infer<typeof documentTypeIdSchema>;
export type BlockRole = z.infer<typeof blockRoleSchema>;
export type ProceduralRole = z.infer<typeof proceduralRoleSchema>;
export type DocumentPartyRef = z.infer<typeof documentPartyRefSchema>;
export type JurisdictionOverride = z.infer<typeof jurisdictionOverrideSchema>;
export type PageSetup = z.infer<typeof pageSetupSchema>;
export type DocumentPageSetup = z.infer<typeof documentPageSetupSchema>;
export type PlaceholderBehavior = z.infer<typeof placeholderBehaviorSchema>;
export type PlaceholderExpectedOutputType = z.infer<typeof placeholderExpectedOutputTypeSchema>;
export type PlaceholderDefinition = z.infer<typeof placeholderDefinitionSchema>;
export type InlinePlaceholderState = z.infer<typeof inlinePlaceholderStateSchema>;
export type ListMarkerStyle = z.infer<typeof listMarkerStyleSchema>;
export type RequestCategory = z.infer<typeof requestCategorySchema>;
export type LegalRequest = z.infer<typeof legalRequestSchema>;
export type RequestListStyle = z.infer<typeof requestListStyleSchema>;
export type BlockSources = z.infer<typeof blockSourcesSchema>;
export type BlockStyleRef = z.infer<typeof blockStyleRefSchema>;
export type BlockLayout = z.infer<typeof blockLayoutSchema>;
export type BlockNumbering = z.infer<typeof blockNumberingSchema>;
export type BlockRequired = z.infer<typeof blockRequiredSchema>;
export type SourceBinding = z.infer<typeof sourceBindingSchema>;
export type BlockProvenance = z.infer<typeof blockProvenanceSchema>;
export type BlockWorkflow = z.infer<typeof blockWorkflowSchema>;
export type HeadingBlock = z.infer<typeof headingBlockSchema>;
export type SectionBlock = z.infer<typeof sectionBlockSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type RequestListBlock = z.infer<typeof requestListBlockSchema>;
export type SignatureBlock = z.infer<typeof signatureBlockSchema>;
export type LegalDocumentBlock = z.infer<typeof legalDocumentBlockSchema>;
export type LegalDocument = z.infer<typeof legalDocumentSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type DocumentRevision = z.infer<typeof documentRevisionSchema>;
export type DocumentPatch = z.infer<typeof documentPatchSchema>;
export type LlmEditSessionMetrics = z.infer<typeof llmEditSessionMetricsSchema>;
