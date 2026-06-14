# wealthy-text-editor

> **"Rich" → "Wealthy"** — um editor de texto blocado, schema-first, headless e extensível.

Wealthy Text Editor é uma biblioteca React para edição de documentos estruturados em blocos. Ela nasceu do projeto Minuta e foi extraída como uma lib independente e genérica.

## Filosofia

- **Schema-first**: o documento é JSON puro. Blocos guardam **intenção** (ex: `{ type: "heading", level: 2 }`), não estilo. Estilo é responsabilidade do template.
- **Headless por design**: a lib traz uma folha de estilo opcional (`styles.css`, classes `.wte-*`), mas o host controla a aparência via Tailwind ou CSS próprio.
- **Camadas claras**: schema → commands → hooks → componentes → exporters. Cada camada é usável isoladamente.
- **Previsível**: operações explícitas via `editor.commands.*`, não mutação direta.
- **Native-first**: a digitação é pintada pelo navegador (contenteditable); o modelo é lido de volta a partir do DOM. O caret nunca é reescrito enquanto você digita.

## Instalação

```bash
pnpm add wealthy-text-editor
```

`react` e `react-dom` (v19) são peer deps. O subpath `wealthy-text-editor/export-docx` depende de `docx` (carregado só quando você importa esse subpath).

## Uso básico

```tsx
import { useState } from 'react';
import { createEmptyDocument } from 'wealthy-text-editor';
import { DocumentEditor } from 'wealthy-text-editor/react';
import 'wealthy-text-editor/styles.css';

function App() {
  const [doc, setDoc] = useState(createEmptyDocument());

  return (
    <DocumentEditor
      value={doc}
      onChange={setDoc}
      onCommit={(doc) => saveToDatabase(doc)}
    />
  );
}
```

`onChange` dispara a cada transação; `onCommit` dispara em blur/idle/explícito (debounce via `commitIdleMs`). Trocar a referência de `value` por outro documento substitui o conteúdo (pipeline D10).

### Props principais de `<DocumentEditor>`

| Prop                  | Tipo                                          | Descrição                                                    |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `value`               | `WealthyDocument<TMeta>`                       | Documento controlado.                                       |
| `onChange`            | `(doc, info) => void`                          | Por transação.                                              |
| `onCommit`            | `(doc) => void`                                | Em blur/idle/explícito.                                     |
| `commitIdleMs`        | `number`                                       | Janela de idle para o commit.                              |
| `readOnly`            | `boolean`                                      | Desabilita edição.                                         |
| `showHeadingNumbers`  | `boolean`                                      | Numeração hierárquica computada (1., 1.1…) antes de headings. |
| `plugins`             | `EditorPlugin<TMeta>[]`                         | Blocos/inlines custom, slash/toolbar items (D5/D6).        |
| `slashItems`          | `CustomSlashItem<TMeta>[]`                      | Itens de slash extras (atalho para um plugin só de slash). |
| `inlineTagToNode`     | `(text) => InlineNode \| null` \| `false`     | Regra `{{label}}` → chip (default: placeholder; `false` desativa). |
| `locale`              | `"en" \| "pt-BR"`                              | Locale do chrome interno (default `en`).                   |
| `messages`            | `Partial<EditorMessages>`                      | Override por-string sobre o `locale`.                      |
| `renderBlock`         | `(props) => ReactNode`                         | Renderer de blocos custom (um plugin do mesmo `kind` tem precedência). |
| `apiRef`              | `Ref<DocumentEditorApi<TMeta>>`                | Acesso ao engine headless (commands/selection/seções).    |

## Commands

```ts
editor.commands.updateBlock(id, patch);
editor.commands.insertBlockAfter(id, block);
editor.commands.deleteBlock(id);
editor.commands.moveBlock(id, afterBlockId);
editor.commands.turnInto(id, target); // heading(level) | paragraph | bullet | numbered
editor.commands.splitBlock(id, offset);
editor.commands.mergeWithPrevious(id);
editor.commands.indent(id); editor.commands.outdent(id);

// seções derivadas dos níveis de heading (lista plana, árvore computada)
editor.commands.moveSection(headingId, afterBlockId);
editor.commands.deleteSection(headingId);
editor.getSectionTree();

// inline objects (chips)
editor.commands.insertInlineNode(blockId, offset, node);
editor.commands.updateInlineObject(blockId, offset, { data, meta });
editor.commands.removeInlineNode(blockId, offset);

// edições externas (LLM/servidor) entram pelo mesmo pipeline de transação
editor.commands.applyPatches(patches);
editor.commands.undo(); editor.commands.redo();
```

