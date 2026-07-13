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
- Selection: ranges direcionais entre blocos + multi-select estrutural de blocos (D7) ✅
- Lifecycle: `onChange` por transação, `onCommit` em blur/idle/explícito, dirty detection
- Estado de collapse/expand de seções (view state, fora do JSON) (D3.4)

**Arquivos:** `src/editor/hooks/`

## v0.4 — Componentes React (📦 `wealthy-text-editor`) ✅

> Nota de implementação: o pacote ganhou duas entradas — raiz (core, zero React, server-safe) e `/react` (hooks + componentes). CSS é folha global `.wte-*` (styles.css) em vez de CSS Modules; shadcn/radix não foi necessário até aqui (menus são posicionamento próprio). UX estrutural de tabela (add/remover linhas, resize) ficou para a v0.5.

**Pacote:** componentes de UI.

- `DocumentEditor` / `BlockEditor`
- Contenteditable por bloco + seleção parcial entre blocos + seleção estrutural via handles (D7) ✅
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

## Pré-v1.0 — Finish step / API freeze hardening ⏳

**Pacote:** reduzir superfície pública acidental e fechar decisões de contrato antes da
documentação final de v1.0. Esta etapa é o gate entre o alpha funcional e uma API estável.

### Correções obrigatórias antes do freeze

- **Generics do documento:** implementar `WealthyDocument<TBlockMeta = BlockMeta, TDocMeta = BlockMeta>`.
  Nota: adicionar um segundo parâmetro defaultado depois seria não-breaking em TS, mas fazer agora
  é barato e deixa explícito que `document.meta` não precisa ter a mesma shape de `block.meta`.
  Escopo v1.0: model/engine/serialization; React pode continuar single-generic e ganhar `TDocMeta`
  depois sem breaking change.
- **`renderBlock`:** unificar `DocumentEditor` e `BlockEditor` no mesmo `RenderBlockProps`.
- **Paridade de props:** adicionar `ariaLabel` ao `BlockEditor` ou documentar conscientemente
  a omissão. Recomendação atual: adicionar.
- **`/react` estável:** aparar exports de UI interna (`InlineEditor`, `TableView`, `SlashMenu`,
  `FloatingToolbar`) e helpers DOM (`domToInlineNodes`, `inlineNodesToHtml`, caret/selection
  helpers). Também revisar exports borderline: remover `buildPluginRegistry`/`PluginRegistry`
  (internos) e remover `CORE_SLASH_ITEMS`/`filterSlashItems`/`matchInputRule` salvo se houver
  consumidor host real. Recomendação atual: remover da superfície estável; se Minuta precisar,
  criar `wealthy-text-editor/unstable` em vez de congelar esses contratos.
- **React ref:** como o peer atual é React `>=19`, trocar `apiRef` por `ref` no `DocumentEditor`
  antes do freeze. Manter `apiRef` só faria sentido se o pacote decidir suportar React 18.
- **`TableColumn.width`:** honrar em HTML via `<colgroup>`. No DOCX, documentar como não
  suportado em v1.0 (o exporter mínimo ignora `width`); revisitar quando o export DOCX do
  Minuta amadurecer.

### Decisões de superfície pública

- **Schemas Zod:** os schemas crus (`documentSchema`, `blockSchema`, `documentPatchSchema`,
  `turnIntoTargetSchema`, etc.) não entram na API estável da raiz.
  Manter validadores (`validateDocument`, `safeValidateDocument`) e tipos (`DocumentPatch`) como
  contrato estável; mover schemas crus para `unstable`/`advanced` só se houver necessidade real.
- **History:** remover `createHistory`, `History`, `HistoryEntry` e `HistoryOptions` da raiz.
  Catch de implementação: `EditorEngineOptions` hoje herda `HistoryOptions`, que inclui `now?: () => number`
  para testes. Inline `limit`/`coalesceWindowMs` em `EditorEngineOptions` e não vazar `now` na API pública.
- **Slash items:** manter `DocumentEditor.slashItems` e `plugins[].slashItems`; congelar a
  precedência atual com teste: display `core → host → plugin`, e host override de plugin por `id`
  duplicado na aplicação.
- **Engine escape hatch:** manter `DocumentEditorApi.engine`. Motivo: `EditorEngine`/`EditorCommands`
  já são API estável porque `createEditorEngine` é público na raiz; o escape hatch não adiciona
  uma superfície nova, só expõe a mesma API no componente React.

### DOCX export — escopo v1.0 (mínimo) e trabalho futuro

**Status:** NÃO bloqueia o freeze. O export DOCX rico/template-grade fica **fora da lib em v1.0**.

