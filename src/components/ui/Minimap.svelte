<script lang="ts">
import { onDestroy, onMount } from "svelte";
import type { ParticipantViewport } from "../../lib/collaboration/types";
import { DEBUG } from "../../lib/config";
import { MinimapRenderer } from "../../lib/renderer/MinimapRenderer";
import { layerStore } from "../../stores/layerStore";
import { getPanelZIndex, panelZIndexStore } from "../../stores/panelZIndexStore";
import type { BoundingBox, GDSDocument } from "../../types/gds";

interface Props {
	visible?: boolean;
	document: GDSDocument | null;
	viewportBounds: BoundingBox | null;
	participantViewports?: ParticipantViewport[];
	onNavigate?: (worldX: number, worldY: number, scale?: number) => void;
}

const {
	visible = true,
	document,
	viewportBounds,
	participantViewports = [],
	onNavigate,
}: Props = $props();

// Z-index for this panel
const zIndex = getPanelZIndex("minimap");

// Panel state
let isCollapsed = $state(false);
let panelPosition = $state({ x: -1, y: -1 }); // -1 means use default (bottom-right)
let panelSize = $state({ width: 200, height: 150 }); // Default 30% will be calculated on mount
let isDragging = $state(false);
let isResizing = $state(false);
let dragStart = $state({ x: 0, y: 0 });
let resizeStart = $state({ width: 0, height: 0, x: 0, y: 0 });

// Canvas and renderer
let canvasElement: HTMLCanvasElement | null = $state(null);
let minimapRenderer: MinimapRenderer | null = $state(null);
// Cached colors from initial document load (not reactive to layer store changes)
let cachedColors: Map<string, number> = new Map();

// Constants
const MIN_SIZE = 100;
const MAX_SIZE = 800; // 2x larger limit
const STORAGE_KEY = "minimap-state";

// Load saved state from localStorage
function loadState() {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			const state = JSON.parse(saved);
			if (state.position) panelPosition = state.position;
			if (state.size) panelSize = state.size;
			if (state.collapsed !== undefined) isCollapsed = state.collapsed;
		}
	} catch (e) {
		if (DEBUG) console.warn("[Minimap] Failed to load state:", e);
	}
}

// Save state to localStorage
function saveState() {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				position: panelPosition,
				size: panelSize,
				collapsed: isCollapsed,
			}),
		);
	} catch (e) {
		if (DEBUG) console.warn("[Minimap] Failed to save state:", e);
	}
}

// Initialize default position (bottom-right, 30% of canvas)
function initDefaultPosition() {
	if (panelPosition.x === -1 || panelPosition.y === -1) {
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// 30% of smaller dimension
		const defaultSize = Math.min(viewportWidth, viewportHeight) * 0.3;
		panelSize = {
			width: Math.min(Math.max(defaultSize, MIN_SIZE), MAX_SIZE),
			height: Math.min(Math.max(defaultSize * 0.75, MIN_SIZE), MAX_SIZE),
		};

		// Position at bottom-right with 10px margin
		panelPosition = {
			x: viewportWidth - panelSize.width - 10,
			y: viewportHeight - panelSize.height - 60, // Account for header
		};
	}
}

// Constrain panel position to be within viewport bounds
function constrainPosition() {
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;

	// Calculate effective panel size
	const effectiveWidth = isCollapsed ? 100 : panelSize.width;

	// Constrain position
	let newX = panelPosition.x;
	let newY = panelPosition.y;

	// Ensure at least part of the panel is visible
	const minVisiblePx = 50;

	if (newX + effectiveWidth < minVisiblePx) {
		newX = minVisiblePx - effectiveWidth;
	}
	if (newX > viewportWidth - minVisiblePx) {
		newX = viewportWidth - minVisiblePx;
	}
	if (newY < 0) {
		newY = 0;
	}
	if (newY > viewportHeight - minVisiblePx) {
		newY = viewportHeight - minVisiblePx;
	}

	if (newX !== panelPosition.x || newY !== panelPosition.y) {
		panelPosition = { x: newX, y: newY };
		saveState();
	}
}

// Handle window resize
function handleWindowResize() {
	constrainPosition();
}

// Drag handlers (mouse)
function handleHeaderMouseDown(e: MouseEvent) {
	e.preventDefault();
	startDrag(e.clientX, e.clientY);
}

// Drag handlers (touch)
function handleHeaderTouchStart(e: TouchEvent) {
	e.preventDefault();
	const touch = e.touches[0];
	if (touch) {
		startDrag(touch.clientX, touch.clientY);
	}
}

