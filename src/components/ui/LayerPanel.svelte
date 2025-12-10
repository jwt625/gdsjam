<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { collaborationStore } from "../../stores/collaborationStore";
import { gdsStore } from "../../stores/gdsStore";
import { layerStore } from "../../stores/layerStore";
import { getPanelZIndex, panelZIndexStore } from "../../stores/panelZIndexStore";
import type { FileStatistics } from "../../types/gds";

interface Props {
	statistics: FileStatistics | null;
	visible?: boolean;
}

const { statistics, visible = true }: Props = $props();

const zIndex = getPanelZIndex("layers");
const STORAGE_KEY = "layer-panel-state";

// Panel state
let isCollapsed = $state(false);
let panelPosition = $state({ x: -1, y: -1 });
let isDragging = $state(false);
let dragStart = $state({ x: 0, y: 0 });
let mouseDownTime = $state(0);
let mouseDownPos = $state({ x: 0, y: 0 });
const CLICK_THRESHOLD_MS = 200;
const DRAG_THRESHOLD_PX = 5;

function loadState() {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			const state = JSON.parse(saved);
			if (state.position) panelPosition = state.position;
			if (state.collapsed !== undefined) isCollapsed = state.collapsed;
		}
	} catch (_e) {
		/* ignore */
	}
}

function saveState() {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ position: panelPosition, collapsed: isCollapsed }),
		);
	} catch (_e) {
		/* ignore */
	}
}

function initDefaultPosition() {
	if (panelPosition.x === -1 || panelPosition.y === -1) {
		panelPosition = { x: window.innerWidth - 290, y: 150 };
	}
}

