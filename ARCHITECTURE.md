# wealthy-text-editor — Architecture

> Nome: **wealthy-text-editor** (trocadilho com Rich → Wealthy)
> Status: Design resolvido (grill 2026-06-11) — pronto para v0.1
> Licença: MIT

## Stack

| Camada | Tecnologia |
|---|---|
| Bundle | tsup (ESM + CJS + .d.ts, múltiplos entry points) |
| UI primitives | shadcn/ui copiado internamente + CSS Modules |
| CSS | CSS Modules com prefixo `.wte-` |
| Schema | Zod |
| Texto inline | Contenteditable custom (um por bloco) |
| Gerenciador de pacotes | pnpm |
| Publicação | npm (`wealthy-text-editor`) |

## Filosofia

- **Raw/unstyled**: a lib não impõe estilos — o host é responsável pelo visual.
- **Schema-first**: o documento é JSON puro como fonte da verdade; exportação é camada separada.
- **Camadas claras**: schema → commands/transforms → hooks → componentes → exporters.
- **Previsível sobre inteligente**: operações explícitas via commands, não mutação direta.
- **Containment é sempre derivado, nunca armazenado**: seções derivam do `level` dos headings; subárvores de lista derivam do `indent`. Não existe `parentBlockId` nem `children` no documento.

## Decisões de design (resolvidas)

Cada decisão abaixo foi deliberada e fechada. Mudar qualquer uma exige revisitar as que dependem dela.

### D1 — Modelo de dados: lista plana + árvore derivada
O documento é um array plano de blocos; cada linha visual é um bloco. "Estar dentro de um heading" é **computado**: uma seção = heading + todos os blocos seguintes até um heading de nível igual ou superior. `getSectionTree(doc)` é uma função pura sobre o array. Transformar uma linha em heading é uma troca de tipo de 1 bloco — o containment se atualiza sozinho, sem re-parenting e sem estados inválidos possíveis.

### D2 — Cada item de lista é um bloco
Uma linha de bullet é um `TextBlock` com `variant: "bullet"` e `indent`. Runs contíguos do mesmo variant renderizam como uma lista visual; a numeração é computada na renderização. Conversões parágrafo↔bullet↔heading são um flip de tipo/variant; Enter divide em novo bloco; Backspace funde.

### D3 — Poderes da seção (todos no v1.0)
1. **Ops estruturais**: mover/deletar/duplicar um heading leva a seção inteira junto.
2. **API programática**: `getSectionTree(doc)`, `getSection(doc, headingId)` → `{ heading, blocks, subsections }` — é por aqui que um host (ex.: pipeline LLM do Minuta) endereça "a seção de Fatos" sem passar pela UI.
3. **Numeração hierárquica**: 1., 1.1, 1.2… computada da árvore, display-only, nunca gravada no conteúdo.
4. **Collapse/expand**: estado de view puro (fora do JSON do documento).

### D4 — moveSection re-nivela a subárvore
Ao soltar uma seção num alvo onde o nível não cabe, o nível do heading movido é reescrito para caber na posição de drop e os sub-headings deslocam pelo mesmo delta (clamp 1–6). O resultado pós-drop corresponde à intenção visual do usuário (comportamento de outline view do Word/Docs).

### D5 — Extensão: meta bag + block types custom
Todo bloco carrega `meta?: Record<string, unknown>` que a lib **round-tripa intacto e nunca interpreta**; o host valida com Zod próprio e tipa via generic (`Document<TMeta>`). Estruturas de domínio (ex.: `request_list`, `signature` do Minuta) viram block types registrados por plugin com renderer do host. Todo o `baseBlock` legal do Minuta (role, provenance, sources, required, workflow…) vira o schema de meta do Minuta.

### D6 — Modelo inline: texto + marks + objetos atômicos
Nós inline do core: `TextNode { text, marks }` e `InlineObjectNode { kind, data, meta }` — atômico (o cursor o trata como um caractere, sem edição interna), renderizado por componente registrado via plugin. Placeholders, mentions e chips são inline objects sem mudança no core. Marks são um conjunto fixo: `bold`, `italic`, `underline`, `strikethrough`, `code`, `link`, `color(token)`, `highlight(token)`. Inlines-contêiner (editáveis por dentro) são não-objetivo.

### D7 — Substrato: contenteditable por bloco + multi-select de blocos
Um contenteditable por bloco. Arrastar a seleção para fora de um bloco vira seleção de blocos inteiros (overlay, como o Notion). Seleção parcial de texto cruzando blocos **não existe** no v1. Copy/cut/paste/delete operam sobre ranges de blocos.