function startDrag(clientX: number, clientY: number) {
	isDragging = true;
	dragStart = { x: clientX - panelPosition.x, y: clientY - panelPosition.y };
	window.addEventListener("mousemove", handlePointerMove);
	window.addEventListener("mouseup", handlePointerUp);
	window.addEventListener("touchmove", handleTouchMove, { passive: false });
	window.addEventListener("touchend", handlePointerUp);
}

function handlePointerMove(e: MouseEvent) {
	if (isDragging) {
		panelPosition = {
			x: e.clientX - dragStart.x,
			y: e.clientY - dragStart.y,
		};
	} else if (isResizing) {
		const dx = e.clientX - resizeStart.x;
		const dy = e.clientY - resizeStart.y;
		panelSize = {
			width: Math.min(Math.max(resizeStart.width + dx, MIN_SIZE), MAX_SIZE),
			height: Math.min(Math.max(resizeStart.height + dy, MIN_SIZE), MAX_SIZE),
		};
	}
}

function handleTouchMove(e: TouchEvent) {
	e.preventDefault();
	const touch = e.touches[0];
	if (!touch) return;

	if (isDragging) {
		panelPosition = {
			x: touch.clientX - dragStart.x,
			y: touch.clientY - dragStart.y,
		};
	} else if (isResizing) {
		const dx = touch.clientX - resizeStart.x;
		const dy = touch.clientY - resizeStart.y;
		panelSize = {
			width: Math.min(Math.max(resizeStart.width + dx, MIN_SIZE), MAX_SIZE),
			height: Math.min(Math.max(resizeStart.height + dy, MIN_SIZE), MAX_SIZE),
		};
	}
}

function handlePointerUp() {
	isDragging = false;
	isResizing = false;
	window.removeEventListener("mousemove", handlePointerMove);
	window.removeEventListener("mouseup", handlePointerUp);
	window.removeEventListener("touchmove", handleTouchMove);
	window.removeEventListener("touchend", handlePointerUp);
	constrainPosition();
	saveState();
}

// Resize handle (mouse)
function handleResizeMouseDown(e: MouseEvent) {
	e.preventDefault();
	e.stopPropagation();
	startResize(e.clientX, e.clientY);
}

// Resize handle (touch)
function handleResizeTouchStart(e: TouchEvent) {
	e.preventDefault();
	e.stopPropagation();
	const touch = e.touches[0];
	if (touch) {
		startResize(touch.clientX, touch.clientY);
	}
}

function startResize(clientX: number, clientY: number) {
	isResizing = true;
	resizeStart = { width: panelSize.width, height: panelSize.height, x: clientX, y: clientY };
	window.addEventListener("mousemove", handlePointerMove);
	window.addEventListener("mouseup", handlePointerUp);
	window.addEventListener("touchmove", handleTouchMove, { passive: false });
	window.addEventListener("touchend", handlePointerUp);
}

// Toggle collapse
function toggleCollapse() {
	isCollapsed = !isCollapsed;
	saveState();
}

// Initialize renderer
async function initRenderer() {
	if (!canvasElement || minimapRenderer) return;

	const newRenderer = new MinimapRenderer();
	await newRenderer.init(canvasElement);
	newRenderer.setOnNavigate((worldX, worldY, scale) => {
		onNavigate?.(worldX, worldY, scale);
	});

	// Resize to match current panel size
	newRenderer.resize(panelSize.width, panelSize.height);

	// Assign to reactive state AFTER setup is complete
	minimapRenderer = newRenderer;

	// Render if document is available
	if (document) {
		await renderMinimap();
	}

	// Update viewport outline with current bounds
	if (viewportBounds) {
		minimapRenderer.updateViewportOutline(viewportBounds);
	}

	// Update participant viewports if available
	if (participantViewports.length > 0) {
		minimapRenderer.updateParticipantViewports(participantViewports);
	}
}

// Render minimap
// Note: Layer visibility and color sync is DISABLED for performance optimization.
// Minimap always shows all layers visible with colors cached at document load.
async function renderMinimap() {
	if (!minimapRenderer || !document) {
		if (DEBUG) console.log("[Minimap] Skipping render - no renderer or document");
		return;
	}

	// Pass empty visibility map - all layers default to visible
	const visibility = new Map<string, boolean>();

	if (DEBUG) console.log("[Minimap] Rendering with all layers visible, using cached colors");

	await minimapRenderer.render(document, visibility, cachedColors);
}

