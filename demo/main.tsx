import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  SCHEMA_VERSION,
  createCustomBlock,
  createHeadingBlock,
  createSeparatorBlock,
  createTableBlock,
  createTextBlock,
  type WealthyDocument,
} from "wealthy-text-editor";
import {
  DocumentEditor,
  separatorPlugin,
  type CustomSlashItem,
  type DocumentEditorApi,
  type EditorPlugin,
  type Locale,
} from "wealthy-text-editor/react";
import "wealthy-text-editor/styles.css";
import "./demo.css";

// Slash inserts a generic placeholder; the {{Label}} syntax is the path
// for a specifically-named one (the filter text isn't the label).
const placeholderSlashItem: CustomSlashItem = {
  id: "placeholder",
  label: "Placeholder",
  hint: "{{}}",
  keywords: ["campo", "placeholder", "tag"],
  apply: ({ insertInlineNode }) => {
    insertInlineNode({ type: "object", kind: "placeholder", data: { key: "campo", label: "Campo" } });
  },
};

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

// Everything domain-specific rides on one plugin (v0.5): the placeholder chip
// (with a click-to-fill popover), the slash item that inserts it, and a
// host-rendered "callout" custom block — the whole plugin surface, dogfooded.
const minutaPlugin: EditorPlugin = {
  name: "minuta-demo",
  slashItems: [placeholderSlashItem],
  inlineObjects: [
    {
      kind: "placeholder",
      getLabel: (node) => {
        const value = stringField(node.data, "value");
        return value.length > 0 ? value : stringField(node.data, "label") || "campo";
      },
      getClassName: (node) => (stringField(node.data, "value").length > 0 ? "filled" : "empty"),
      renderEditor: (node, { update, remove, close }) => {
        const label = stringField(node.data, "label") || "Campo";
        return (
          <form
            className="demo-fill"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("value") as HTMLInputElement;
              update({ data: { ...node.data, value: input.value } });
              close();
            }}
          >
            <label>
              {label}
              <input name="value" autoFocus defaultValue={stringField(node.data, "value")} placeholder="Preencher…" />
            </label>
            <div className="demo-fill__actions">
              <button type="button" className="demo-fill__remove" onClick={remove}>
                Remover
              </button>
              <button type="submit">Salvar</button>
            </div>
          </form>
        );
      },
    },
  ],
  blockTypes: [
    {
      kind: "callout",
      render: ({ block, update }) => (
        <div className="demo-callout">
          <span aria-hidden>💡</span>
          <input
            value={stringField(block.data, "text")}
            onChange={(event) => update({ data: { ...block.data, text: event.target.value } })}
          />
        </div>
      ),
    },
  ],
};

function buildSampleDocument(): WealthyDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    blocks: [
      createHeadingBlock({ level: 1, content: "Petição Inicial" }),
      createTextBlock({
        content: [
          { type: "text", text: "This demo exercises the " },
          { type: "text", text: "wealthy-text-editor", marks: [{ type: "bold" }] },
          { type: "text", text: " pipeline end to end. Try " },
          { type: "text", text: "markdown rules", marks: [{ type: "italic" }] },
          { type: "text", text: " (\"# \", \"- \", \"1. \"), the slash menu (\"/\"), {{tags}} for placeholders (click a chip to fill it), Tab/Shift+Tab, drag handles, and the heading chevrons." },
        ],
      }),
      createHeadingBlock({ level: 2, content: "Dos Fatos" }),
      createTextBlock({
        content: [
          { type: "text", text: "The client " },
          { type: "object", kind: "placeholder", data: { key: "client_name", label: "Cliente" } },
          { type: "text", text: " signed the contract on the agreed date." },
        ],
        meta: { role: "facts" },
      }),
      createTextBlock({ variant: "bullet", content: "First supporting fact" }),
      createTextBlock({ variant: "bullet", content: "Second supporting fact" }),
      createTextBlock({ variant: "bullet", content: "Nested detail", indent: 1 }),
      createSeparatorBlock(),
      createHeadingBlock({ level: 2, content: "Do Direito" }),
      createTextBlock({ variant: "numbered", content: "First legal ground" }),
      createTextBlock({ variant: "numbered", content: "Second legal ground" }),
      createTableBlock({ columnCount: 3, rowCount: 2 }),
      createCustomBlock({ kind: "callout", data: { text: "Host-rendered custom block (plugin blockType)." } }),
      createTextBlock({ content: "" }),
    ],
  };
}

function App() {
  const [document, setDocument] = useState(buildSampleDocument);
  const [lastCommit, setLastCommit] = useState<string>("—");
  const [showJson, setShowJson] = useState(true);
  const [locale, setLocale] = useState<Locale>("en");
  const editorRef = useRef<DocumentEditorApi | null>(null);

  function insertPlaceholderAtCaret() {
    const api = editorRef.current;
    const selection = api?.selection;
    if (api == null || selection?.type !== "text") {
      return;
    }
    api.commands.insertInlineNode(selection.blockId, Math.min(selection.anchor, selection.focus), {
      type: "object",
      kind: "placeholder",
      data: { key: "novo_campo", label: "Novo Campo" },
    });
  }

  return (
    <div className="demo">
      <header className="demo__header">
        <h1>wealthy-text-editor</h1>
        <span className="demo__meta">
          blocks: {document.blocks.length} · last idle commit: {lastCommit}
        </span>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault() /* keep editor focus/caret */}
          onClick={insertPlaceholderAtCaret}
        >
          + Placeholder
        </button>
        <button type="button" onClick={() => setShowJson((value) => !value)}>
          {showJson ? "Hide JSON" : "Show JSON"}
        </button>
        <button
          type="button"
          data-testid="locale-toggle"
          onClick={() => setLocale((value) => (value === "en" ? "pt-BR" : "en"))}
        >
          locale: {locale}
        </button>
      </header>
      <main className={showJson ? "demo__main demo__main--split" : "demo__main"}>
        <div className="demo__editor">
          <DocumentEditor
            ref={editorRef}
            plugins={[minutaPlugin, separatorPlugin]}
            value={document}
            onChange={setDocument}
            onCommit={() => setLastCommit(new Date().toLocaleTimeString())}
            commitIdleMs={1500}
            showHeadingNumbers
            locale={locale}
          />
        </div>
        {showJson && (
          <aside className="demo__json">
            <pre data-testid="json">{JSON.stringify(document, null, 2)}</pre>
          </aside>
        )}
      </main>
    </div>
  );
}

// Reuse the root across Vite HMR re-executions of this module.
const globalScope = globalThis as { __demoRoot?: ReturnType<typeof createRoot> };
const root = (globalScope.__demoRoot ??= createRoot(document.getElementById("root")!));
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
