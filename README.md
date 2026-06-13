# wealthy-text-editor

> **"Rich" → "Wealthy"** — um editor de texto blocado, schema-first, headless e extensível.

Wealthy Text Editor é uma biblioteca React para edição de documentos estruturados em blocos. Ela nasceu do projeto Minuta e foi extraída como uma lib independente e genérica.

## Filosofia

- **Schema-first**: o documento é JSON puro. Blocos guardam **intenção** (ex: `{ type: "heading", level: 2 }`), não estilo. Estilo é responsabilidade do template.
- **Headless por design**: a lib não impõe estilos. O host controla a aparência via Tailwind ou CSS próprio.
- **Camadas claras**: schema → commands → hooks → componentes → exporters. Cada camada é usável isoladamente.
- **Previsível**: operações explícitas via `editor.commands.*`, não mutação direta.

## Instalação

```bash
pnpm add wealthy-text-editor
```

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

## API

### Componentes

| Componente         | Descrição                                     |
| ------------------ | --------------------------------------------- |
| `<DocumentEditor>` | API principal — editor multi-bloco completo   |
| `<BlockEditor>`    | API secundária — editor para um bloco isolado |

### Hooks

| Hook                  | Descrição                                                |
| --------------------- | -------------------------------------------------------- |
| `useDocumentEditor()` | Hook headless principal — controle total sem componentes |
| `useBlockEditor()`    | Hook headless para bloco único                           |

### Commands

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

// edições externas (LLM/servidor) entram pelo mesmo pipeline de transação
editor.commands.applyPatches(patches);
editor.commands.undo(); editor.commands.redo();
```

### Status de i18n

i18n ainda não está implementado. A prop `locale` permanece planejada para a finalização da v0.5.

### Plugins

```ts
import { createSeparatorBlock } from "wealthy-text-editor"
import { DocumentEditor, separatorPlugin } from "wealthy-text-editor/react"
import { myPlugin } from "./my-plugin"

<DocumentEditor plugins={[separatorPlugin, myPlugin]} />
```

`separatorPlugin` is a built-in custom-block plugin. It adds a `/separator` command and renders blocks created with `createSeparatorBlock()`.

### Exporters

```ts
import { exportHtml } from "wealthy-text-editor/export-html"
import { exportMarkdown } from "wealthy-text-editor/export-markdown"
import { exportDocx } from "wealthy-text-editor/export-docx"
```

> **Entradas do pacote:** `wealthy-text-editor` (raiz) é o core sem React — schema, engine, transforms, patches — seguro para uso no servidor (ex.: aplicar patches de LLM). `wealthy-text-editor/react` contém hooks e componentes. Os exporters vivem em subpaths separados para manter a entrada raiz livre de React e evitar carregar `docx` fora de `wealthy-text-editor/export-docx`.

## Schema

```typescript
type Block<TMeta> = HeadingBlock<TMeta> | TextBlock<TMeta> | TableBlock<TMeta> | CustomBlock<TMeta>
type Document<TMeta> = { schemaVersion: 1; blocks: Block<TMeta>[]; meta?: TMeta }
```

O documento é uma **lista plana** — cada linha é um bloco. Seções (heading + conteúdo seguinte) são **derivadas** dos níveis de heading, nunca armazenadas. O host anexa dados de domínio via `meta` (round-trip intacto) e registra blocos/inlines custom via plugins.

Veja a [documentação completa do schema](./ARCHITECTURE.md#schema).

## Roadmap

| Versão | Conteúdo                              |
| ------ | ------------------------------------- |
| v0.1   | Schema + types                        |
| v0.2   | Core engine (commands/transforms)     |
| v0.3   | Hooks React                           |
| v0.4   | Componentes React                     |
| v0.5   | Plugins/exporters feitos; paste, i18n, docs e CI pendentes |
| v1.0   | API estável                           |

Detalhes em [ROADMAP.md](./ROADMAP.md).

## Licença

MIT