// Update viewport outline (this is cheap, runs on every viewport change)
$effect(() => {
	// Read viewportBounds at top level to ensure it's tracked as dependency
	const bounds = viewportBounds;

	if (DEBUG) {
		console.log("[Minimap] Viewport effect:", {
			hasRenderer: !!minimapRenderer,
			hasViewportBounds: !!bounds,
			viewportBounds: bounds,
		});
	}
	if (minimapRenderer && bounds) {
		minimapRenderer.updateViewportOutline(bounds);
	}
});

// Track document identity for re-render
let lastDocumentName: string | null = null;

// Layer visibility sync is DISABLED for minimap (performance optimization)
// Minimap always shows all layers visible and doesn't re-render on layer changes
// $effect(() => {
// 	const version = $layerStore.updateVersion;
// 	if (version !== lastLayerVersion && minimapRenderer && document) {
// 		lastLayerVersion = version;
// 		renderMinimap();
// 	}
// });

// Re-render on document change (only when document actually changes)
$effect(() => {
	const docName = document?.name ?? null;
	if (docName !== lastDocumentName && document && minimapRenderer) {
		lastDocumentName = docName;
		// Cache colors at document load time (not reactive to subsequent layer changes)
		cachedColors = layerStore.getColorsMap($layerStore);
		renderMinimap();
	}
});

// Update participant viewports when they change
$effect(() => {
	// Read participantViewports at top level to track as dependency
	const viewports = participantViewports;
	if (minimapRenderer && viewports) {
		minimapRenderer.updateParticipantViewports(viewports);
	}
});

// Resize renderer when panel size changes
// Read panelSize at top level to ensure Svelte tracks it as a dependency
$effect(() => {
	const width = panelSize.width;
	const height = panelSize.height;
	const collapsed = isCollapsed;

	if (minimapRenderer && !collapsed) {
		minimapRenderer.resize(width, height);
		// Re-render after resize to update layout scaling
		if (document) {
			renderMinimap();
		}
	}
});

// Initialize canvas when element is bound
$effect(() => {
	if (canvasElement && !minimapRenderer) {
		initRenderer();
	}
});

onMount(() => {
	loadState();
	initDefaultPosition();
	window.addEventListener("resize", handleWindowResize);
});

onDestroy(() => {
	window.removeEventListener("resize", handleWindowResize);
	minimapRenderer?.destroy();
	minimapRenderer = null;
});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="minimap-panel"
	class:collapsed={isCollapsed}
	style="left: {panelPosition.x}px; top: {panelPosition.y}px; z-index: {$zIndex}; display: {visible ? 'block' : 'none'};"
	onmousedown={() => panelZIndexStore.bringToFront("minimap")}
	ontouchstart={() => panelZIndexStore.bringToFront("minimap")}
>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="panel-header"
			onmousedown={handleHeaderMouseDown}
			ontouchstart={handleHeaderTouchStart}
			role="button"
			tabindex="0"
		>
			<h3>Minimap</h3>
			<button class="collapse-btn" onclick={toggleCollapse}>
				{isCollapsed ? "▼" : "▲"}
			</button>
		</div>

		<div class="minimap-content" style="width: {panelSize.width}px; height: {panelSize.height}px; display: {isCollapsed ? 'none' : 'block'};">
			<canvas
				bind:this={canvasElement}
				width={panelSize.width}
				height={panelSize.height}
			></canvas>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="resize-handle"
			style="display: {isCollapsed ? 'none' : 'block'};"
			onmousedown={handleResizeMouseDown}
			ontouchstart={handleResizeTouchStart}
		></div>
	</div>

<style>
	.minimap-panel {
		position: fixed;
		background: rgba(0, 0, 0, 0.9);
		border-radius: 4px;
		font-family: monospace;
		font-size: 12px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
		user-select: none;
		color: #ccc;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 10px;
		cursor: move;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.panel-header h3 {
		margin: 0;
		font-size: 12px;
		font-weight: normal;
	}

	.collapse-btn {
		background: none;
		border: none;
		color: #ccc;
		cursor: pointer;
		padding: 0 4px;
		font-size: 10px;
	}

	.collapse-btn:hover {
		color: #fff;
	}

	.minimap-content {
		position: relative;
		overflow: hidden;
	}

	.minimap-content canvas {
		display: block;
		border-radius: 0 0 4px 4px;
	}

	.resize-handle {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 16px;
		height: 16px;
		cursor: se-resize;
		background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.3) 50%);
		border-radius: 0 0 4px 0;
	}

	.minimap-panel.collapsed {
		width: auto;
	}
</style>