// Constrain panel position to be within viewport bounds
function constrainPosition() {
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;

	// Panel width is 280px (from CSS)
	const panelWidth = 280;

	// Constrain position
	let newX = panelPosition.x;
	let newY = panelPosition.y;

	// Ensure at least part of the panel is visible
	const minVisiblePx = 50;

	if (newX + panelWidth < minVisiblePx) {
		newX = minVisiblePx - panelWidth;
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

// Drag handlers
function handlePointerStart(clientX: number, clientY: number) {
	mouseDownTime = Date.now();
	mouseDownPos = { x: clientX, y: clientY };
	dragStart = { x: clientX - panelPosition.x, y: clientY - panelPosition.y };
}

function handlePointerMove(clientX: number, clientY: number) {
	const dx = Math.abs(clientX - mouseDownPos.x);
	const dy = Math.abs(clientY - mouseDownPos.y);
	if (!isDragging && (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX)) isDragging = true;
	if (isDragging) panelPosition = { x: clientX - dragStart.x, y: clientY - dragStart.y };
}

function handlePointerEnd(clientX: number, clientY: number) {
	const elapsed = Date.now() - mouseDownTime;
	const dx = Math.abs(clientX - mouseDownPos.x);
	const dy = Math.abs(clientY - mouseDownPos.y);
	if (elapsed < CLICK_THRESHOLD_MS && dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) {
		isCollapsed = !isCollapsed;
	}
	isDragging = false;
	saveState();
}

function handleHeaderMouseDown(e: MouseEvent) {
	handlePointerStart(e.clientX, e.clientY);
	window.addEventListener("mousemove", handleMouseMove);
	window.addEventListener("mouseup", handleMouseUp);
}
function handleMouseMove(e: MouseEvent) {
	handlePointerMove(e.clientX, e.clientY);
}
function handleMouseUp(e: MouseEvent) {
	window.removeEventListener("mousemove", handleMouseMove);
	window.removeEventListener("mouseup", handleMouseUp);
	handlePointerEnd(e.clientX, e.clientY);
}

function handleHeaderTouchStart(e: TouchEvent) {
	if (e.touches.length !== 1) return;
	e.preventDefault();
	const touch = e.touches[0]!;
	handlePointerStart(touch.clientX, touch.clientY);
	window.addEventListener("touchmove", handleTouchMove, { passive: false });
	window.addEventListener("touchend", handleTouchEnd);
	window.addEventListener("touchcancel", handleTouchEnd);
}
function handleTouchMove(e: TouchEvent) {
	if (e.touches.length !== 1) return;
	e.preventDefault();
	handlePointerMove(e.touches[0]!.clientX, e.touches[0]!.clientY);
}
function handleTouchEnd(e: TouchEvent) {
	e.preventDefault();
	window.removeEventListener("touchmove", handleTouchMove);
	window.removeEventListener("touchend", handleTouchEnd);
	window.removeEventListener("touchcancel", handleTouchEnd);
	handlePointerEnd(e.changedTouches[0]!.clientX, e.changedTouches[0]!.clientY);
}

onMount(() => {
	loadState();
	initDefaultPosition();
	window.addEventListener("resize", handleWindowResize);
});

onDestroy(() => {
	window.removeEventListener("resize", handleWindowResize);
});

const storeState = $derived($layerStore);
const layerVisibility = $derived(storeState.visibility);
const isInSession = $derived($collaborationStore.isInSession);
const isHost = $derived($collaborationStore.isHost);
const isLayerBroadcasting = $derived($collaborationStore.isLayerBroadcasting);
const isLayerFollowing = $derived($collaborationStore.isLayerFollowing);

// Compute if all layers are visible (for consolidated button)
const allLayersVisible = $derived(() => {
	if (!statistics) return true;
	for (const key of statistics.layerStats.keys()) {
		if (!(layerVisibility[key] ?? true)) return false;
	}
	return true;
});

function toggleLayer(key: string) {
	// Update gdsStore first (source of truth for document state)
	gdsStore.toggleLayerVisibility(key);

	// Then update layerStore (UI state) to match
	layerStore.toggleLayer(key);

	// Get the updated visibility from gdsStore (source of truth)
	const updatedVisibility = getVisibilityFromGdsStore();
	onLayerVisibilityChange(updatedVisibility);
}

function getVisibilityFromGdsStore(): { [key: string]: boolean } {
	const visibility: { [key: string]: boolean } = {};
	const doc = $gdsStore.document;
	if (doc) {
		for (const [key, layer] of doc.layers) {
			visibility[key] = layer.visible;
		}
	}
	return visibility;
}

function onLayerVisibilityChange(visibility: { [key: string]: boolean }) {
	// Notify renderer to update visibility
	window.dispatchEvent(
		new CustomEvent("layer-visibility-changed", {
			detail: { visibility },
		}),
	);

	// Broadcast to Y.js if host and broadcasting layers
	if (isInSession && isHost && isLayerBroadcasting) {
		const sessionManager = collaborationStore.getSessionManager();
		sessionManager?.broadcastLayerVisibility(visibility);
	}
}

function handleBroadcastToggle() {
	collaborationStore.toggleLayerBroadcast();
}

function handleFollowToggle() {
	collaborationStore.toggleLayerFollowing();
}

function getLayerColor(layer: number, datatype: number): string {
	// Use same color mapping as GDSParser for consistency
	const hue = (layer * 137 + datatype * 53) % 360;
	const saturation = 70;
	const lightness = 60;

	// Convert HSL to hex (same as GDSParser)
	const h = hue / 360;
	const s = saturation / 100;
	const l = lightness / 100;

	const hue2rgb = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};

	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
	const g = Math.round(hue2rgb(p, q, h) * 255);
	const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if visible && statistics}
	<div
		class="layer-panel"
		class:collapsed={isCollapsed}
		class:dragging={isDragging}
		style="left: {panelPosition.x}px; top: {panelPosition.y}px; z-index: {$zIndex};"
		onmousedown={() => panelZIndexStore.bringToFront("layers")}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="panel-header"
			onmousedown={handleHeaderMouseDown}
			ontouchstart={handleHeaderTouchStart}
			role="button"
			tabindex="0"
			aria-expanded={!isCollapsed}
		>
			<h3>Layers ({statistics.layerStats.size})</h3>
			<svg class="chevron-icon" class:rotated={isCollapsed} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</div>

		{#if !isCollapsed}
			{#if isInSession}
				<div class="layer-sync-controls">
					{#if isHost}
						<label class="sync-toggle">
							<input type="checkbox" checked={isLayerBroadcasting} onchange={handleBroadcastToggle} />
							<span class="toggle-label">Broadcast layers</span>
						</label>
					{:else}
						<label class="sync-toggle">
							<input type="checkbox" checked={isLayerFollowing} onchange={handleFollowToggle} />
							<span class="toggle-label">Follow host</span>
						</label>
					{/if}
				</div>
			{/if}

			<div class="bulk-actions">
				<button
					onclick={() => {
						const showAll = !allLayersVisible();
						gdsStore.setAllLayersVisibility(showAll);
						if (showAll) layerStore.showAll(); else layerStore.hideAll();
						onLayerVisibilityChange(getVisibilityFromGdsStore());
					}}
				>
					{allLayersVisible() ? "Hide All" : "Show All"}
				</button>
			</div>

			<div class="layer-list">
				{#each Array.from(statistics.layerStats.entries()).sort((a, b) => a[1].layer - b[1].layer) as [key, layerStat]}
					<div
						class="layer-item"
						role="button"
						tabindex="0"
						onclick={() => toggleLayer(key)}
						onkeydown={(e) => {
							if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); toggleLayer(key); }
							else if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); (e.currentTarget.nextElementSibling as HTMLElement)?.focus(); }
							else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); (e.currentTarget.previousElementSibling as HTMLElement)?.focus(); }
						}}
					>
						<input type="checkbox" checked={layerVisibility[key] ?? true} tabindex="-1" onclick={(e) => e.stopPropagation()} onchange={() => toggleLayer(key)} />
						<div class="layer-color" style="background-color: {getLayerColor(layerStat.layer, layerStat.datatype)}"></div>
						<span class="layer-name">{layerStat.layer}:{layerStat.datatype}</span>
						<span class="layer-count">{layerStat.polygonCount.toLocaleString()}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.layer-panel {
		position: fixed;
		width: 280px;
		max-height: 80vh;
		background: rgba(0, 0, 0, 0.9);
		color: #ccc;
		border-radius: 4px;
		font-family: monospace;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
		user-select: none;
	}

	.layer-panel.collapsed { max-height: 44px; }
	.layer-panel.dragging { cursor: grabbing; opacity: 0.9; }

	.panel-header {
		padding: 12px;
		border-bottom: 1px solid #444;
		display: flex;
		align-items: center;
		justify-content: space-between;
		cursor: grab;
	}

	.layer-panel.dragging .panel-header { cursor: grabbing; }
	.panel-header:hover { background: rgba(255, 255, 255, 0.05); }

	h3 { margin: 0; font-size: 14px; color: #fff; }

	.chevron-icon {
		width: 16px;
		height: 16px;
		color: #888;
		transition: transform 0.2s ease-out;
		flex-shrink: 0;
	}
	.chevron-icon.rotated { transform: rotate(-90deg); }

	.layer-sync-controls {
		padding: 8px 12px;
		background: rgba(255, 255, 255, 0.02);
		border-bottom: 1px solid #333;
	}

	.sync-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		user-select: none;
	}

	.sync-toggle input[type="checkbox"] {
		width: 14px;
		height: 14px;
		accent-color: #4a9eff;
		cursor: pointer;
	}

	.toggle-label { font-size: 11px; color: #aaa; }
	.sync-toggle:hover .toggle-label { color: #ddd; }

	.bulk-actions { padding: 8px 12px; border-bottom: 1px solid #333; }

	.bulk-actions button {
		width: 100%;
		padding: 4px 8px;
		background: #333;
		color: #ccc;
		border: 1px solid #555;
		border-radius: 3px;
		cursor: pointer;
		font-size: 11px;
	}

	.bulk-actions button:hover { background: #444; border-color: #666; }

	.layer-list {
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		padding: 8px;
		flex: 1;
	}

	.layer-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px;
		margin: 2px 0;
		border-radius: 3px;
		cursor: pointer;
	}

	.layer-item:hover { background: rgba(255, 255, 255, 0.05); }

	.layer-color {
		width: 16px;
		height: 16px;
		border-radius: 2px;
		border: 1px solid #666;
		flex-shrink: 0;
	}

	.layer-name { flex: 1; color: #aaa; }
	.layer-count { color: #0f0; font-size: 11px; }
	input[type="checkbox"] { cursor: pointer; }
</style>

