import { z } from "zod";
import { inlineNodeSchema, type InlineNode, type LegalDocument, type ListMarkerStyle } from "./document-schema";

export type PaperSize = "A4" | "Letter";
export type PageOrientation = "portrait" | "landscape";
export type TextAlignment = "left" | "center" | "right" | "justify";
export type SourceBlockKind = "citation" | "jurisprudence";
export type SourceLayoutPreset = "plain" | "icon_panel";
export type StyleRole =
  | "court_addressing"
  | "party_qualification"
  | "document_title"
  | "facts"
  | "preliminaries"
  | "merit"
  | "requests"
  | "claim_value"
  | "closing"
  | "signature";

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  unit: "mm";
}

export interface TextStyleOverride {
  fontFamily?: string | null;
  fontSizePt?: number | null;
  color?: string | null;
  highlightColor?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  alignment?: TextAlignment | null;
}

export interface BodyTextStyle {
  fontFamily: string;
  fontSizePt: number;
  color: string;
  highlightColor: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: TextAlignment;
}

export interface ParagraphRhythm {
  lineHeight: number;
  paragraphSpacingBeforePt: number;
  paragraphSpacingAfterPt: number;
  firstLineIndentPt: number;
  leftIndentPt: number;
  rightIndentPt: number;
  hangingIndentPt: number;
}

export interface SeparatorStyle {
  enabled: boolean;
  widthPt: number;
  color: string;
  spacingBeforePt: number;
  spacingAfterPt: number;
}

export interface RoleTextStyleOverride extends TextStyleOverride {
  lineHeight?: number | null;
  separatorAfter?: SeparatorStyle;
  spacingBeforePt?: number | null;
  spacingAfterPt?: number | null;
  firstLineIndentPt?: number | null;
  leftIndentPt?: number | null;
  rightIndentPt?: number | null;
  hangingIndentPt?: number | null;
}

export interface RoleStyle {
  title?: RoleTextStyleOverride;
  body?: RoleTextStyleOverride;
  requests?: {
    markerStyle: ListMarkerStyle;
    leftIndentPtOverride?: number | null;
    hangingIndentPtOverride?: number | null;
    fontSizePtOverride?: number | null;
  };
  signature?: {
    spacingBeforePt: number;
    lineWidthPt: number;
    alignment: TextAlignment;
  };
}

export interface SectionTitleStyle extends BodyTextStyle {
  spacingBeforePt: number;
  spacingAfterPt: number;
  separatorAfter: SeparatorStyle;
}

export interface SourceIconPanelStyle {
  panelBackground: string | null;
  badgeBackground: string | null;
  iconColor: string;
  badgeSizePt: number;
  iconSizePt: number;
  gapPt: number;
  paddingPt: number;
}

export interface SourceBlockStyle extends TextStyleOverride {
  lineHeight?: number | null;
  leftIndentPt: number;
  rightIndentPt: number;
  spacingBeforePt: number;
  spacingAfterPt: number;
  borderLeft?: SeparatorStyle;
  layoutPreset: SourceLayoutPreset;
  iconPanel: SourceIconPanelStyle;
}

export interface NodeStyles {
  table: {
    borderColor: string;
    borderWidthPt: number;
    borderEnabled: boolean;
    cellPaddingPt: number;
    headerBackground: string | null;
    headerBold: boolean;
  };
  citation: SourceBlockStyle;
  jurisprudence: SourceBlockStyle;
}

export interface PreviewSpecimens {
  citation?: {
    label?: string;
    text: InlineNode[];
    source?: string;
  };
  jurisprudence?: {
    label?: string;
    summary?: InlineNode[];
    quote?: InlineNode[];
    court?: string;
    caseNumber?: string;
    rapporteur?: string;
    judgmentDate?: string;
    publicationDate?: string;
    sourceUrl?: string;
  };
}

