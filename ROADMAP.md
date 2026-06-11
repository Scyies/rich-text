# wealthy-text-editor — Roadmap

Publicação progressiva em 5 etapas.

## v0.1 — Schema (📦 `wealthy-text-editor`)

**Pacote:** schema + tipos apenas.

- Zod schemas: `Block`, `HeadingBlock`, `TextBlock`, `TableBlock`, `InlineNode`, `LegalDocument`
- Typescript types exportados
- `createEmptyDocument()`, `createBlock()`
- `serializeDocument()`, `deserializeDocument()`
- Testes unitários dos schemas e validadores

**Arquivos:** `src/editor/core/schema.ts`

## v0.2 — Core Engine (📦 `wealthy-text-editor`)

**Pacote:** motor headless (zero React).

- Sistema de commands: `editor.commands.*`
- Transforms de documento: split, merge, move, insert, delete, change type
- Engine de numeração hierárquica
- Testes unitários de cada command e transform

**Arquivos:** `src/editor/core/{commands,transforms,selection}.ts`

## v0.3 — Hooks React (📦 `wealthy-text-editor`)

**Pacote:** hooks headless para React.

- `useDocumentEditor()` — hook principal
- `useBlockEditor()` — hook para bloco único
- Gerenciamento de selection/cursor
- Lifecycle: onChange, onCommit, dirty detection
- `EditorChange` tracking (`insert_block`, `update_block`, `delete_block`, `move_block`, etc.)

**Arquivos:** `src/editor/hooks/`

## v0.4 — Componentes React (📦 `wealthy-text-editor`)

**Pacote:** componentes de UI.

- `DocumentEditor` — API principal multi-bloco
- `BlockEditor` — API secundária bloco único
- `Toolbar`, `FloatingMenu`, `DocumentBlockPreview`
- Contenteditable inline editor custom
- Sistema de entrada/saída de bloco (Enter, Backspace, Tab)
- Drag and drop entre blocos
- shadcn/ui primitives copiados em `internal/ui/`

**Arquivos:** `src/editor/components/`, `src/internal/ui/`

## v0.5 — Estilo, i18n, Plugins (📦 `wealthy-text-editor`)

**Pacote:** polimento final para v1.0.

- CSS Modules + `styles.css` global da lib
- i18n: dicionários pt-BR + en, prop `locale`
- Sistema de plugins: `EditorPlugin` interface + registry
- Exporters: `exportToDocx`, `exportToHtml`, `exportToMarkdown`
- README com exemplos de uso
- Documentação de API pública
- CI: build, lint, test, publish automático

## v1.0 — Stable

- API congelada
- Breaking changes documentados via changelog
- Cobertura de testes > 80%
- Exemplo de app demo funcional

---

## Timeline (sugerida)

| Etapa | Esforço estimado | Depende de |
|---|---|---|
| v0.1 Schema | 2-3 dias | — |
| v0.2 Core Engine | 5-7 dias | v0.1 |
| v0.3 Hooks | 3-5 dias | v0.2 |
| v0.4 Componentes | 7-10 dias | v0.3 |
| v0.5 Estilo/i18n/Plugins | 5-7 dias | v0.4 |
| v1.0 Stable | 2-3 dias | v0.5 |

Total estimado: ~25-35 dias de trabalho.
