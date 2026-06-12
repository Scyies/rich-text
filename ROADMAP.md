# wealthy-text-editor — Roadmap

Publicação progressiva em 5 etapas. As decisões D1–D15 referenciadas estão em [ARCHITECTURE.md](./ARCHITECTURE.md#decisões-de-design-resolvidas).

## v0.1 — Schema (📦 `wealthy-text-editor`) ✅

**Pacote:** schema + tipos apenas.

- Zod schemas: `Document<TMeta>`, `Block` (heading/text/table/custom), `InlineNode` (text + object), `InlineMark` (D5, D6, D15)
- Células de tabela: lista restrita de text-blocks (D9)
- `createEmptyDocument()`, `createBlock()`
- `serializeDocument()`, `deserializeDocument()` — meta bag round-trip intacto (D5)
- Testes unitários dos schemas e validadores

**Arquivos:** `src/editor/core/schema.ts`

## v0.2 — Core Engine (📦 `wealthy-text-editor`) ✅

**Pacote:** motor headless (zero React).

- Derivação de seções: `getSectionTree()`, `getSection()` — função pura sobre o array plano (D1, D3)
- Sistema de commands: `editor.commands.*` incluindo `turnInto`, `indent`/`outdent`
- Ops de seção: `moveSection` com re-nivelamento de subárvore (D4), `deleteSection`, `duplicateSection`
- Transforms: split, merge, move, insert, delete, change type
- Numeração hierárquica computada (display-only) (D3.3)
- Histórico: snapshot stack + coalescing de digitação (D8)
- `applyPatches()` — pipeline único para edições externas/LLM (D10)
- Testes unitários de cada command, transform e da derivação de seções

**Arquivos:** `src/editor/core/{sections,numbering,commands,transforms,history,patches,selection}.ts`

## v0.3 — Hooks React (📦 `wealthy-text-editor`) ✅

**Pacote:** hooks headless para React.

- `useDocumentEditor()` — engine-owned state; `value` por referência = troca de documento (D10)
- `useBlockEditor()` — hook para bloco único
- Selection: cursor inline + multi-select de blocos (D7)
- Lifecycle: `onChange` por transação, `onCommit` em blur/idle/explícito, dirty detection
- Estado de collapse/expand de seções (view state, fora do JSON) (D3.4)

**Arquivos:** `src/editor/hooks/`

## v0.4 — Componentes React (📦 `wealthy-text-editor`)

**Pacote:** componentes de UI.

- `DocumentEditor` / `BlockEditor`
- Contenteditable por bloco + `BlockSelectionOverlay` para multi-select (D7)
- Enter/Backspace/Tab: split, merge, indent — cada linha é um bloco (D2)
- Input rules markdown: `# `, `- `, `1. `, Tab/Shift+Tab, Backspace reverte (D11)
- `SlashMenu` com tipos do core + plugins (D11)
- Drag and drop de blocos e seções (re-nivelamento, D4)
- Collapse/expand de seções na UI
- `Toolbar`, `FloatingMenu`
- shadcn/ui primitives copiados em `internal/ui/`

**Arquivos:** `src/editor/components/`, `src/internal/ui/`

## v0.5 — Estilo, i18n, Plugins, Paste (📦 `wealthy-text-editor`)

**Pacote:** polimento final para v1.0.

- Rich paste HTML→schema (Word/Docs/web, fallback texto puro) (D11)
- CSS Modules + `styles.css` global da lib
- i18n: dicionários pt-BR + en, prop `locale`
- Sistema de plugins: block types custom, inline objects, slash items (D5, D6)
- Exporters como subpath entries: `/export-docx`, `/export-html`, `/export-markdown` (D12)
- README com exemplos de uso
- Documentação de API pública
- CI: build, lint, test, publish automático

## v1.0 — Stable

- API congelada
- Breaking changes documentados via changelog
- Cobertura de testes > 80%
- Exemplo de app demo funcional
- Prova de extensibilidade: host demo com meta bag + bloco custom + inline object (estilo Minuta)

## Não-objetivos do v1

- Colaboração em tempo real (D13)
- Seleção parcial de texto cruzando blocos (D7)
- Tabelas aninhadas (D9)
- Markdown paste (D11)

---

## Timeline (sugerida)

| Etapa | Esforço estimado | Depende de |
|---|---|---|
| v0.1 Schema | 2-3 dias | — |
| v0.2 Core Engine | 5-7 dias | v0.1 |
| v0.3 Hooks | 3-5 dias | v0.2 |
| v0.4 Componentes | 7-10 dias | v0.3 |
| v0.5 Estilo/i18n/Plugins/Paste | 5-7 dias | v0.4 |
| v1.0 Stable | 2-3 dias | v0.5 |

Total estimado: ~25-35 dias de trabalho.