export interface DocumentStyleTemplate {
  id: string;
  name: string;
  page: {
    paperSize: PaperSize;
    orientation: PageOrientation;
    margins: PageMargins;
  };
  body: BodyTextStyle;
  paragraph: ParagraphRhythm;
  sectionTitle: SectionTitleStyle;
  roleStyles: Partial<Record<StyleRole, RoleStyle>>;
  nodeStyles: NodeStyles;
  previewSpecimens: PreviewSpecimens;
}

export interface ResolvedTextStyle extends BodyTextStyle {}

export interface ResolvedParagraphStyle extends ResolvedTextStyle, ParagraphRhythm {
  separatorAfter?: SeparatorStyle;
}

export interface ResolvedTitleStyle extends SectionTitleStyle {}

export interface ResolvedRequestItemStyle extends ResolvedParagraphStyle {
  markerStyle: ListMarkerStyle;
  leftIndentPt: number;
  hangingIndentPt: number;
}

export interface ResolvedSignatureStyle {
  spacingBeforePt: number;
  lineWidthPt: number;
  alignment: TextAlignment;
}

export interface ResolvedTableStyle extends NodeStyles["table"] {}

export interface ResolvedSourceStyle extends ResolvedParagraphStyle {
  borderLeft?: SeparatorStyle;
  layoutPreset: SourceLayoutPreset;
  iconPanel: SourceIconPanelStyle;
}

export const textAlignmentSchema = z.enum(["left", "center", "right", "justify"]);
export const styleRoleSchema = z.enum([
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
]);
const listMarkerStyleSchema = z.enum(["decimal", "bullet", "lower_letter", "upper_letter", "lower_roman", "upper_roman"]);

const textStyleOverrideSchema = z.object({
  fontFamily: z.string().trim().min(1).nullable().optional(),
  fontSizePt: z.number().positive().nullable().optional(),
  color: z.string().trim().min(1).nullable().optional(),
  highlightColor: z.string().trim().min(1).nullable().optional(),
  bold: z.boolean().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  underline: z.boolean().nullable().optional(),
  alignment: textAlignmentSchema.nullable().optional(),
});

const bodyTextStyleSchema = z.object({
  fontFamily: z.string().trim().min(1),
  fontSizePt: z.number().positive(),
  color: z.string().trim().min(1),
  highlightColor: z.string().trim().min(1).nullable().default(null),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  alignment: textAlignmentSchema,
});

const paragraphRhythmSchema = z.object({
  lineHeight: z.number().positive(),
  paragraphSpacingBeforePt: z.number().nonnegative(),
  paragraphSpacingAfterPt: z.number().nonnegative(),
  firstLineIndentPt: z.number().nonnegative(),
  leftIndentPt: z.number().nonnegative(),
  rightIndentPt: z.number().nonnegative().default(0),
  hangingIndentPt: z.number().nonnegative(),
});

const separatorStyleSchema = z.object({
  enabled: z.boolean(),
  widthPt: z.number().nonnegative(),
  color: z.string().trim().min(1),
  spacingBeforePt: z.number().nonnegative(),
  spacingAfterPt: z.number().nonnegative(),
});

export const defaultCitationIconPanel: SourceIconPanelStyle = {
  panelBackground: "#eeeeee",
  badgeBackground: "#1f2937",
  iconColor: "#ffffff",
  badgeSizePt: 44,
  iconSizePt: 22,
  gapPt: 12,
  paddingPt: 12,
};

export const defaultJurisprudenceIconPanel: SourceIconPanelStyle = {
  panelBackground: "#d9d9d9",
  badgeBackground: "#c00000",
  iconColor: "#111111",
  badgeSizePt: 54,
  iconSizePt: 26,
  gapPt: 14,
  paddingPt: 14,
};

const roleTextStyleOverrideSchema = textStyleOverrideSchema.extend({
  lineHeight: z.number().positive().nullable().optional(),
  separatorAfter: separatorStyleSchema.optional(),
  spacingBeforePt: z.number().nonnegative().nullable().optional(),
  spacingAfterPt: z.number().nonnegative().nullable().optional(),
  firstLineIndentPt: z.number().nonnegative().nullable().optional(),
  leftIndentPt: z.number().nonnegative().nullable().optional(),
  rightIndentPt: z.number().nonnegative().nullable().optional(),
  hangingIndentPt: z.number().nonnegative().nullable().optional(),
});

