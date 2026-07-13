import { StrictMode, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  SCHEMA_VERSION,
  createCustomBlock,
  createEmptyImageGroupBlock,
  createHeadingBlock,
  createSeparatorBlock,
  createTableBlock,
  createTextBlock,
  getSelectedTextSlices,
  selectionPointsEqual,
  type EditorSelection,
  type WealthyDocument,
} from "wealthy-text-editor";
import {
  defineBlockType,
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

const EMPTY_SUBSCRIBE = () => () => {};

type CalloutData = {
  text: string;
  tone: "note" | "warning";
};

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

const calloutBlockType = defineBlockType({
  kind: "callout",
  decode(data): CalloutData {
    return {
      text: stringField(data, "text"),
      tone: data["tone"] === "warning" ? "warning" : "note",
    };
  },
  render: ({ block, update }) => (
    <div className={`demo-callout demo-callout--${block.data.tone}`}>
      <span className="demo-callout__mark" aria-hidden>{block.data.tone === "warning" ? "!" : "§"}</span>
      <div className="demo-callout__body">
        <span className="demo-callout__eyebrow">Typed plugin block</span>
        <input
          aria-label="Callout text"
          value={block.data.text}
          onChange={(event) => update({ data: { ...block.data, text: event.target.value } })}
        />
      </div>
    </div>
  ),
});

// Everything domain-specific rides on one plugin (v0.5): the placeholder chip
// (with a click-to-fill popover), the slash item that inserts it, and a typed
// host-rendered callout block — the whole plugin surface, dogfooded.
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
  blockTypes: [calloutBlockType],
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
          { type: "text", text: " (\"# \", \"- \", \"1. \"), the slash menu (\"/\"), {{tags}} for placeholders, image paste/drop, drag handles, and heading chevrons. Drag across the heading and facts below to exercise document-wide text selection." },
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
      // An empty image row: drag or paste an image into each slot to fill it.
      createEmptyImageGroupBlock({ columns: 2, gap: 12 }),
      createCustomBlock({
        kind: "callout",
        data: { text: "This host-rendered block is decoded by defineBlockType().", tone: "note" },
      }),
      createTextBlock({ content: "" }),
    ],
  };
}

function describeSelection(document: WealthyDocument, selection: EditorSelection | null): string {
  if (selection === null) return "No active selection";
  if (selection.type === "blocks") {
    const anchor = document.blocks.findIndex((block) => block.id === selection.anchorBlockId);
    const focus = document.blocks.findIndex((block) => block.id === selection.focusBlockId);
    const count = anchor === -1 || focus === -1 ? 0 : Math.abs(anchor - focus) + 1;
    return `${count} whole block${count === 1 ? "" : "s"} selected`;
  }
  if (selectionPointsEqual(selection.anchor, selection.focus)) {
    const index = document.blocks.findIndex((block) => block.id === selection.focus.blockId);
    return `Caret in block ${index + 1} · offset ${selection.focus.offset}`;
  }
  const slices = getSelectedTextSlices(document, selection);
  if (slices === null) return "Local nested text selection";
  return `${slices.length} text block${slices.length === 1 ? "" : "s"} · ${selection.anchor.offset} → ${selection.focus.offset}`;
}

function supportsInlineInsertion(document: WealthyDocument, selection: EditorSelection | null): boolean {
  if (selection?.type !== "text" || selection.anchor.entryId !== undefined || selection.focus.entryId !== undefined) {
    return false;
  }
  return [selection.anchor, selection.focus].every((point) => {
    const block = document.blocks.find((candidate) => candidate.id === point.blockId);
    return block?.type === "heading" || block?.type === "text";
  });
}