**Decisão:** o export DOCX template-grade (page setup, headers/footers, estilos por `meta.role`,
placeholders como campos Word, numeração nativa, hooks de estilo) será desenvolvido **dentro do
Minuta**, sobre o modelo puro da lib (`getSectionTree`/`getHeadingNumbers`/`getListItemNumbers`
+ inline helpers). Motivo: ainda não conhecemos os requisitos reais; extrair uma abstração
genérica de um único consumidor agora produziria um contrato errado — e congelado. Primeiro
construir concreto no Minuta, depois extrair o que provar ser genérico (pós-1.0, aditivo).

Escopo v1.0 na lib (mínimo, genérico):

- Manter o `exportDocx` atual (caso simples + referência que o Minuta pode bifurcar). **Não**
  crescer para um engine de template.
- Remover o option no-op `headingNumbers` de `DocxExportOptions` (HTML/Markdown mantêm os seus).
- `docx` passa a `peerDependency` — o host já importa `docx` para o `Packer`; evita duas
  instâncias (risco com `Packer`) e mantém os tipos `docx` sob controle do host, não congelados
  pela lib.
- Congelar apenas a superfície pequena atual do exporter.

Pré-requisito que isto exige: o **modelo + helpers de numbering/section precisam estar estáveis**,
pois o gerador DOCX do Minuta depende deles. A garantia mecânica disso (api report + type tests)
está em "Trabalho futuro" abaixo — não bloqueia o freeze, mas deve preceder a confiança total.

### Trabalho futuro (pós-v1.0 / backlog — não bloqueia o freeze)

- **DOCX template-grade no Minuta:** construir o export legal sobre o modelo da lib; quando o
  boundary genérico/específico ficar óbvio a partir de código real (ou surgir um 2º consumidor),
  extrair as partes genéricas de volta para a lib como feature **aditiva** v1.x.
- **Tooling de estabilidade de API (não é version-specific — pode entrar a qualquer momento):**
  - Relatório de superfície pública no CI (api-extractor ou snapshot de `.d.ts` + lista de
    exports por entrada) que falha o build em mudança não intencional.
  - Testes de tipo (`expect-type`/`tsd`) das assinaturas do modelo e dos helpers de
    numbering/section (`getSectionTree`, `getHeadingNumbers`, `getListItemNumbers`, …).
  - Golden corpus com documentos reais do Minuta: snapshot de section/numbering + round-trip
    `serialize`/`deserialize` (quando houver docs reais para usar como fixtures).
- **Cobertura:** adicionar `@vitest/coverage-v8` com gate alto em `sections.ts`/`numbering.ts`.

### Contratos intencionais para documentar

- `updateBlock(patch: Record<string, unknown>)` e APIs equivalentes aceitam patch frouxo por
  design; validação acontece no schema/transform.
- `CustomBlock.data`, `InlineObjectNode.data` e `InlineObjectNode.meta` são bags opacas
  (`Record<string, unknown>`) e o core nunca as tipa nem interpreta.
- O modelo suporta headings `1..6`; chrome/slash/input rules criam apenas `1..3` por padrão.
- `schemaVersion: 1` é o formato wire congelado para v1.0; versões futuras precisam de uma
  história explícita de migração.
- Plugin lifecycle (`commands`, `onInit`, etc.) fica fora do freeze atual e deve entrar depois
  de forma aditiva, sem quebrar o shape atual de `EditorPlugin`.
- Classes CSS estáveis: documentar exatamente `.wte-editor`, `.wte-block`,
  `.wte-inline-editor`, `.wte-inline-object`, `.wte-table`, `.wte-separator` e as variables
  `--wte-foreground`, `--wte-muted`, `--wte-border`, `--wte-accent`, `--wte-accent-soft`,
  `--wte-surface`, `--wte-radius`. Marcar o resto como interno/unstable
  (`.wte-floating-toolbar*`, `.wte-slash-menu*`, `.wte-block__gutter/handle/chevron`,
  `.wte-chip-popover`, etc.).
- Markdown exporter: documentar que `showHeader: false` não round-trippa fielmente em GFM;
  tabelas Markdown exigem uma linha de header e o exporter usa a primeira linha.
- Tidiness: consolidar export duplicado de `selectionsEqual` se conveniente; não é bug.
- Congelar `schemaVersion: 1` e escrever a nota de migração futura.

### Definition of done

- Superfície pública final revisada export-by-export: raiz, `/react`, exporters e `styles.css`.
- DOCX: `exportDocx` mínimo mantido e testado; option no-op `headingNumbers` removido; `docx`
  como `peerDependency`. Export template-grade explicitamente fora de escopo v1.0 (vai no Minuta).
- README/API docs escritos contra a superfície final, não contra exports acidentais.
- Demo e testes migrados para os contratos finais (`ref`, exports aparados, decisões de slash).
- `pnpm validate:release` verde e smoke das entradas públicas atualizado.

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
- Ranges cruzando captions/células e blocos top-level (fora do escopo inicial de D7)
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
| Pré-v1.0 API freeze hardening | 3-5 dias | v0.5 |
| v1.0 Stable | 2-3 dias | Pré-v1.0 |

Total estimado: ~25-35 dias de trabalho.