### D8 — Undo/redo: histórico de snapshots no engine
O engine mantém uma pilha limitada de snapshots do documento (JSON imutável → compartilhamento estrutural barato) + seleção para restaurar. Digitação consecutiva coalesce numa entrada (janela/palavra); todo command estrutural é entrada própria. Ctrl+Z é interceptado dentro dos blocos (sem undo nativo do browser).

### D9 — Células de tabela: lista restrita, sem aninhamento
Uma célula contém um array plano de blocos text-variant apenas (`paragraph`/`bullet`/`numbered`). Sem headings, tabelas ou blocos custom dentro de células no v1. Alargar a union depois é não-breaking.

### D10 — Fluxo de dados: engine-owned + patches imperativos
O engine é dono do documento de trabalho. `value` é estado inicial; trocar a referência = troca de documento (hard reset). `onChange` dispara a cada transação; `onCommit` em blur/idle/save explícito. Edições externas (LLM/servidor) entram por `editor.commands.applyPatches(patches)` — passam pelo mesmo pipeline de transação, entram no histórico de undo e a seleção é preservada/remapeada.

### D11 — Superfície de input do v1
- **Input rules markdown** (v0.4): `# `→H1, `- `→bullet, `1. `→numbered no início de linha; Tab/Shift+Tab indentam bullets; Backspace no início reverte a conversão.
- **Slash menu** (v0.4): `/` abre menu filtrável com tipos do core + tipos registrados por plugin.
- **Rich paste HTML→schema** (v0.5): parse best-effort de Word/Docs/web, com fallback texto puro. É um subsistema próprio.
- Markdown paste: fora do v1.

### D12 — Exporters como subpath entries
`wealthy-text-editor/export-docx`, `/export-html`, `/export-markdown` como entry points separados do tsup. Deps pesadas (lib `docx`) só carregam se importadas. Um pacote, uma versão.

### D13 — Colaboração em tempo real: não-objetivo explícito
Nenhuma maquinaria CRDT/OT no v1. Ids estáveis de bloco + todas as mutações como patches serializáveis num pipeline único já são a superfície de adaptação que uma camada de sync futura precisaria.

### D14 — Código existente é pedreira, não migração
A lib nasce greenfield em `src/`. `shared/document-schema.ts` e `components/minuta-block-editor.tsx` são referência de UX comprovada (mecânica do InlineEditor, menus de tabela, algoritmo de numeração) a ser re-derivada contra o schema novo. O modelo two-tier seção/`parentBlockId` está **morto**. O Minuta adota a lib depois, expressando domínio via meta + blocos custom.

### D15 — Linha intenção × apresentação
O schema do core guarda apenas atributos universais de intenção autoral: `align` (left/center/right/justify) e `indent` — além dos marks inline. Tudo visual (fontSizePt, spacing, styleRole, temas, page setup) vive em meta do host e templates do host.

## Estrutura de diretórios

```
wealthy-text-editor/
├── src/
│   ├── editor/
│   │   ├── components/
│   │   │   ├── DocumentEditor.tsx       # API principal (multi-bloco)
│   │   │   ├── BlockEditor.tsx          # API secundária (bloco único)
│   │   │   ├── Toolbar.tsx
│   │   │   ├── SlashMenu.tsx
│   │   │   ├── FloatingMenu.tsx
│   │   │   └── BlockSelectionOverlay.tsx
│   │   ├── core/
│   │   │   ├── schema.ts               # Zod schemas + types
│   │   │   ├── sections.ts             # getSectionTree / getSection (derivação pura)
│   │   │   ├── numbering.ts            # numeração hierárquica computada
│   │   │   ├── commands.ts             # editor.commands.*
│   │   │   ├── transforms.ts           # transform helpers
│   │   │   ├── history.ts              # snapshot stack + coalescing
│   │   │   ├── patches.ts              # applyPatches pipeline
│   │   │   └── selection.ts            # cursor + block multi-select
│   │   ├── hooks/
│   │   │   ├── useDocumentEditor.ts
│   │   │   └── useBlockEditor.ts
│   │   ├── plugins/
│   │   │   ├── types.ts                # EditorPlugin interface
│   │   │   └── registry.ts
│   │   ├── i18n/
│   │   │   ├── pt-BR.ts
│   │   │   └── en.ts
│   │   └── exports/
│   │       ├── docx.ts                 # entry: wealthy-text-editor/export-docx
│   │       ├── html.ts                 # entry: wealthy-text-editor/export-html
│   │       └── markdown.ts             # entry: wealthy-text-editor/export-markdown
│   ├── internal/
│   │   ├── ui/                          # shadcn copiado + *.module.css
│   │   └── utils/cn.ts
│   └── index.ts
├── styles.css
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## Schema

```typescript
type Document<TMeta = Record<string, unknown>> = {
  schemaVersion: 1
  blocks: Block<TMeta>[]
  meta?: TMeta
}

