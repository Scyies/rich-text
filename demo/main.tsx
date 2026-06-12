import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  SCHEMA_VERSION,
  createCustomBlock,
  createHeadingBlock,
  createTableBlock,
  createTextBlock,
  type WealthyDocument,
} from "wealthy-text-editor";
import { DocumentEditor, type CustomSlashItem, type DocumentEditorApi } from "wealthy-text-editor/react";

const placeholderSlashItem: CustomSlashItem = {
  id: "placeholder",
  label: "Placeholder",
  hint: "{{}}",
  keywords: ["campo", "placeholder", "tag"],
  apply: ({ insertInlineNode, query }) => {
    const label = query.trim().length > 0 ? query.trim() : "Campo";
    insertInlineNode({ type: "object", kind: "placeholder", data: { key: label.toLowerCase(), label } });
  },
};
import "wealthy-text-editor/styles.css";
import "./demo.css";

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
          { type: "text", text: " (\"# \", \"- \", \"1. \"), the slash menu (\"/\"), {{tags}} for placeholders, Tab/Shift+Tab, drag handles, and the heading chevrons." },
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
      createHeadingBlock({ level: 2, content: "Do Direito" }),
      createTextBlock({ variant: "numbered", content: "First legal ground" }),
      createTextBlock({ variant: "numbered", content: "Second legal ground" }),
      createTableBlock({ columnCount: 3, rowCount: 2 }),
      createCustomBlock({ kind: "callout", data: { text: "Host-rendered custom block (renderBlock prop)." } }),
      createTextBlock({ content: "" }),
    ],
  };
}

function App() {
  const [document, setDocument] = useState(buildSampleDocument);
  const [lastCommit, setLastCommit] = useState<string>("—");
  const [showJson, setShowJson] = useState(true);
  const apiRef = useRef<DocumentEditorApi | null>(null);

  function insertPlaceholderAtCaret() {
    const api = apiRef.current;
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
      </header>
      <main className={showJson ? "demo__main demo__main--split" : "demo__main"}>
        <div className="demo__editor">
          <DocumentEditor
            apiRef={apiRef}
            slashItems={[placeholderSlashItem]}
            value={document}
            onChange={setDocument}
            onCommit={() => setLastCommit(new Date().toLocaleTimeString())}
            commitIdleMs={1500}
            showHeadingNumbers
            renderBlock={({ block, update }) => (
              <div className="demo-callout">
                <span aria-hidden>💡</span>
                <input
                  value={String(block.data["text"] ?? "")}
                  onChange={(event) => update({ data: { ...block.data, text: event.target.value } })}
                />
              </div>
            )}
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