const roleStyleSchema: z.ZodType<RoleStyle> = z.object({
  title: roleTextStyleOverrideSchema.optional(),
  body: roleTextStyleOverrideSchema.optional(),
  requests: z
    .object({
      markerStyle: listMarkerStyleSchema,
      leftIndentPtOverride: z.number().nonnegative().nullable().optional(),
      hangingIndentPtOverride: z.number().nonnegative().nullable().optional(),
      fontSizePtOverride: z.number().positive().nullable().optional(),
    })
    .optional(),
  signature: z
    .object({
      spacingBeforePt: z.number().nonnegative(),
      lineWidthPt: z.number().positive(),
      alignment: textAlignmentSchema,
    })
    .optional(),
});

const roleStylesSchema = z.object({
  court_addressing: roleStyleSchema.optional(),
  party_qualification: roleStyleSchema.optional(),
  document_title: roleStyleSchema.optional(),
  facts: roleStyleSchema.optional(),
  preliminaries: roleStyleSchema.optional(),
  merit: roleStyleSchema.optional(),
  requests: roleStyleSchema.optional(),
  claim_value: roleStyleSchema.optional(),
  closing: roleStyleSchema.optional(),
  signature: roleStyleSchema.optional(),
});

const sectionTitleStyleSchema = bodyTextStyleSchema.extend({
  spacingBeforePt: z.number().nonnegative(),
  spacingAfterPt: z.number().nonnegative(),
  separatorAfter: separatorStyleSchema,
});

const tableStyleSchema = z.object({
  borderColor: z.string().trim().min(1),
  borderWidthPt: z.number().nonnegative(),
  borderEnabled: z.boolean(),
  cellPaddingPt: z.number().nonnegative(),
  headerBackground: z.string().trim().min(1).nullable().default(null),
  headerBold: z.boolean(),
});

const sourceLayoutPresetSchema = z.enum(["plain", "icon_panel"]);
const nullableStyleColorSchema = z.preprocess((value) => (value === "" ? null : value), z.string().trim().min(1).nullable());

const sourceIconPanelStyleSchema = z.object({
  panelBackground: nullableStyleColorSchema,
  badgeBackground: nullableStyleColorSchema,
  iconColor: z.string().trim().min(1),
  badgeSizePt: z.number().positive(),
  iconSizePt: z.number().positive(),
  gapPt: z.number().nonnegative(),
  paddingPt: z.number().nonnegative(),
});

function createSourceStyleSchema(defaultIconPanel: SourceIconPanelStyle) {
  return z.object({
    fontFamily: z.string().trim().min(1).nullable().optional(),
    fontSizePt: z.number().positive().nullable().optional(),
    color: z.string().trim().min(1).nullable().optional(),
    highlightColor: z.string().trim().min(1).nullable().optional(),
    bold: z.boolean().nullable().optional(),
    italic: z.boolean().nullable().optional(),
    underline: z.boolean().nullable().optional(),
    alignment: textAlignmentSchema.nullable().optional(),
    lineHeight: z.number().positive().nullable().optional(),
    leftIndentPt: z.number().nonnegative(),
    rightIndentPt: z.number().nonnegative().default(0),
    spacingBeforePt: z.number().nonnegative(),
    spacingAfterPt: z.number().nonnegative(),
    borderLeft: separatorStyleSchema.optional(),
    layoutPreset: sourceLayoutPresetSchema.default("plain"),
    iconPanel: sourceIconPanelStyleSchema.default(defaultIconPanel),
  });
}

const previewSpecimensSchema = z
  .object({
    citation: z
      .object({
        label: z.string().trim().min(1).optional(),
        text: z.array(inlineNodeSchema),
        source: z.string().trim().min(1).optional(),
      })
      .optional(),
    jurisprudence: z
      .object({
        label: z.string().trim().min(1).optional(),
        summary: z.array(inlineNodeSchema).optional(),
        quote: z.array(inlineNodeSchema).optional(),
        court: z.string().trim().min(1).optional(),
        caseNumber: z.string().trim().min(1).optional(),
        rapporteur: z.string().trim().min(1).optional(),
        judgmentDate: z.string().trim().min(1).optional(),
        publicationDate: z.string().trim().min(1).optional(),
        sourceUrl: z.string().url().optional(),
      })
      .optional(),
  })
  .default({});