type BaseBlock<TMeta> = {
  id: string                  // uuid, estável — nunca reutilizado
  meta?: TMeta                // bag do host: round-trip intacto, nunca interpretado
}

type HeadingBlock<TMeta> = BaseBlock<TMeta> & {
  type: "heading"
  level: 1 | 2 | 3 | 4 | 5 | 6
  align?: "left" | "center" | "right" | "justify"
  content: InlineNode[]
}

type TextBlock<TMeta> = BaseBlock<TMeta> & {
  type: "text"
  variant: "paragraph" | "bullet" | "numbered"
  indent?: number             // 0..n — containment de lista derivado daqui
  align?: "left" | "center" | "right" | "justify"
  content: InlineNode[]
}

type TableBlock<TMeta> = BaseBlock<TMeta> & {
  type: "table"
  columns: Array<{ id: string; align?: "left" | "center" | "right"; width?: { value: number; unit: "percent" | "px" } }>
  rows: Array<{ id: string; cells: Array<{ columnId: string; blocks: TextBlock<TMeta>[] }> }>
  showHeader: boolean
}

type CustomBlock<TMeta> = BaseBlock<TMeta> & {
  type: "custom"
  kind: string                // registrado por plugin (ex.: "request_list")
  data: Record<string, unknown>
}

type Block<TMeta> = HeadingBlock<TMeta> | TextBlock<TMeta> | TableBlock<TMeta> | CustomBlock<TMeta>

// Inline
type TextNode = {
  type: "text"
  text: string
  marks?: InlineMark[]
}

type InlineObjectNode = {
  type: "object"
  kind: string                // registrado por plugin (ex.: "placeholder", "mention")
  data: Record<string, unknown>
  meta?: Record<string, unknown>
}

type InlineNode = TextNode | InlineObjectNode

type InlineMark =
  | { type: "bold" } | { type: "italic" } | { type: "underline" }
  | { type: "strikethrough" } | { type: "code" }
  | { type: "link"; href: string }
  | { type: "color"; token: string } | { type: "highlight"; token: string }
```

## API pública

### Componente principal

```tsx
<DocumentEditor
  value={document}            // inicial; troca de referência = troca de documento
  onChange={handleChange}     // a cada transação
  onCommit={handleCommit}     // blur / idle / save explícito
  locale="pt-BR"
  extensions={[]}
  readonly={false}
  renderBlock?: (props: RenderBlockProps) => React.ReactNode
/>
```

### Hook headless

```tsx
const editor = useDocumentEditor({ value, onChange, plugins })

// blocos
editor.commands.updateBlock(blockId, patch)
editor.commands.insertBlockAfter(blockId, block)
editor.commands.deleteBlock(blockId)
editor.commands.moveBlock(blockId, afterBlockId)
editor.commands.turnInto(blockId, target)        // heading(level) | paragraph | bullet | numbered
editor.commands.splitBlock(blockId, offset)
editor.commands.mergeWithPrevious(blockId)
editor.commands.indent(blockId) / outdent(blockId)

// seções (derivadas)
editor.commands.moveSection(headingId, afterBlockId)   // re-nivela subárvore (D4)
editor.commands.deleteSection(headingId)
editor.commands.duplicateSection(headingId)

// externo
editor.commands.applyPatches(patches)            // entrada única p/ edições LLM/servidor (D10)

// histórico
editor.commands.undo() / redo()

// leitura
editor.getSectionTree()
editor.getSection(headingId)                     // { heading, blocks, subsections }
```

### Plugins

```typescript
interface EditorPlugin {
  name: string
  blockTypes?: BlockTypeRegistration[]       // CustomBlock kinds + renderers
  inlineObjects?: InlineObjectRegistration[] // InlineObjectNode kinds + renderers
  commands?: CommandRegistration[]
  slashMenuItems?: SlashMenuItem[]
  toolbarItems?: ToolbarItem[]
  onInit?: (ctx: EditorContext) => void
}
```

## Não-objetivos (v1)

- Colaboração em tempo real (CRDT/OT) — D13.
- Seleção parcial de texto cruzando blocos — D7.
- Tabelas aninhadas / headings dentro de células — D9.
- Inlines-contêiner editáveis por dentro — D6.
- Tipografia/spacing no schema do core — D15.

## Estilo

- CSS Modules com prefixo `.wte-` para escopo.
- Variáveis CSS definidas na lib (não dependem do theme do host).
- Host importa: `import "wealthy-text-editor/styles.css"`.
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
- `docx` (apenas no entry `export-docx`)

## Licenciamento

Os componentes shadcn/ui copiados são MIT license (compatível). A lib inteira será distribuída sob MIT.
