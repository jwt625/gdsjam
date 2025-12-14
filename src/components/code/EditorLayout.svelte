<script lang="ts">
/**
 * EditorLayout - Responsive layout for code editor
 *
 * Desktop: Split-panel layout (editor left, viewer/console right) with resizable divider
 * Mobile: Three-tab layout (Code / Viewer / Console)
 *
 * Features:
 * - Instant transitions (no animations)
 * - Resizable split panel on desktop
 * - Tab switching on mobile
 * - Execute button with rate limit countdown
 * - Example script selector
 * - Python file upload
 * - Clear code functionality
 */

import { onMount } from "svelte";
import { loadExampleScript } from "../../lib/code/exampleScripts";
import type { ExampleScript } from "../../lib/code/types";
import { editorStore } from "../../stores/editorStore";
import CodeConsole from "./CodeConsole.svelte";
import CodeEditor from "./CodeEditor.svelte";
import ConfirmModal from "./ConfirmModal.svelte";
import ExampleSelector from "./ExampleSelector.svelte";

// Module-specific debug flag (false by default in production)
const DEBUG_EDITOR_LAYOUT = import.meta.env.VITE_DEBUG_EDITOR_LAYOUT === "true";

interface Props {
	onExecute: () => void;
	onClose: () => void;
}

const { onExecute, onClose }: Props = $props();

// File upload
let fileInputElement: HTMLInputElement;

// Mobile breakpoint
const MOBILE_BREAKPOINT = 1024;
let isMobile = $state(false);

// Split panel state (desktop only)
let splitPosition = $state(50); // percentage
let isDragging = $state(false);

// Mobile tab state
type MobileTab = "code" | "viewer" | "console";
let mobileActiveTab = $state<MobileTab>("code");
let desktopActiveTab = $derived($editorStore.activeTab);

// Execution state
const isExecuting = $derived($editorStore.isExecuting);
const rateLimitCountdown = $derived($editorStore.rateLimitCountdown);
const consoleOutput = $derived($editorStore.consoleOutput);
const executionError = $derived($editorStore.executionError);

// Check if mobile on mount and resize
function checkMobile() {
	isMobile = window.innerWidth < MOBILE_BREAKPOINT;
}

$effect(() => {
	checkMobile();
	window.addEventListener("resize", checkMobile);
	return () => window.removeEventListener("resize", checkMobile);
});

// Handle split panel dragging (desktop only)
function handleMouseDown(event: MouseEvent) {
	if (isMobile) return;
	isDragging = true;
	event.preventDefault();
}

function handleMouseMove(event: MouseEvent) {
	if (!isDragging || isMobile) return;
	const containerWidth = window.innerWidth;
	const newPosition = (event.clientX / containerWidth) * 100;
	splitPosition = Math.max(30, Math.min(70, newPosition)); // Clamp between 30-70%
}

function handleMouseUp() {
	isDragging = false;
	// Trigger ViewerCanvas resize after dragging stops
	triggerViewerResize();
}

// Trigger ViewerCanvas resize by dispatching a custom event
function triggerViewerResize() {
	// Wait for DOM to update, then find ViewerCanvas and trigger resize
	requestAnimationFrame(() => {
		const viewerContainer = document.querySelector(".viewer-container");
		if (viewerContainer) {
			// Dispatch a custom event that ViewerCanvas can listen to
			const resizeEvent = new CustomEvent("viewer-resize");
			viewerContainer.dispatchEvent(resizeEvent);
		}
	});
}

$effect(() => {
	if (isDragging) {
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}
});

// Tab switching
function switchMobileTab(tab: MobileTab) {
	mobileActiveTab = tab;
}

function switchDesktopTab(tab: "viewer" | "console") {
	editorStore.switchTab(tab);
}

// Execute button handler
function handleExecute() {
	if (isExecuting || rateLimitCountdown > 0) return;
	onExecute();
}

// Confirmation modal state
let confirmModalVisible = $state(false);
let confirmModalMessage = $state("");
let confirmModalAction: (() => void) | null = $state(null);

function showConfirmModal(message: string, action: () => void) {
	confirmModalMessage = message;
	confirmModalAction = action;
	confirmModalVisible = true;
}

function handleConfirm() {
	if (confirmModalAction) {
		confirmModalAction();
	}
	confirmModalVisible = false;
	confirmModalAction = null;
}

function handleCancel() {
	confirmModalVisible = false;
	confirmModalAction = null;
}

// Track current example ID
let currentExampleId = $state<string | null>("tunable-optical-processor");