## i18n

O chrome interno (slash menu, toolbar, controles de tabela, aria-labels, placeholder) é
localizável. O default é **`en`**; passe `locale="pt-BR"` para português, ou `messages`
para sobrescrever strings individuais.

```tsx
import { DocumentEditor } from 'wealthy-text-editor/react';

<DocumentEditor
  value={doc}
  onChange={setDoc}
  locale="pt-BR"
  // override pontual (mesclado sobre o dicionário do locale):
  messages={{ slashTable: 'Grade' }}
/>;
```

Para casos avançados (ex.: um terceiro idioma, ou compor o provider você mesmo):

```ts
import { resolveMessages, MessagesProvider, useMessages } from 'wealthy-text-editor/react';

const messages = resolveMessages('pt-BR', { slashNoResults: 'Nada aqui' });
```

> Apenas o chrome do **core** é localizado. Strings de plugins (ex.: o label do slash item
> de um plugin) são responsabilidade do autor do plugin.

## Plugins (D5/D6)

Um `EditorPlugin` registra renderers por `kind` e extensões do editor. Tudo é aditivo e
passado via `plugins`:

```tsx
import { DocumentEditor, separatorPlugin, type EditorPlugin } from 'wealthy-text-editor/react';

const myPlugin: EditorPlugin = {
  name: 'minuta',

  // Bloco custom: o host renderiza o `CustomBlock` deste kind.
  blockTypes: [
    {
      kind: 'callout',
      render: ({ block, update }) => (
        <input
          value={String(block.data.text ?? '')}
          onChange={(e) => update({ data: { ...block.data, text: e.target.value } })}
        />
      ),
    },
  ],

  // Inline object (chip): token nativo no contenteditable + popover de edição.
  inlineObjects: [
    {
      kind: 'placeholder',
      getLabel: (node) => String(node.data.value ?? node.data.label ?? 'campo'),
      getClassName: (node) => (node.data.value ? 'filled' : 'empty'),
      // Omitir renderEditor torna o chip não-interativo.
      renderEditor: (node, { update, remove, close }) => (
        <form onSubmit={(e) => { e.preventDefault(); close(); }}>
          <input
            defaultValue={String(node.data.value ?? '')}
            onBlur={(e) => update({ data: { ...node.data, value: e.target.value } })}
          />
          <button type="button" onClick={remove}>Remover</button>
        </form>
      ),
    },
  ],

  // Item do slash menu (mostrado após os tipos do core).
  slashItems: [
    {
      id: 'placeholder',
      label: 'Placeholder',
      hint: '{{}}',
      apply: ({ insertInlineNode }) =>
        insertInlineNode({ type: 'object', kind: 'placeholder', data: { key: 'campo', label: 'Campo' } }),
    },
  ],

  // Botão extra na floating toolbar (após os botões de marca).
  toolbarItems: [
    {
      id: 'mark-yellow',
      label: 'HL',
      isActive: (marks) => marks.has('highlight'),
      apply: ({ commands, selection }) => { /* … */ },
    },
  ],
};

<DocumentEditor value={doc} onChange={setDoc} plugins={[separatorPlugin, myPlugin]} />;
```

**Edição de chip (D16 intacto):** o chip continua um token nativo no contenteditable; clicar
nele abre o `renderEditor` num popover (overlay do `DocumentEditor`, não um portal React). O
contexto (`update`/`remove`/`close`) muta o modelo de forma atômica e undoável.

`separatorPlugin` é um plugin built-in de bloco custom: adiciona o comando `/separator` e
renderiza blocos criados com `createSeparatorBlock()`. O par React-free (`createSeparatorBlock`,
`SEPARATOR_BLOCK_KIND`) também é exportado da raiz, para os exporters/servidor.