export const documentStyleTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  page: z.object({
    paperSize: z.enum(["A4", "Letter"]),
    orientation: z.enum(["portrait", "landscape"]),
    margins: z.object({
      top: z.number().nonnegative(),
      right: z.number().nonnegative(),
      bottom: z.number().nonnegative(),
      left: z.number().nonnegative(),
      unit: z.literal("mm"),
    }),
  }),
  body: bodyTextStyleSchema,
  paragraph: paragraphRhythmSchema,
  sectionTitle: sectionTitleStyleSchema,
  roleStyles: roleStylesSchema,
  nodeStyles: z.object({
    table: tableStyleSchema,
    citation: createSourceStyleSchema(defaultCitationIconPanel),
    jurisprudence: createSourceStyleSchema(defaultJurisprudenceIconPanel),
  }),
  previewSpecimens: previewSpecimensSchema,
}) satisfies z.ZodType<DocumentStyleTemplate>;

export const storedDocumentStyleTemplateSchema = documentStyleTemplateSchema.extend({
  profileId: z.string().uuid().nullable(),
  isBuiltin: z.boolean(),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type StoredDocumentStyleTemplate = z.infer<typeof storedDocumentStyleTemplateSchema>;

export const styleTemplateMutationInputSchema = z.object({
  template: documentStyleTemplateSchema,
});

export const styleTemplateIdInputSchema = z.object({
  templateId: z.string().uuid(),
});

export const duplicateStyleTemplateInputSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().trim().min(1).max(160).optional(),
});

export const defaultDocumentStyleTemplateId = "44444444-4444-4444-8444-444444444444";

const disabledSeparator: SeparatorStyle = {
  enabled: false,
  widthPt: 0,
  color: "#151515",
  spacingBeforePt: 0,
  spacingAfterPt: 0,
};

