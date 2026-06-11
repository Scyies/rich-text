import { z } from "zod";
import {
  documentTypeIdSchema,
  legalDocumentSchema,
  schemaVersion,
  type LegalDocument,
  type LegalDocumentBlock,
} from "./document-schema";
import { defaultDocumentStyleTemplateId } from "./document-style-template";

const builtinWorkspaceId = "11111111-1111-4111-8111-111111111111";
const builtinLawyerId = "33333333-3333-4333-8333-333333333333";
const builtinCreatedAt = "2026-05-30T12:00:00-03:00";

export const documentTemplateRecordSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid().nullable(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
  documentType: documentTypeIdSchema,
  practiceArea: z.string().trim().min(1).nullable(),
  template: legalDocumentSchema.refine((document) => document.kind === "template", {
    message: "Document template must use kind=template.",
  }),
  isBuiltin: z.boolean(),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const documentTemplateMutationInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(600).nullable(),
  documentType: documentTypeIdSchema,
  practiceArea: z.string().trim().min(1).max(120).nullable(),
  template: legalDocumentSchema,
});

export const documentTemplateIdInputSchema = z.object({
  templateId: z.string().uuid(),
});

export const duplicateDocumentTemplateInputSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().trim().min(1).max(160).optional(),
});

export type DocumentTemplateRecord = z.infer<typeof documentTemplateRecordSchema>;
export type DocumentTemplateMutationInput = z.infer<typeof documentTemplateMutationInputSchema>;

function text(textValue: string): { type: "text"; text: string } {
  return { type: "text", text: textValue };
}

function paragraph(textValue: string): { type: "paragraph"; children: Array<{ type: "text"; text: string }>; style?: { alignment: "justify" } } {
  return {
    type: "paragraph",
    children: [text(textValue)],
    style: { alignment: "justify" },
  };
}

function blockBase({
  id,
  role,
  styleRole,
}: {
  id: string;
  role: LegalDocumentBlock["role"];
  styleRole: string;
}): Pick<LegalDocumentBlock, "id" | "role" | "required" | "style" | "sources" | "provenance" | "workflow"> {
  return {
    id,
    role,
    required: {
      value: true,
      source: "template",
    },
    style: {
      styleRole,
      styleIdOverride: null,
    },
    sources: {
      evidenceIds: [],
      knowledgeItemIds: [],
      sourceBlockIds: [],
    },
    provenance: {
      createdBy: "template",
      createdAt: builtinCreatedAt,
      updatedBy: "system",
      updatedAt: builtinCreatedAt,
    },
    workflow: {
      locked: false,
    },
  };
}

export const builtinDocumentTemplates: LegalDocument[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schemaVersion,
    kind: "template",
    documentType: "initial_petition",
    title: "Peticao inicial consumerista",
    status: "draft",
    language: "pt-BR",
    contextRefs: {
      workspaceId: builtinWorkspaceId,
      partyRefs: [],
      lawyerRefs: [builtinLawyerId],
    },
    styleTemplate: {
      templateId: defaultDocumentStyleTemplateId,
    },
    pageSetup: {
      source: "style_template",
    },
    placeholders: [
      {
        key: "client_name",
        label: "Nome do cliente",
        expectedOutputType: "party_name",
        defaultBehavior: "manual_fill",
        fillStrategy: "global",
      },
      {
        key: "case_facts",
        label: "Fatos principais",
        expectedOutputType: "multi_paragraph",
        defaultBehavior: "llm_fill",
        fillStrategy: "global",
      },
    ],
    blocks: [
      {
        ...blockBase({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          role: "court_addressing",
          styleRole: "court_addressing",
        }),
        type: "content",
        title: null,
        content: [paragraph("Excelentissimo(a) Senhor(a) Doutor(a) Juiz(a) de Direito da [vara] da Comarca de [cidade]/[UF].")],
      },
      {
        ...blockBase({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          role: "party_qualification",
          styleRole: "content",
        }),
        type: "content",
        title: null,
        content: [paragraph("[client_name], ja qualificado(a), por seu advogado, vem propor a presente acao em face de [parte contraria].")],
      },
      {
        ...blockBase({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
          role: "document_title",
          styleRole: "document_title",
        }),
        type: "heading",
        title: [text("Acao de indenizacao por danos materiais e morais")],
      },
      {
        ...blockBase({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
          role: "facts",
          styleRole: "section_heading",
        }),
        type: "section",
        title: [text("Dos fatos")],
        level: 1,
        parentBlockId: null,
        content: [paragraph("[case_facts]")],
      },
      {
        ...blockBase({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
          role: "merit",
          styleRole: "section_heading",
        }),
        type: "section",
        title: [text("Do direito")],
        level: 1,
        parentBlockId: null,
        content: [paragraph("A relacao juridica descrita atrai a incidencia das normas de protecao ao consumidor e a responsabilidade pela falha na prestacao do servico.")],
      },
      {
        ...blockBase({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
          role: "requests",
          styleRole: "request_list",
        }),
        type: "request_list",
        role: "requests",
        title: [text("Dos pedidos")],
        listStyle: {
          styleRole: "request_list",
          markerOverride: "decimal",
        },
        requests: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7",
            text: [text("A citacao da parte requerida.")],
            category: "procedural",
            required: true,
            sources: {
              supportingBlockIds: [],
              evidenceIds: [],
              knowledgeItemIds: [],
            },
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8",
            text: [text("A condenacao ao pagamento dos danos materiais e morais comprovados.")],
            category: "merit",
            required: true,
            sources: {
              supportingBlockIds: [],
              evidenceIds: [],
              knowledgeItemIds: [],
            },
          },
        ],
      },
      {
        ...blockBase({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
          role: "signature",
          styleRole: "signature",
        }),
        type: "signature",
        role: "signature",
        title: null,
        content: [
          {
            type: "signatureLine",
            lawyerId: builtinLawyerId,
            name: [text("[Nome do advogado]")],
            oabText: [text("OAB/[UF] [numero]")],
          },
        ],
      },
    ],
    metadata: {
      createdAt: builtinCreatedAt,
      updatedAt: builtinCreatedAt,
    },
  },
];
