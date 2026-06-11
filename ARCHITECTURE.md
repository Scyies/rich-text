# wealthy-text-editor — Architecture

> Nome: **wealthy-text-editor** (trocadilho com Rich → Wealthy)
> Status: Planejamento
> Licença: MIT

## Stack

| Camada | Tecnologia |
|---|---|
| Bundle | tsup (ESM + CJS + .d.ts) |
| UI primitives | shadcn/ui copiado internamente + CSS Modules |
| CSS | CSS Modules com prefixo `.minuta-` |
| Schema | Zod |
| Texto inline | Contenteditable custom |
| Gerenciador de pacotes | pnpm |
| Publicação | npm (`wealthy-text-editor`) |

## Filosofia

- **Raw/unstyled**: a lib não impõe estilos — o host é responsável pelo visual via Tailwind.
- **Schema-first**: o documento é JSON puro como fonte da verdade; exportação é camada separada.
- **Camadas claras**: schema → commands/transforms → hooks → componentes → exporters.
- **Previsível sobre inteligente**: operações explícitas via commands, não mutação direta.

## Estrutura de diretórios

```
wealthy-text-editor/
├── src/
│   ├── editor/
│   │   ├── components/
│   │   │   ├── DocumentEditor.tsx       # API principal (multi-bloco)
│   │   │   ├── BlockEditor.tsx          # API secundária (bloco único)
│   │   │   ├── Toolbar.tsx
│   │   │   ├── FloatingMenu.tsx
│   │   │   └── DocumentBlockPreview.tsx
│   │   ├── core/
│   │   │   ├── schema.ts               # Zod schemas + types
│   │   │   ├── commands.ts             # editor.commands.*
│   │   │   ├── transforms.ts           # transform helpers
│   │   │   └── selection.ts            # cursor/selection management
│   │   ├── hooks/
│   │   │   ├── useDocumentEditor.ts    # hook headless principal
│   │   │   └── useBlockEditor.ts
│   │   ├── plugins/
│   │   │   ├── types.ts                # EditorPlugin interface
│   │   │   └── registry.ts
│   │   ├── i18n/
│   │   │   ├── pt-BR.ts
│   │   │   └── en.ts
│   │   └── exports/
│   │       ├── exportToDocx.ts
│   │       ├── exportToHtml.ts
│   │       └── exportToMarkdown.ts
│   ├── internal/
│   │   ├── ui/
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── popover.tsx
│   │   │   ├── tooltip.tsx
│   │   │   ├── separator.tsx
│   │   │   └── *.module.css
│   │   └── utils/
│   │       └── cn.ts
│   └── index.ts                        # barrel exports
├── styles.css                           # CSS global da lib (importado pelo host)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## Schema (simplificado)

```typescript
type Block =
  | HeadingBlock
  | TextBlock
  | TableBlock
  | SpecialBlock

type HeadingBlock = {
  id: string
  type: "heading"
  level: 1 | 2 | 3 | 4 | 5 | 6
  content: InlineNode[]
}

type TextBlock = {
  id: string
  type: "text"
  variant: "paragraph" | "bullet" | "numbered"
  content: InlineNode[]
  indent?: number
}

type TableBlock = {
  id: string
  type: "table"
  rows: TableRow[]
}

type SpecialBlock = {
  id: string
  type: "special"
  variant: string
  data: Record<string, unknown>
}

type LegalDocument = {
  version: number
  blocks: Block[]
  metadata?: {
    title?: string
    documentType?: string
    jurisdiction?: string
  }
}
```

## API pública

### Componente principal

```tsx
<DocumentEditor
  value={document}
  onChange={handleChange}
  onCommit={handleCommit}
  styleTemplate={styleTemplate}
  locale="pt-BR"
  extensions={[]}
  readonly={false}
  renderBlock?: (props: RenderBlockProps) => React.ReactNode
/>
```

### Componente secundário

```tsx
<BlockEditor
  block={block}
  onChange={updateBlock}
  locale="pt-BR"
/>
```

### Hook headless (customização avançada)

```tsx
const editor = useDocumentEditor({
  value: document,
  onChange: setDocument,
  schema,
  commands,
  plugins,
})

editor.commands.updateBlock(blockId, patch)
editor.commands.insertBlockAfter(blockId, block)
editor.commands.deleteBlock(blockId)
editor.commands.moveBlock(blockId, targetIndex)
editor.commands.turnIntoHeading(blockId, level)
editor.commands.turnIntoParagraph(blockId)
editor.commands.splitBlock(blockId, offset)
editor.commands.mergeWithPrevious(blockId)
```

### i18n

```tsx
<DocumentEditor locale="en" />
```

Dicionários inclusos: `pt-BR` (default), `en`.

### Plugins

```typescript
interface EditorPlugin {
  name: string
  blockTypes?: BlockTypeRegistration[]
  commands?: CommandRegistration[]
  toolbarItems?: ToolbarItem[]
  onInit?: (ctx: EditorContext) => void
}
```

## Estilo

- CSS Modules com prefixo `.minuta-` para escopo.
- Variáveis CSS definidas na lib (não dependem do theme do host).
- Host importa: `import "@wealthy-text-editor/styles.css"`.
- Componentes shadcn copiados para `internal/ui/` com imports relativos.
- Nenhuma dependência de Tailwind config do host.

## Dependências

### Peer dependencies (fornecidas pelo host)

- `react` >= 19
- `react-dom` >= 19

### Runtime (inline/bundled)

- `zod` (schema validation)
- `clsx` + `tailwind-merge` (`cn()` utility)
- shadcn/ui primitives copiados (Button, Input, DropdownMenu, Popover, Tooltip, Separator)

## Licenciamento

Os componentes shadcn/ui copiados são MIT license (compatível). A lib inteira será distribuída sob MIT.