## Paste (D11)

O `<DocumentEditor>` intercepta colagem automaticamente: HTML rico (Word/Docs/web) é
convertido para blocos do schema, com fallback para texto puro. Um parágrafo único é
inserido inline no bloco atual; múltiplos blocos entram como uma transação atômica (um único
undo). `<hr>` faz round-trip com o separator.

Os parsers também são exportados, para uso fora do componente:

```ts
import { parseClipboardToBlocks, parseHtmlToBlocks, parsePlainTextToBlocks } from 'wealthy-text-editor/react';

const blocks = parseClipboardToBlocks({ html, text }); // prefere HTML, cai para texto
```

## Exporters (D12)

Os exporters consomem o **modelo puro** (zero React) e vivem em subpaths separados:

```ts
import { exportHtml } from 'wealthy-text-editor/export-html';
import { exportMarkdown } from 'wealthy-text-editor/export-markdown';
import { exportDocx } from 'wealthy-text-editor/export-docx';
import { Packer } from 'docx';

const html = exportHtml(doc);           // string
const md = exportMarkdown(doc);          // string
const blob = await Packer.toBlob(exportDocx(doc)); // exportDocx → docx `Document`
```

Cada exporter aceita serializers por `kind` (`renderCustomBlock` / `renderInlineObject`) para
blocos custom e inline objects. A numeração de headings reaproveita `getHeadingNumbers`.
`exportDocx` retorna um `Document` da lib `docx`, que você empacota com `Packer` (`toBlob`,
`toBuffer`, …).

## Superfície pública (por entrada)

| Entrada                            | O que contém                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `wealthy-text-editor`              | **Core, sem React** — schema + types, factories, serialização, inline utils, sections, numbering, transforms, history, patches (D10), selection, marks, engine (`createEditorEngine`), e os helpers `createSeparatorBlock`/`SEPARATOR_BLOCK_KIND`. Seguro no servidor. |
| `wealthy-text-editor/react`        | Hooks (`useDocumentEditor`, `useBlockEditor`), componentes (`DocumentEditor`, `BlockEditor`, `InlineEditor`, `TableView`, `SlashMenu`, `FloatingToolbar`), utils DOM↔modelo, input rules, paste, i18n (`resolveMessages`/`MessagesProvider`/`useMessages`/`en`/`ptBR`), e o sistema de plugins (`buildPluginRegistry`, `separatorPlugin`, tipos). |
| `wealthy-text-editor/export-html`     | `exportHtml`                                                              |
| `wealthy-text-editor/export-markdown` | `exportMarkdown`                                                          |
| `wealthy-text-editor/export-docx`     | `exportDocx` (depende de `docx`)                                          |
| `wealthy-text-editor/styles.css`      | Folha global opcional (`.wte-*`).                                         |

> **Por que a divisão:** a entrada raiz fica livre de React para rodar no servidor (ex.:
> aplicar patches de LLM, exportar). Os componentes ficam em `/react`. Os exporters ficam em
> subpaths para não carregar `docx` quando você não exporta para Word.

## Schema

```typescript
type Block<TMeta> = HeadingBlock<TMeta> | TextBlock<TMeta> | TableBlock<TMeta> | CustomBlock<TMeta>
type WealthyDocument<TMeta> = { schemaVersion: 1; blocks: Block<TMeta>[]; meta?: TMeta }
```

O documento é uma **lista plana** — cada linha é um bloco. Seções (heading + conteúdo seguinte)
são **derivadas** dos níveis de heading, nunca armazenadas. O host anexa dados de domínio via
`meta` (round-trip intacto) e registra blocos/inlines custom via plugins.

Veja a [documentação completa do schema](./ARCHITECTURE.md#schema).

## Roadmap

| Versão | Conteúdo                              |
| ------ | ------------------------------------- |
| v0.1   | Schema + types                        |
| v0.2   | Core engine (commands/transforms)     |
| v0.3   | Hooks React                           |
| v0.4   | Componentes React                     |
| v0.5   | Plugins/exporters, paste, i18n, docs e CI |
| v1.0   | API estável                           |

Detalhes em [ROADMAP.md](./ROADMAP.md).

## Licença

MIT