export const documentStyleTemplates: DocumentStyleTemplate[] = [
  {
    id: defaultDocumentStyleTemplateId,
    name: "Peticao tradicional",
    page: {
      paperSize: "A4",
      orientation: "portrait",
      margins: {
        top: 30,
        right: 20,
        bottom: 20,
        left: 30,
        unit: "mm",
      },
    },
    body: {
      fontFamily: "Times New Roman",
      fontSizePt: 12,
      color: "#151515",
      highlightColor: null,
      bold: false,
      italic: false,
      underline: false,
      alignment: "justify",
    },
    paragraph: {
      lineHeight: 1.5,
      paragraphSpacingBeforePt: 0,
      paragraphSpacingAfterPt: 10,
      firstLineIndentPt: 0,
      leftIndentPt: 0,
      rightIndentPt: 0,
      hangingIndentPt: 0,
    },
    sectionTitle: {
      fontFamily: "Times New Roman",
      fontSizePt: 15,
      color: "#151515",
      highlightColor: null,
      bold: true,
      italic: false,
      underline: false,
      alignment: "left",
      spacingBeforePt: 18,
      spacingAfterPt: 14,
      separatorAfter: disabledSeparator,
    },
    roleStyles: {
      court_addressing: {
        body: {
          alignment: "center",
          spacingAfterPt: 42,
        },
      },
      document_title: {
        title: {
          fontSizePt: 18,
          bold: true,
          alignment: "center",
          spacingBeforePt: 0,
          spacingAfterPt: 14,
        },
      },
      requests: {
        requests: {
          markerStyle: "decimal",
          leftIndentPtOverride: 22,
          hangingIndentPtOverride: 0,
        },
        body: {
          spacingAfterPt: 7,
        },
      },
      signature: {
        body: {
          alignment: "center",
        },
        signature: {
          spacingBeforePt: 42,
          lineWidthPt: 240,
          alignment: "center",
        },
      },
    },
    nodeStyles: {
      table: {
        borderColor: "#b8b8b8",
        borderWidthPt: 0.75,
        borderEnabled: true,
        cellPaddingPt: 7,
        headerBackground: "#f3f3f3",
        headerBold: true,
      },
      citation: {
        fontSizePt: null,
        leftIndentPt: 18,
        rightIndentPt: 0,
        spacingBeforePt: 0,
        spacingAfterPt: 10,
        layoutPreset: "plain",
        iconPanel: defaultCitationIconPanel,
      },
      jurisprudence: {
        fontSizePt: null,
        leftIndentPt: 18,
        rightIndentPt: 0,
        spacingBeforePt: 0,
        spacingAfterPt: 10,
        layoutPreset: "plain",
        iconPanel: defaultJurisprudenceIconPanel,
      },
    },
    previewSpecimens: {},
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    name: "Peticao compacta",
    page: {
      paperSize: "A4",
      orientation: "portrait",
      margins: {
        top: 25,
        right: 18,
        bottom: 18,
        left: 25,
        unit: "mm",
      },
    },
    body: {
      fontFamily: "Arial",
      fontSizePt: 11,
      color: "#1f1f1f",
      highlightColor: null,
      bold: false,
      italic: false,
      underline: false,
      alignment: "justify",
    },
    paragraph: {
      lineHeight: 1.35,
      paragraphSpacingBeforePt: 0,
      paragraphSpacingAfterPt: 8,
      firstLineIndentPt: 0,
      leftIndentPt: 0,
      rightIndentPt: 0,
      hangingIndentPt: 0,
    },
    sectionTitle: {
      fontFamily: "Arial",
      fontSizePt: 13,
      color: "#1f1f1f",
      highlightColor: null,
      bold: true,
      italic: false,
      underline: false,
      alignment: "left",
      spacingBeforePt: 14,
      spacingAfterPt: 10,
      separatorAfter: disabledSeparator,
    },
    roleStyles: {
      court_addressing: {
        body: {
          alignment: "center",
          spacingAfterPt: 34,
        },
      },
      document_title: {
        title: {
          fontSizePt: 16,
          bold: true,
          alignment: "center",
          spacingBeforePt: 0,
          spacingAfterPt: 12,
        },
      },
      requests: {
        requests: {
          markerStyle: "decimal",
          leftIndentPtOverride: 20,
          hangingIndentPtOverride: 0,
        },
        body: {
          spacingAfterPt: 5,
        },
      },
      signature: {
        body: {
          alignment: "center",
        },
        signature: {
          spacingBeforePt: 34,
          lineWidthPt: 220,
          alignment: "center",
        },
      },
    },
    nodeStyles: {
      table: {
        borderColor: "#a8a8a8",
        borderWidthPt: 0.75,
        borderEnabled: true,
        cellPaddingPt: 5,
        headerBackground: "#eeeeee",
        headerBold: true,
      },
      citation: {
        fontSizePt: null,
        leftIndentPt: 16,
        rightIndentPt: 0,
        spacingBeforePt: 0,
        spacingAfterPt: 8,
        layoutPreset: "plain",
        iconPanel: {
          ...defaultCitationIconPanel,
          panelBackground: "#f1f1f1",
          badgeBackground: "#333333",
          badgeSizePt: 40,
          iconSizePt: 20,
          gapPt: 10,
          paddingPt: 10,
        },
      },
      jurisprudence: {
        fontSizePt: null,
        leftIndentPt: 16,
        rightIndentPt: 0,
        spacingBeforePt: 0,
        spacingAfterPt: 8,
        layoutPreset: "plain",
        iconPanel: {
          ...defaultJurisprudenceIconPanel,
          panelBackground: "#e4e4e4",
          badgeSizePt: 48,
          iconSizePt: 24,
          gapPt: 12,
          paddingPt: 12,
        },
      },
    },
    previewSpecimens: {},
  },
];

export const defaultDocumentStyleTemplate = documentStyleTemplates[0]!;

