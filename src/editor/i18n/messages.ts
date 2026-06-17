/**
 * i18n message dictionaries for the React UI (v0.5).
 *
 * Plain data + a resolver — no React here, so the strings stay importable
 * from non-React contexts (tests, host tooling). The React binding lives in
 * `context.tsx`. English is the out-of-box default; pass `locale="pt-BR"`
 * (or a `messages` override) to switch.
 *
 * Only the *core* editor chrome is localized. Plugin-authored strings (e.g.
 * a plugin's slash item label) are the plugin author's responsibility.
 */

export type Locale = "en" | "pt-BR";

export interface EditorMessages {
  // Slash menu — core block-type items
  slashHeading1: string;
  slashHeading2: string;
  slashHeading3: string;
  slashText: string;
  slashBulletedList: string;
  slashNumberedList: string;
  slashTable: string;
  slashImage: string;
  slashImageGroup: string;
  slashNoResults: string;
  slashMenuAriaLabel: string;

  // Document editor chrome
  placeholder: string;
  documentAriaLabel: string;
  addLineBelow: string;
  dragHandleTitle: string;
  expandSection: string;
  collapseSection: string;

  // Inline editor (block aria labels)
  headingAriaLabel: (level: number) => string;
  textBlockAriaLabel: string;

  // Floating toolbar
  toolbarAriaLabel: string;
  markBold: string;
  markItalic: string;
  markUnderline: string;
  markStrikethrough: string;
  markCode: string;

  // Table
  tableCellAriaLabel: string;
  tableAddRow: string;
  tableRemoveRow: string;
  tableAddColumn: string;
  tableRemoveColumn: string;
  tableRowLabel: string;
  tableColumnLabel: string;

  // Image
  imageMissingSource: string;
  imageCaptionPlaceholder: string;
  imageCaptionAriaLabel: string;
  imageResizeAriaLabel: string;
  imageGroupSlotLabel: string;
  imageGroupAddColumnAriaLabel: string;
  imageGroupRemoveColumnAriaLabel: string;
  imageDropFailed: string;
  imageDropUrlDisabled: string;
  imageDropUnsupported: string;

  // Inline-object chip popover
  chipEditAriaLabel: string;
}

export const en: EditorMessages = {
  slashHeading1: "Heading 1",
  slashHeading2: "Heading 2",
  slashHeading3: "Heading 3",
  slashText: "Text",
  slashBulletedList: "Bulleted list",
  slashNumberedList: "Numbered list",
  slashTable: "Table",
  slashImage: "Image",
  slashImageGroup: "Image row",
  slashNoResults: "No results",
  slashMenuAriaLabel: "Block types",

  placeholder: "Type / for commands…",
  documentAriaLabel: "Document editor",
  addLineBelow: "Add a line below",
  dragHandleTitle: "Drag to move; click to select",
  expandSection: "Expand section",
  collapseSection: "Collapse section",

  headingAriaLabel: (level) => `Heading ${level}`,
  textBlockAriaLabel: "Text block",

  toolbarAriaLabel: "Text formatting",
  markBold: "Bold",
  markItalic: "Italic",
  markUnderline: "Underline",
  markStrikethrough: "Strikethrough",
  markCode: "Code",

  tableCellAriaLabel: "Table cell",
  tableAddRow: "Add row",
  tableRemoveRow: "Remove row",
  tableAddColumn: "Add column",
  tableRemoveColumn: "Remove column",
  tableRowLabel: "Row",
  tableColumnLabel: "Col",

  imageMissingSource: "Image source unavailable",
  imageCaptionPlaceholder: "Add caption",
  imageCaptionAriaLabel: "Image caption",
  imageResizeAriaLabel: "Resize image",
  imageGroupSlotLabel: "Drag or paste an image here",
  imageGroupAddColumnAriaLabel: "Add column",
  imageGroupRemoveColumnAriaLabel: "Remove column",
  imageDropFailed: "Couldn't add the image",
  imageDropUrlDisabled: "Image links aren't allowed here",
  imageDropUnsupported: "That isn't a supported image",

  chipEditAriaLabel: "Edit field",
};

export const ptBR: EditorMessages = {
  slashHeading1: "Título 1",
  slashHeading2: "Título 2",
  slashHeading3: "Título 3",
  slashText: "Texto",
  slashBulletedList: "Lista com marcadores",
  slashNumberedList: "Lista numerada",
  slashTable: "Tabela",
  slashImage: "Imagem",
  slashImageGroup: "Linha de imagens",
  slashNoResults: "Nenhum resultado",
  slashMenuAriaLabel: "Tipos de bloco",

  placeholder: "Digite / para comandos…",
  documentAriaLabel: "Editor de documento",
  addLineBelow: "Adicionar uma linha abaixo",
  dragHandleTitle: "Arraste para mover; clique para selecionar",
  expandSection: "Expandir seção",
  collapseSection: "Recolher seção",

  headingAriaLabel: (level) => `Título ${level}`,
  textBlockAriaLabel: "Bloco de texto",

  toolbarAriaLabel: "Formatação de texto",
  markBold: "Negrito",
  markItalic: "Itálico",
  markUnderline: "Sublinhado",
  markStrikethrough: "Tachado",
  markCode: "Código",

  tableCellAriaLabel: "Célula da tabela",
  tableAddRow: "Adicionar linha",
  tableRemoveRow: "Remover linha",
  tableAddColumn: "Adicionar coluna",
  tableRemoveColumn: "Remover coluna",
  tableRowLabel: "Linha",
  tableColumnLabel: "Coluna",

  imageMissingSource: "Fonte da imagem indisponível",
  imageCaptionPlaceholder: "Adicionar legenda",
  imageCaptionAriaLabel: "Legenda da imagem",
  imageResizeAriaLabel: "Redimensionar imagem",
  imageGroupSlotLabel: "Arraste ou cole uma imagem aqui",
  imageGroupAddColumnAriaLabel: "Adicionar coluna",
  imageGroupRemoveColumnAriaLabel: "Remover coluna",
  imageDropFailed: "Não foi possível adicionar a imagem",
  imageDropUrlDisabled: "Links de imagem não são permitidos aqui",
  imageDropUnsupported: "Esse arquivo não é uma imagem compatível",

  chipEditAriaLabel: "Editar campo",
};

const DICTIONARIES: Record<Locale, EditorMessages> = { en, "pt-BR": ptBR };

/** The out-of-box default locale. */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Resolves the messages for a `locale` (default `en`), with an optional
 * shallow `override` for per-string customization.
 */
export function resolveMessages(
  locale: Locale = DEFAULT_LOCALE,
  override?: Partial<EditorMessages> | undefined,
): EditorMessages {
  const base = DICTIONARIES[locale] ?? en;
  return override === undefined ? base : { ...base, ...override };
}