function App() {
  const [document, setDocument] = useState(buildSampleDocument);
  const [lastCommit, setLastCommit] = useState<string>("—");
  const [showJson, setShowJson] = useState(true);
  const [locale, setLocale] = useState<Locale>("en");
  const editorRef = useRef<DocumentEditorApi | null>(null);
  const [editorEngine, setEditorEngine] = useState<DocumentEditorApi["engine"] | null>(null);

  const captureEditor = useCallback((api: DocumentEditorApi | null) => {
    editorRef.current = api;
    if (api !== null) setEditorEngine((current) => current ?? api.engine);
  }, []);
  const subscribeToSelection = useCallback(
    (onStoreChange: () => void) => editorEngine?.subscribe(() => onStoreChange()) ?? EMPTY_SUBSCRIBE(),
    [editorEngine],
  );
  const getSelectionSnapshot = useCallback(() => editorEngine?.getSelection() ?? null, [editorEngine]);
  const selection = useSyncExternalStore(subscribeToSelection, getSelectionSnapshot, () => null);

  // Image dogfooding. Images are user-supplied via drag/paste: the `/image row`
  // slash inserts empty slots, and dropped/pasted files are host-owned — we keep
  // the bytes as object URLs behind opaque asset ids and resolve them at render.
  const assetUrls = useRef(new Map<string, string>());

  function uploadImage(file: File) {
    const id = `asset-${crypto.randomUUID()}`;
    assetUrls.current.set(id, URL.createObjectURL(file));
    return { source: { type: "asset" as const, id }, altText: file.name };
  }

  function insertPlaceholderAtCaret() {
    const api = editorRef.current;
    if (api == null || selection?.type !== "text" || !supportsInlineInsertion(document, selection)) {
      return;
    }
    const node = {
      type: "object",
      kind: "placeholder",
      data: { key: "novo_campo", label: "Novo Campo" },
    } as const;
    if (selectionPointsEqual(selection.anchor, selection.focus)) {
      api.commands.insertInlineNode(selection.focus.blockId, selection.focus.offset, node);
    } else {
      api.commands.replaceTextRange(selection, [node]);
    }
  }

  const canInsertPlaceholder = supportsInlineInsertion(document, selection);
  const selectionLabel = describeSelection(document, selection);

  return (
    <div className="demo">
      <header className="demo__header">
        <div className="demo__brand">
          <span className="demo__brand-mark" aria-hidden>W</span>
          <div>
            <h1>Wealthy Text</h1>
            <span>Integration workbench</span>
          </div>
        </div>
        <span className="demo__meta">{document.blocks.length} blocks · commit {lastCommit}</span>
        <div className="demo__actions">
          <button
            type="button"
            disabled={!canInsertPlaceholder}
            onMouseDown={(event) => event.preventDefault() /* keep editor focus/caret */}
            onClick={insertPlaceholderAtCaret}
          >
            Insert placeholder
          </button>
          <button type="button" onClick={() => setDocument(buildSampleDocument())}>Reset document</button>
          <button type="button" onClick={() => setShowJson((value) => !value)}>
            {showJson ? "Hide JSON" : "Show JSON"}
          </button>
          <button
            type="button"
            data-testid="locale-toggle"
            onClick={() => setLocale((value) => (value === "en" ? "pt-BR" : "en"))}
          >
            {locale === "en" ? "EN" : "PT-BR"}
          </button>
        </div>
      </header>
      <main className={showJson ? "demo__main demo__main--split" : "demo__main"}>
        <div className="demo__editor">
          <section className="demo__docket" aria-labelledby="interaction-docket-title">
            <div className="demo__docket-copy">
              <span className="demo__eyebrow">Interaction docket</span>
              <h2 id="interaction-docket-title">Select across the document</h2>
              <p>Drag from “Dos Fatos” into “First supporting fact”. Format, type, paste, cut, or delete—the change stays atomic and undoable.</p>
            </div>
            <ol className="demo__docket-steps">
              <li><span>Drag</span> across heading and text blocks</li>
              <li><span>Edit</span> with the toolbar or clipboard</li>
              <li><span>Undo</span> once to restore the range</li>
            </ol>
            <output className="demo__selection-status" aria-live="polite" data-testid="selection-status">
              <span aria-hidden>●</span> {selectionLabel}
            </output>
          </section>
          <DocumentEditor
            ref={captureEditor}
            plugins={[minutaPlugin, separatorPlugin]}
            value={document}
            onChange={setDocument}
            onCommit={() => setLastCommit(new Date().toLocaleTimeString())}
            commitIdleMs={1500}
            showHeadingNumbers
            locale={locale}
            onUploadImage={uploadImage}
            allowDroppedImageUrls
            groupUploadedImages
            resolveImageSource={(block) =>
              block.source.type === "asset" ? assetUrls.current.get(block.source.id) : undefined
            }
            resolveImageContentSource={(entry) =>
              entry.source.type === "asset" ? assetUrls.current.get(entry.source.id) : undefined
            }
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