export function getDocumentStyleTemplate(templateId: string): DocumentStyleTemplate | null {
  return documentStyleTemplates.find((template) => template.id === templateId) ?? null;
}

export function resolveDocumentStyleTemplate(document: LegalDocument): DocumentStyleTemplate | null {
  return getDocumentStyleTemplate(document.styleTemplate.templateId);
}

export function resolveBodyStyle(template: DocumentStyleTemplate): ResolvedTextStyle {
  return { ...template.body };
}

export function resolveParagraphRhythm(template: DocumentStyleTemplate): ParagraphRhythm {
  return { ...template.paragraph };
}

export function resolveRoleBodyStyle(template: DocumentStyleTemplate, role: string): ResolvedParagraphStyle {
  const body = resolveBodyStyle(template);
  const rhythm = resolveParagraphRhythm(template);
  const override = getRoleStyle(template, role)?.body;

  return {
    ...body,
    ...rhythm,
    fontFamily: overrideValue(override?.fontFamily, body.fontFamily),
    fontSizePt: overrideValue(override?.fontSizePt, body.fontSizePt),
    color: overrideValue(override?.color, body.color),
    highlightColor: overrideValue(override?.highlightColor, body.highlightColor),
    bold: overrideValue(override?.bold, body.bold),
    italic: overrideValue(override?.italic, body.italic),
    underline: overrideValue(override?.underline, body.underline),
    alignment: overrideValue(override?.alignment, body.alignment),
    lineHeight: overrideValue(override?.lineHeight, rhythm.lineHeight),
    paragraphSpacingBeforePt: overrideValue(override?.spacingBeforePt, rhythm.paragraphSpacingBeforePt),
    paragraphSpacingAfterPt: overrideValue(override?.spacingAfterPt, rhythm.paragraphSpacingAfterPt),
    firstLineIndentPt: overrideValue(override?.firstLineIndentPt, rhythm.firstLineIndentPt),
    leftIndentPt: overrideValue(override?.leftIndentPt, rhythm.leftIndentPt),
    rightIndentPt: overrideValue(override?.rightIndentPt, rhythm.rightIndentPt),
    hangingIndentPt: overrideValue(override?.hangingIndentPt, rhythm.hangingIndentPt),
    ...(override?.separatorAfter ? { separatorAfter: override.separatorAfter } : {}),
  };
}

export function resolveRoleTitleStyle(template: DocumentStyleTemplate, role: string): ResolvedTitleStyle {
  const base = template.sectionTitle;
  const override = getRoleStyle(template, role)?.title;

  return {
    ...base,
    fontFamily: overrideValue(override?.fontFamily, base.fontFamily),
    fontSizePt: overrideValue(override?.fontSizePt, base.fontSizePt),
    color: overrideValue(override?.color, base.color),
    highlightColor: overrideValue(override?.highlightColor, base.highlightColor),
    bold: overrideValue(override?.bold, base.bold),
    italic: overrideValue(override?.italic, base.italic),
    underline: overrideValue(override?.underline, base.underline),
    alignment: overrideValue(override?.alignment, base.alignment),
    spacingBeforePt: overrideValue(override?.spacingBeforePt, base.spacingBeforePt),
    spacingAfterPt: overrideValue(override?.spacingAfterPt, base.spacingAfterPt),
    separatorAfter: override?.separatorAfter ?? base.separatorAfter,
  };
}

export function resolveRequestItemStyle(template: DocumentStyleTemplate): ResolvedRequestItemStyle {
  const body = resolveRoleBodyStyle(template, "requests");
  const requests = template.roleStyles.requests?.requests;

  return {
    ...body,
    markerStyle: requests?.markerStyle ?? "decimal",
    leftIndentPt: requests?.leftIndentPtOverride ?? body.leftIndentPt,
    hangingIndentPt: requests?.hangingIndentPtOverride ?? body.hangingIndentPt,
    fontSizePt: requests?.fontSizePtOverride ?? body.fontSizePt,
  };
}

export function resolveTableStyle(template: DocumentStyleTemplate): ResolvedTableStyle {
  return { ...template.nodeStyles.table };
}

