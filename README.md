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
import { DocumentEditor } from 'wealthy-text-editor';
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
editor.commands.moveBlock(id, targetIndex);
editor.commands.turnIntoHeading(id, level);
editor.commands.turnIntoParagraph(id);
editor.commands.splitBlock(id, offset);
editor.commands.mergeWithPrevious(id);
```

### i18n

```tsx
<DocumentEditor locale="pt-BR" />
<DocumentEditor locale="en" />
```

### Plugins

```ts
import { DocumentEditor } from "wealthy-text-editor"
import { myPlugin } from "./my-plugin"

<DocumentEditor extensions={[myPlugin]} />
```

## Schema

```typescript
type Block = HeadingBlock | TextBlock | TableBlock | SpecialBlock
type LegalDocument = { version: number; blocks: Block[]; metadata?: {...} }
```

Veja a [documentação completa do schema](./ARCHITECTURE.md#schema-simplificado).

## Roadmap

| Versão | Conteúdo                              |
| ------ | ------------------------------------- |
| v0.1   | Schema + types                        |
| v0.2   | Core engine (commands/transforms)     |
| v0.3   | Hooks React                           |
| v0.4   | Componentes React                     |
| v0.5   | CSS Modules, i18n, plugins, exporters |
| v1.0   | API estável                           |

Detalhes em [ROADMAP.md](./ROADMAP.md).

## Licença

MIT