// Update current example ID when code changes
$effect(() => {
	const code = $editorStore.code;
	// Try to detect which example is loaded based on content
	// This is a simple heuristic - could be improved
	if (code.includes("Tunable Optical Processor")) {
		currentExampleId = "tunable-optical-processor";
	} else if (code.includes("PIC Component Showcase")) {
		currentExampleId = "pic-component-showcase";
	} else if (!code) {
		currentExampleId = null;
	}
});

// Example selector handler
function handleExampleSelect(example: ExampleScript) {
	const currentCode = $editorStore.code;

	// If there's existing code, confirm before loading
	if (currentCode && currentCode.trim().length > 0) {
		showConfirmModal(`Load "${example.name}"? This will replace your current code.`, () => {
			loadExample(example);
		});
	} else {
		loadExample(example);
	}
}

function loadExample(example: ExampleScript) {
	try {
		const code = loadExampleScript(example.id);
		if (DEBUG_EDITOR_LAYOUT)
			console.log(`[EditorLayout] Loading example "${example.name}", code length: ${code.length}`);
		editorStore.setCode(code);
		currentExampleId = example.id;
		if (DEBUG_EDITOR_LAYOUT)
			console.log(`[EditorLayout] Example loaded, currentExampleId: ${currentExampleId}`);
	} catch (error) {
		if (DEBUG_EDITOR_LAYOUT) console.error("Failed to load example:", error);
		editorStore.setExecutionError(
			`Failed to load example: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

// File upload handler
function triggerFileUpload() {
	fileInputElement.click();
}

async function handleFileUpload(event: Event) {
	const target = event.target as HTMLInputElement;
	const file = target.files?.[0];
	if (!file) return;

	// Validate file type
	if (!file.name.endsWith(".py")) {
		editorStore.setExecutionError("Please upload a Python (.py) file");
		return;
	}

	try {
		const text = await file.text();

		// If there's existing code, confirm before loading
		const currentCode = $editorStore.code;
		if (currentCode && currentCode.trim().length > 0) {
			showConfirmModal(`Load "${file.name}"? This will replace your current code.`, () => {
				editorStore.setCode(text);
				currentExampleId = null; // Not an example anymore
			});
		} else {
			editorStore.setCode(text);
			currentExampleId = null;
		}
	} catch (error) {
		if (DEBUG_EDITOR_LAYOUT) console.error("Failed to read file:", error);
		editorStore.setExecutionError(
			`Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		// Reset file input
		target.value = "";
	}
}

// Clear code handler
function handleClearCode() {
	showConfirmModal("Clear all code? This cannot be undone.", () => {
		if (DEBUG_EDITOR_LAYOUT) console.log("[EditorLayout] Clearing code");
		editorStore.setCode("");
		currentExampleId = null;
		if (DEBUG_EDITOR_LAYOUT) console.log("[EditorLayout] Code cleared");
	});
}

// Move ViewerCanvas and CodeEditor into editor layout containers
let originalViewerParent: HTMLElement | null = null;
let viewerCanvas: HTMLElement | null = null;
let codeEditorContainer: HTMLElement | null = null;

onMount(() => {
	// Find the ViewerCanvas element
	viewerCanvas = document.querySelector(".viewer-container") as HTMLElement;
	if (viewerCanvas) {
		// Store original parent for restoration
		originalViewerParent = viewerCanvas.parentElement;

		// Move ViewerCanvas into the appropriate container (desktop or mobile)
		const targetContainer = isMobile
			? document.getElementById("editor-viewer-container-mobile")
			: document.getElementById("editor-viewer-container");

		if (targetContainer) {
			targetContainer.appendChild(viewerCanvas);
		}
	}

	// Find the CodeEditor container
	codeEditorContainer = document.getElementById("code-editor-container");
	if (codeEditorContainer) {
		// Move CodeEditor into the appropriate container (desktop or mobile)
		const targetContainer = isMobile
			? document.getElementById("code-panel-mobile")
			: document.getElementById("code-panel-desktop");

		if (targetContainer) {
			// Show the editor and move it
			codeEditorContainer.style.display = "block";
			targetContainer.appendChild(codeEditorContainer);
		}
	}

	return () => {
		// Restore ViewerCanvas to original parent on unmount
		if (viewerCanvas && originalViewerParent) {
			originalViewerParent.appendChild(viewerCanvas);
		}
	};
});

// Re-position ViewerCanvas and CodeEditor when switching between mobile/desktop
$effect(() => {
	if (!viewerCanvas) return;

	const targetContainer = isMobile
		? document.getElementById("editor-viewer-container-mobile")
		: document.getElementById("editor-viewer-container");

	if (targetContainer && viewerCanvas.parentElement !== targetContainer) {
		targetContainer.appendChild(viewerCanvas);
	}
});

$effect(() => {
	if (!codeEditorContainer) return;

	const targetContainer = isMobile
		? document.getElementById("code-panel-mobile")
		: document.getElementById("code-panel-desktop");

	if (targetContainer && codeEditorContainer.parentElement !== targetContainer) {
		targetContainer.appendChild(codeEditorContainer);
	}
});

// Execute button label
const executeButtonLabel = $derived(
	isExecuting
		? "Executing..."
		: rateLimitCountdown > 0
			? `Wait ${rateLimitCountdown}s`
			: "Run Code (Ctrl+Enter)",
);
</script>

<!-- Hidden file input for Python file upload -->
<input
	type="file"
	accept=".py"
	bind:this={fileInputElement}
	onchange={handleFileUpload}
	style="display: none;"
/>

<div class="editor-layout" class:mobile={isMobile}>
	<!-- Header with Execute and Close buttons -->
	<div class="editor-header">
		<div class="header-left">
			<h2 class="editor-title">Python Code Editor</h2>
			<div class="example-controls">
				<ExampleSelector currentExampleId={currentExampleId} onSelect={handleExampleSelect} />
				<button class="icon-button" onclick={triggerFileUpload} type="button" title="Upload Python file">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M9 1H4C3.46957 1 2.96086 1.21071 2.58579 1.58579C2.21071 1.96086 2 2.46957 2 3V13C2 13.5304 2.21071 14.0391 2.58579 14.4142C2.96086 14.7893 3.46957 15 4 15H12C12.5304 15 13.0391 14.7893 13.4142 14.4142C13.7893 14.0391 14 13.5304 14 13V6L9 1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M9 1V6H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M8 8.5V12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M6 10.5L8 8.5L10 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
				<button class="icon-button" onclick={handleClearCode} type="button" title="Clear code">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M2 4H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M12.6667 4V13.3333C12.6667 14 12 14.6667 11.3333 14.6667H4.66667C4 14.6667 3.33333 14 3.33333 13.3333V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M5.33333 4V2.66667C5.33333 2 6 1.33333 6.66667 1.33333H9.33333C10 1.33333 10.6667 2 10.6667 2.66667V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M6.66667 7.33333V11.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M9.33333 7.33333V11.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
			</div>
		</div>
		<div class="header-actions">
			<button
				class="execute-button"
				onclick={handleExecute}
				disabled={isExecuting || rateLimitCountdown > 0}
				type="button"
			>
				{executeButtonLabel}
			</button>
			<button class="close-button" onclick={onClose} type="button">✕</button>
		</div>
	</div>

	<!-- Single CodeEditor instance (repositioned based on mobile/desktop) -->
	<div id="code-editor-container" style="display: none;">
		<CodeEditor {onExecute} />
	</div>

	{#if isMobile}
		<!-- Mobile: Three-tab layout -->
		<div class="mobile-tabs">
			<button
				class="tab-button"
				class:active={mobileActiveTab === "code"}
				onclick={() => switchMobileTab("code")}
				type="button"
			>
				Code
			</button>
			<button
				class="tab-button"
				class:active={mobileActiveTab === "viewer"}
				onclick={() => switchMobileTab("viewer")}
				type="button"
			>
				Viewer
			</button>
			<button
				class="tab-button"
				class:active={mobileActiveTab === "console"}
				onclick={() => switchMobileTab("console")}
				type="button"
			>
				Console
			</button>
		</div>

		<div class="mobile-content">
			<!-- Keep all panels in DOM, toggle visibility with CSS -->
			<div class="code-panel" id="code-panel-mobile" class:hidden={mobileActiveTab !== "code"}>
				<!-- CodeEditor will be positioned here via JavaScript -->
			</div>
			<div class="viewer-panel" id="editor-viewer-container-mobile" class:hidden={mobileActiveTab !== "viewer"}>
				<!-- ViewerCanvas will be positioned here via JavaScript -->
			</div>
			<div class="console-panel" class:hidden={mobileActiveTab !== "console"}>
				<CodeConsole stdout={consoleOutput} error={executionError} />
			</div>
		</div>
	{:else}
		<!-- Desktop: Split-panel layout -->
		<div class="split-container">
			<div class="left-panel" id="code-panel-desktop" style="width: {splitPosition}%">
				<!-- CodeEditor will be positioned here via JavaScript -->
			</div>

			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="divider" role="separator" onmousedown={handleMouseDown}></div>

			<div class="right-panel" style="width: {100 - splitPosition}%">
				<!-- Right panel tabs -->
				<div class="desktop-tabs">
					<button
						class="tab-button"
						class:active={desktopActiveTab === "viewer"}
						onclick={() => switchDesktopTab("viewer")}
						type="button"
					>
						Viewer
					</button>
					<button
						class="tab-button"
						class:active={desktopActiveTab === "console"}
						onclick={() => switchDesktopTab("console")}
						type="button"
					>
						Console
					</button>
				</div>

				<div class="desktop-content">
					<!-- Keep both panels in DOM, toggle visibility with CSS -->
					<div class="viewer-panel" id="editor-viewer-container" class:hidden={desktopActiveTab !== "viewer"}>
						<!-- ViewerCanvas will be positioned here via JavaScript -->
					</div>
					<div class="console-panel" class:hidden={desktopActiveTab !== "console"}>
						<CodeConsole stdout={consoleOutput} error={executionError} />
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- Confirmation Modal -->
{#if confirmModalVisible}
	<ConfirmModal
		message={confirmModalMessage}
		onConfirm={handleConfirm}
		onCancel={handleCancel}
	/>
{/if}

<style>
.editor-layout {
	display: flex;
	flex-direction: column;
	height: 100vh;
	width: 100vw;
	background: #1e1e1e;
	color: #d4d4d4;
}

.editor-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 12px 16px;
	background: #252526;
	border-bottom: 1px solid #3e3e42;
	flex-wrap: wrap;
	gap: 8px;
}

.header-left {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
}

.editor-title {
	margin: 0;
	font-size: 16px;
	font-weight: 600;
	color: #cccccc;
}

.example-controls {
	display: flex;
	align-items: center;
	gap: 8px;
}

.icon-button {
	padding: 6px 10px;
	background: transparent;
	border: 1px solid #3e3e42;
	border-radius: 3px;
	font-size: 16px;
	cursor: pointer;
	transition: background-color 0.1s;
	line-height: 1;
}

.icon-button:hover {
	background: #2a2d2e;
	border-color: #4e4e52;
}

.icon-button:active {
	transform: translateY(1px);
}

.header-actions {
	display: flex;
	gap: 12px;
}

.execute-button {
	padding: 8px 16px;
	background: #0e639c;
	color: white;
	border: none;
	border-radius: 3px;
	cursor: pointer;
	font-size: 13px;
	font-weight: 500;
	transition: background 0.1s;
}

.execute-button:hover:not(:disabled) {
	background: #1177bb;
}

.execute-button:disabled {
	background: #3e3e42;
	color: #858585;
	cursor: not-allowed;
}

.close-button {
	padding: 8px 12px;
	background: #3e3e42;
	color: #cccccc;
	border: none;
	border-radius: 3px;
	cursor: pointer;
	font-size: 16px;
	line-height: 1;
	transition: background 0.1s;
}

.close-button:hover {
	background: #505050;
}

/* Split panel (desktop) */
.split-container {
	display: flex;
	flex: 1;
	overflow: hidden;
}

.left-panel,
.right-panel {
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.divider {
	width: 4px;
	background: #3e3e42;
	cursor: col-resize;
	transition: background 0.1s;
}

.divider:hover {
	background: #505050;
}

/* Desktop tabs */
.desktop-tabs {
	display: flex;
	gap: 4px;
	padding: 8px 12px;
	background: #252526;
	border-bottom: 1px solid #3e3e42;
}

.desktop-content {
	flex: 1;
	overflow: hidden;
}

/* Mobile tabs */
.mobile-tabs {
	display: flex;
	gap: 4px;
	padding: 8px 12px;
	background: #252526;
	border-bottom: 1px solid #3e3e42;
}

.mobile-content {
	flex: 1;
	overflow: hidden;
}

.tab-button {
	padding: 8px 16px;
	background: transparent;
	color: #cccccc;
	border: none;
	border-radius: 3px;
	cursor: pointer;
	font-size: 13px;
	transition: background 0.1s;
}

.tab-button:hover {
	background: #3e3e42;
}

.tab-button.active {
	background: #0e639c;
	color: white;
}

.code-panel,
.viewer-panel,
.console-panel {
	height: 100%;
	overflow: hidden;
}

.viewer-panel {
	position: relative;
}

/* Ensure ViewerCanvas fills the viewer panel */
.viewer-panel :global(.viewer-container) {
	width: 100% !important;
	height: 100% !important;
}

/* Ensure CodeEditor container fills its parent */
:global(#code-editor-container) {
	width: 100%;
	height: 100%;
}

/* Hide panels when not active (keep in DOM for ViewerCanvas) */
.hidden {
	display: none !important;
}
</style>
