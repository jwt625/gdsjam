<script lang="ts">
/**
 * CodeEditor - Monaco Editor wrapper for Python code editing
 *
 * Features:
 * - Lazy loads Monaco Editor (~2MB bundle)
 * - Python syntax highlighting
 * - Auto-save to editorStore
 * - Ctrl/Cmd+Enter to execute code
 * - Dark theme matching app design
 */

import type * as Monaco from "monaco-editor";
import { onDestroy, onMount } from "svelte";
import { editorStore } from "../../stores/editorStore";

// Module-specific debug flag (false by default in production)
const DEBUG_CODE_EDITOR = import.meta.env.VITE_DEBUG_CODE_EDITOR === "true";

interface Props {
	onExecute?: () => void;
}

const { onExecute }: Props = $props();

let editorContainer: HTMLDivElement;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let monaco: typeof Monaco | null = null;

// Subscribe to code changes from store
const code = $derived($editorStore.code);

onMount(async () => {
	try {
		// Configure Monaco environment BEFORE importing
		// Set up proper web workers for Monaco Editor using dynamic imports
		// @ts-ignore - Monaco environment configuration
		(self as any).MonacoEnvironment = {
			getWorker(_: any, label: string) {
				// Use dynamic imports with Vite's special syntax for workers
				if (label === "json") {
					return new Worker(
						new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
						{ type: "module" },
					);
				}
				if (label === "css" || label === "scss" || label === "less") {
					return new Worker(
						new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
						{ type: "module" },
					);
				}
				if (label === "html" || label === "handlebars" || label === "razor") {
					return new Worker(
						new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
						{ type: "module" },
					);
				}
				if (label === "typescript" || label === "javascript") {
					return new Worker(
						new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
						{ type: "module" },
					);
				}
				return new Worker(
					new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
					{ type: "module" },
				);
			},
		};

		// Lazy load Monaco Editor
		monaco = await import("monaco-editor");

		// Create a simple model without language features to avoid worker errors
		const model = monaco.editor.createModel(code, "python");

		// Create editor instance with ALL advanced features disabled
		editor = monaco.editor.create(editorContainer, {
			model: model,
			theme: "vs-dark",
			automaticLayout: true,
			fontSize: 14,
			lineNumbers: "on",
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			wordWrap: "on",
			tabSize: 4,
			insertSpaces: false, // Use tabs (Python convention)
			// Disable ALL features that might use workers
			colorDecorators: false,
			links: false,
			occurrencesHighlight: "off",
			selectionHighlight: false,
			folding: false,
			foldingHighlight: false,
			foldingImportsByDefault: false,
			unfoldOnClickAfterEndOfLine: false,
			// Disable language features
			quickSuggestions: false,
			suggestOnTriggerCharacters: false,
			acceptSuggestionOnCommitCharacter: false,
			acceptSuggestionOnEnter: "off",
			snippetSuggestions: "none",
			wordBasedSuggestions: "off",
			parameterHints: { enabled: false },
			hover: { enabled: false },
			// Keep basic syntax highlighting but disable semantic tokens
			"semanticHighlighting.enabled": false,
		});

		// Listen for content changes and update store
		editor.onDidChangeModelContent(() => {
			const newCode = editor?.getValue() || "";
			editorStore.setCode(newCode);
		});

		// Register Ctrl/Cmd+Enter keyboard shortcut for execution
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
			onExecute?.();
		});

		// Mark Monaco as loaded
		editorStore.setMonacoLoaded(true);
		if (DEBUG_CODE_EDITOR) {
			console.log(`[CodeEditor] Monaco Editor initialized successfully`);
		}
	} catch (error) {
		if (DEBUG_CODE_EDITOR) {
			console.error("[CodeEditor] Failed to load Monaco Editor:", error);
		}
	}
});

onDestroy(() => {
	// Dispose editor instance
	editor?.dispose();
	editorStore.setMonacoLoaded(false);
});

// Update editor value when store changes (e.g., loading example code)
$effect(() => {
	if (DEBUG_CODE_EDITOR) {
		console.log(
			`[CodeEditor] $effect triggered - editor exists: ${!!editor}, code length: ${code.length}, editor value length: ${editor?.getValue().length || 0}`,
		);
	}

	if (editor && code !== editor.getValue()) {
		if (DEBUG_CODE_EDITOR) {
			console.log(`[CodeEditor] Updating editor value from store, new code length: ${code.length}`);
		}
		const position = editor.getPosition();
		editor.setValue(code);
		if (position) {
			editor.setPosition(position);
		}
	} else if (!editor) {
		if (DEBUG_CODE_EDITOR) {
			console.log(`[CodeEditor] Cannot update - editor not initialized yet`);
		}
	}
});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="code-editor"
	bind:this={editorContainer}
	onkeydown={(e) => {
		// Stop propagation of all keyboard events when editor has focus
		// This prevents app-level shortcuts from interfering with editor
		e.stopPropagation();
	}}
></div>

<style>
.code-editor {
	width: 100%;
	height: 100%;
	min-height: 400px;
}
</style>