export function resolveCitationStyle(template: DocumentStyleTemplate): ResolvedSourceStyle {
  const body = resolveRoleBodyStyle(template, "facts");
  const citation = template.nodeStyles.citation;

  return {
    ...body,
    fontFamily: citation.fontFamily ?? body.fontFamily,
    fontSizePt: citation.fontSizePt ?? body.fontSizePt,
    color: citation.color ?? body.color,
    highlightColor: citation.highlightColor ?? body.highlightColor,
    bold: citation.bold ?? body.bold,
    italic: citation.italic ?? body.italic,
    underline: citation.underline ?? body.underline,
    alignment: citation.alignment ?? body.alignment,
    lineHeight: citation.lineHeight ?? body.lineHeight,
    leftIndentPt: citation.leftIndentPt,
    rightIndentPt: citation.rightIndentPt,
    paragraphSpacingBeforePt: citation.spacingBeforePt,
    paragraphSpacingAfterPt: citation.spacingAfterPt,
    layoutPreset: citation.layoutPreset,
    iconPanel: citation.iconPanel,
    ...(citation.borderLeft ? { borderLeft: citation.borderLeft } : {}),
  };
}

export function resolveJurisprudenceStyle(template: DocumentStyleTemplate): ResolvedSourceStyle {
  const body = resolveRoleBodyStyle(template, "merit");
  const jurisprudence = template.nodeStyles.jurisprudence;

  return {
    ...body,
    fontFamily: jurisprudence.fontFamily ?? body.fontFamily,
    fontSizePt: jurisprudence.fontSizePt ?? body.fontSizePt,
    color: jurisprudence.color ?? body.color,
    highlightColor: jurisprudence.highlightColor ?? body.highlightColor,
    bold: jurisprudence.bold ?? body.bold,
    italic: jurisprudence.italic ?? body.italic,
    underline: jurisprudence.underline ?? body.underline,
    alignment: jurisprudence.alignment ?? body.alignment,
    lineHeight: jurisprudence.lineHeight ?? body.lineHeight,
    leftIndentPt: jurisprudence.leftIndentPt,
    rightIndentPt: jurisprudence.rightIndentPt,
    paragraphSpacingBeforePt: jurisprudence.spacingBeforePt,
    paragraphSpacingAfterPt: jurisprudence.spacingAfterPt,
    layoutPreset: jurisprudence.layoutPreset,
    iconPanel: jurisprudence.iconPanel,
    ...(jurisprudence.borderLeft ? { borderLeft: jurisprudence.borderLeft } : {}),
  };
}

export function resolveSignatureStyle(template: DocumentStyleTemplate): ResolvedSignatureStyle {
  return {
    spacingBeforePt: template.roleStyles.signature?.signature?.spacingBeforePt ?? 42,
    lineWidthPt: template.roleStyles.signature?.signature?.lineWidthPt ?? 240,
    alignment: template.roleStyles.signature?.signature?.alignment ?? resolveRoleBodyStyle(template, "signature").alignment,
  };
}

export function getPageDimensionsMm(template: DocumentStyleTemplate): { width: number; height: number } {
  const portraitDimensions = template.page.paperSize === "A4" ? { width: 210, height: 297 } : { width: 216, height: 279 };

  if (template.page.orientation === "landscape") {
    return {
      width: portraitDimensions.height,
      height: portraitDimensions.width,
    };
  }

  return portraitDimensions;
}

export function ptToTwip(value: number): number {
  return Math.round(value * 20);
}

export function mmToTwip(value: number): number {
  return Math.round(value * 56.692913386);
}

export function ptToHalfPoint(value: number): number {
  return Math.round(value * 2);
}

export function normalizeHexColor(value: string): string {
  return value.replace(/^#/, "").toUpperCase();
}

function getRoleStyle(template: DocumentStyleTemplate, role: string): RoleStyle | undefined {
  return styleRoleSchema.safeParse(role).success ? template.roleStyles[role as StyleRole] : undefined;
}

function overrideValue<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}
