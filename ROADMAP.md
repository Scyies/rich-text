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

## v0.4 — Componentes React (📦 `wealthy-text-editor`) ✅

> Nota de implementação: o pacote ganhou duas entradas — raiz (core, zero React, server-safe) e `/react` (hooks + componentes). CSS é folha global `.wte-*` (styles.css) em vez de CSS Modules; shadcn/radix não foi necessário até aqui (menus são posicionamento próprio). UX estrutural de tabela (add/remover linhas, resize) ficou para a v0.5.

**Pacote:** componentes de UI.

- `DocumentEditor` / `BlockEditor`
- Contenteditable por bloco + seleção de blocos via handles (D7)
- Enter/Backspace/Tab: split, merge, indent — cada linha é um bloco (D2)
- Input rules markdown: `# `, `- `, `1. `, Tab/Shift+Tab, Backspace reverte (D11)
- `SlashMenu` com tipos do core + plugins (D11)
- Drag and drop de blocos e seções (re-nivelamento, D4)
- Collapse/expand de seções na UI
- `FloatingToolbar`

**Arquivos:** `src/editor/components/`

## v0.5-alpha — Plugins e Exporters (📦 `wealthy-text-editor`) ✅ parcial

**Pacote:** validação antecipada das extensões e dos exporters antes do polimento final.

- **Sistema de plugins: block types custom, inline objects, slash items (D5, D6) ✅**
- **Exporters como subpath entries: `/export-docx`, `/export-html`, `/export-markdown` (D12) ✅**
- Edição de chips por `inlineObjects[].renderEditor` ✅
- `package.json` expõe root core, `/react`, exporters e `styles.css` ✅

## v0.5 — Polimento final para v1.0 (📦 `wealthy-text-editor`) ⏳

**Pacote:** fechar o restante da v0.5 antes de promover para release estável.

- Rich paste HTML→schema (Word/Docs/web, fallback texto puro) (D11)
- Decisão final de CSS: manter `styles.css` global `.wte-*` ou migrar para CSS Modules
- i18n: dicionários pt-BR + en, prop `locale`
- README com exemplos completos de uso
- Documentação de API pública
- CI: build, lint, test, publish automático

> Nota de implementação (Plugins — feito): o sistema de plugins (`EditorPlugin`) vive
> no lado React (`/react`), não em `core/`, pois renderers são React — coerente com o
> split de duas entradas da v0.4. Registra: block types custom (`blockTypes`, sobrepõe a
> prop `renderBlock`), inline objects (`inlineObjects`), slash items (`slashItems`, funde
> com a prop homônima) e toolbar items (`toolbarItems`, enxuto). **Edição de chip** (adiada
> da v0.4) entregue via `inlineObjects[].renderEditor` no modelo **popover-on-click** —
> o chip continua um token nativo no contenteditable (D16 intacto) e o popover é um overlay
> do `DocumentEditor` (mesmo padrão de `SlashMenu`/`FloatingToolbar`), não portais React.
> Núcleo ganhou os transforms/commands puros `updateInlineObject`/`removeInlineNode`.
> `commands`/`onInit` do esboço inicial de plugins foram adiados (sem consumidor na v0.5;
> aditivos depois). A prop do componente chama-se `plugins` (não `extensions`).

> Nota de implementação (Exporters — feito): três entradas tsup achatadas
> (`dist/{html,markdown,docx}.js`) mapeadas em `package.json` para
> `wealthy-text-editor/export-{html,markdown,docx}`. Todas consomem o modelo puro
> (zero React). `exportHtml`/`exportMarkdown` retornam string (testes de saída exata);
> `exportDocx` usa a lib `docx` (única dep pesada, **externalizada** — só carrega via o
> subpath docx) e retorna um `Document` que o consumidor empacota com `Packer`. Cada um
> aceita serializers por `kind` (`renderCustomBlock`/`renderInlineObject`) para blocos
> custom e inline objects (D5/D6); numeração de heading reaproveita `numbering.ts`.
> Marks sem equivalente: HTML usa `<mark>`/classe de token; Markdown cai para HTML inline
> (underline/highlight) e descarta `color`; docx faz best-effort (code→monospace,
> color só se hex, highlight descartado). Verificação docx: descompacta o `.docx` e checa
> `word/document.xml` (jszip, devDep).

## Validação de release

Antes de publicar qualquer pacote:

```bash
pnpm validate:release
```

Esse script roda testes, typecheck, build, `pnpm pack --dry-run` e um smoke test das entradas
`wealthy-text-editor`, `/react`, `/export-html`, `/export-markdown` e `/export-docx`.

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
| v0.5-alpha Plugins/Exporters | feito | v0.4 |
| v0.5 Estilo/i18n/Paste/Docs/CI | 5-7 dias | v0.5-alpha |
| v1.0 Stable | 2-3 dias | v0.5 |

Total estimado: ~25-35 dias de trabalho.
