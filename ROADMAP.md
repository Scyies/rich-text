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

## v0.5 — Polimento final para v1.0 (📦 `wealthy-text-editor`) ✅

**Pacote:** fechar o restante da v0.5 antes de promover para release estável.

- **Rich paste HTML→schema (Word/Docs/web, fallback texto puro) (D11) ✅**
- **Decisão final de CSS: manter `styles.css` global `.wte-*` (resolvido — sem migração para CSS Modules) ✅**
- **i18n: dicionários `en` + `pt-BR`, prop `locale` (+ `messages` override) ✅**
- **README com exemplos completos de uso ✅**
- **Documentação de API pública (README §"Superfície pública") ✅**
- **CI: lint (ESLint flat), test, typecheck, build, smoke; publish em tag `v*` (GitHub Actions) ✅**

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

> Nota de implementação (Docs + CI — feito): README reescrito (instalação, uso, props,
> commands, i18n, plugins com edição de chip, paste, exporters com `Packer`, e a tabela
> "Superfície pública" enumerando as 6 entradas). ESLint flat config (`eslint.config.js`):
> `@eslint/js` + `typescript-eslint` recommended (sem type-check, p/ velocidade) +
> `react-hooks` (`rules-of-hooks` error, `exhaustive-deps` warn). Escopo: `src` + `demo`;
> os dirs legados `components/`/`shared/` (Minuta pré-extração, fora do tsconfig) e
> `scripts/` são ignorados. Único fix de código: `cause` no `SyntaxError` de
> `deserializeDocument`; dois `exhaustive-deps` intencionais documentados com disable.
> Script `lint` (`--max-warnings 0`) entrou no `validate:release` (primeiro passo).
> Workflow `.github/workflows/ci.yml`: job `validate` (pnpm + Node 24 → `validate:release`)
> em push/PR; job `publish` em tag `v*`, com dist-tag derivado da versão (prerelease →
> `alpha`, estável → `latest`) e provenance (precisa do secret `NPM_TOKEN`).
>
> Nota de implementação (i18n — feito): `src/editor/i18n/` — `messages.ts`
> (React-free: interface `EditorMessages`, dicionários `en`/`ptBR`, `resolveMessages`)
> + `context.tsx` (React: `MessagesProvider`/`useMessages`, default = `en`). **Default é
> `en`** (decisão do usuário; `pt-BR` via `locale="pt-BR"`) — diverge do handoff, que
> sugeria `pt-BR`. Só o chrome do core é localizado; strings de plugin ficam com o autor
> do plugin. `DocumentEditor`/`BlockEditor` ganharam props `locale?` e `messages?` (override
> raso), resolvem as mensagens num `useMemo` e envolvem a subárvore no provider; os leafs
> (`SlashMenu`, `FloatingToolbar`, `TableView`, `ChipPopover`, `BlockRow`) leem via
> `useMessages()`. Itens de slash do core vêm de `buildCoreSlashItems(messages)`;
> `CORE_SLASH_ITEMS` permanece exportado (labels `en`, back-compat). Testes: paridade de
> chaves en/pt-BR + troca de locale no componente. Verificado no navegador (toggle de locale
> no demo).
>
> Nota de implementação (Rich paste — feito): `src/editor/components/paste.ts` (lado
> React, depende de `DOMParser`; `[]` sem DOM). `parseHtmlToBlocks` inverte o exporter
> HTML — headings, parágrafos, listas aninhadas por indent, tabelas, `<hr>`→separator,
> divs recursivos, inline via `domToInlineNodes` (whitespace solto entre blocos é
> ignorado). `parseClipboardToBlocks` prefere HTML e sempre cai para texto puro (D11);
> `parsePlainTextToBlocks` quebra por `\n`. Handler `onPaste` no `DocumentEditor`:
> parágrafo único → splice inline no bloco atual; senão split + inserção atômica via
> `applyPatches` (`insert_block_after`/`delete_block` — um único undo), com substituição
> quando a linha está vazia. Markdown paste fica fora (não-objetivo). Verificado no
> navegador (preview): paste de bloco e inline interceptados e renderizados, sem erros.

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
