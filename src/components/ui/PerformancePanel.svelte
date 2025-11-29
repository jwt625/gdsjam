<script lang="ts">
import { onDestroy, onMount } from "svelte";
import type { PixiRenderer } from "../../lib/renderer/PixiRenderer";
import { getPanelZIndex, panelZIndexStore } from "../../stores/panelZIndexStore";
import type { FileStatistics } from "../../types/gds";

interface Props {
	renderer: PixiRenderer | null;
	visible: boolean;
	statistics: FileStatistics | null;
}

// biome-ignore lint/correctness/noUnusedVariables: statistics is used in template
const { renderer, visible, statistics }: Props = $props();

const zIndex = getPanelZIndex("performance");
const STORAGE_KEY = "performance-panel-state";

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
		panelPosition = { x: window.innerWidth - 300, y: 35 };
	}
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

// biome-ignore lint/correctness/noUnusedVariables: metrics is used in template
let metrics = $state({
	fps: 0,
	visiblePolygons: 0,
	totalPolygons: 0,
	polygonBudget: 0,
	budgetUtilization: 0,
	currentDepth: 0,
	zoomLevel: 1.0,
	zoomThresholdLow: 0.2,
	zoomThresholdHigh: 2.0,
	viewportBounds: {
		minX: 0,
		minY: 0,
		maxX: 0,
		maxY: 0,
		width: 0,
		height: 0,
	},
});

// Update metrics periodically (every 500ms) instead of reactively
let updateInterval: number | null = null;

onMount(() => {
	loadState();
	initDefaultPosition();
	updateInterval = window.setInterval(() => {
		if (renderer && visible) {
			metrics = renderer.getPerformanceMetrics();
		}
	}, 500);
});

onDestroy(() => {
	if (updateInterval !== null) {
		clearInterval(updateInterval);
	}
});

// Format numbers with commas
// biome-ignore lint/correctness/noUnusedVariables: formatNumber is used in template
function formatNumber(num: number): string {
	return num.toLocaleString();
}

// Format percentage
// biome-ignore lint/correctness/noUnusedVariables: formatPercent is used in template
function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

// Format zoom level with adaptive decimal places
// biome-ignore lint/correctness/noUnusedVariables: formatZoom is used in template
function formatZoom(zoom: number): string {
	// Use more decimal places for very small zoom values
	if (zoom < 0.01) {
		return `${zoom.toFixed(4)}x`;
	}
	if (zoom < 0.1) {
		return `${zoom.toFixed(3)}x`;
	}
	return `${zoom.toFixed(2)}x`;
}

// Format file size
// biome-ignore lint/correctness/noUnusedVariables: formatFileSize is used in template
function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Format time
// biome-ignore lint/correctness/noUnusedVariables: formatTime is used in template
function formatTime(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)} ms`;
	return `${(ms / 1000).toFixed(2)} s`;
}

// Format dimensions
// biome-ignore lint/correctness/noUnusedVariables: formatDimension is used in template
function formatDimension(um: number): string {
	if (um < 1000) return `${um.toFixed(1)} µm`;
	if (um < 1000000) return `${(um / 1000).toFixed(2)} mm`;
	return `${(um / 1000000).toFixed(2)} m`;
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if visible}
	<div
		class="performance-panel"
		class:collapsed={isCollapsed}
		class:dragging={isDragging}
		style="left: {panelPosition.x}px; top: {panelPosition.y}px; z-index: {$zIndex};"
		onmousedown={() => panelZIndexStore.bringToFront("performance")}
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
			<h3>Performance & File Info</h3>
			<svg class="chevron-icon" class:rotated={isCollapsed} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</div>

		{#if !isCollapsed}
		<!-- Performance Metrics Section -->
		<div class="section-title">Performance</div>
		<div class="metrics-grid">
			<div class="metric">
				<span class="label">FPS:</span>
				<span class="value" class:warning={metrics.fps < 30} class:good={metrics.fps >= 30}>
					{metrics.fps}
				</span>
			</div>

			<div class="metric">
				<span class="label">Visible Polygons:</span>
				<span class="value">{formatNumber(metrics.visiblePolygons)}</span>
			</div>

			<div class="metric">
				<span class="label">Total Polygons:</span>
				<span class="value">{formatNumber(metrics.totalPolygons)}</span>
			</div>

			<div class="metric">
				<span class="label">Polygon Budget:</span>
				<span class="value">{formatNumber(metrics.polygonBudget)}</span>
			</div>

			<div class="metric">
				<span class="label">Budget Usage:</span>
				<span
					class="value"
					class:warning={metrics.budgetUtilization > 0.9}
					class:good={metrics.budgetUtilization < 0.3}
				>
					{formatPercent(metrics.budgetUtilization)}
				</span>
			</div>

			<div class="metric">
				<span class="label">LOD Depth:</span>
				<span class="value">{metrics.currentDepth}</span>
			</div>

			<div class="metric">
				<span class="label">Zoom Level:</span>
				<span class="value">{formatZoom(metrics.zoomLevel)}</span>
			</div>

			<div class="metric">
				<span class="label">Next LOD:</span>
				<span class="value zoom-thresholds">
					{formatZoom(metrics.zoomThresholdLow)} / {formatZoom(metrics.zoomThresholdHigh)}
				</span>
			</div>

			<div class="metric viewport-info">
				<span class="label">Viewport Size:</span>
				<span class="value viewport-bounds">
					{formatNumber(Math.round(metrics.viewportBounds.width))} × {formatNumber(
						Math.round(metrics.viewportBounds.height),
					)} db units
				</span>
			</div>

			<div class="metric viewport-coords">
				<span class="label">Viewport Min:</span>
				<span class="value viewport-bounds">
					({formatNumber(Math.round(metrics.viewportBounds.minX))}, {formatNumber(
						Math.round(metrics.viewportBounds.minY),
					)})
				</span>
			</div>

			<div class="metric viewport-coords">
				<span class="label">Viewport Max:</span>
				<span class="value viewport-bounds">
					({formatNumber(Math.round(metrics.viewportBounds.maxX))}, {formatNumber(
						Math.round(metrics.viewportBounds.maxY),
					)})
				</span>
			</div>
		</div>

		<!-- File Statistics Section -->
		{#if statistics}
			<div class="section-title">File Statistics</div>
			<div class="metrics-grid">
				<div class="metric">
					<span class="label">File:</span>
					<span class="value filename" title={statistics.fileName}>{statistics.fileName}</span>
				</div>

				<div class="metric">
					<span class="label">Size:</span>
					<span class="value">{formatFileSize(statistics.fileSizeBytes)}</span>
				</div>

				<div class="metric">
					<span class="label">Parse Time:</span>
					<span class="value">{formatTime(statistics.parseTimeMs)}</span>
				</div>

				<div class="metric">
					<span class="label">Total Cells:</span>
					<span class="value">{formatNumber(statistics.totalCells)}</span>
				</div>

				<div class="metric">
					<span class="label">Top Cells:</span>
					<span class="value">{formatNumber(statistics.topCellCount)}</span>
				</div>

				<div class="metric">
					<span class="label">Total Polygons:</span>
					<span class="value">{formatNumber(statistics.totalPolygons)}</span>
				</div>

				<div class="metric">
					<span class="label">Total Instances:</span>
					<span class="value">{formatNumber(statistics.totalInstances)}</span>
				</div>

				<div class="metric">
					<span class="label">Layers:</span>
					<span class="value">{formatNumber(statistics.layerStats.size)}</span>
				</div>

				<div class="metric">
					<span class="label">Layout Size:</span>
					<span class="value">
						{formatDimension(statistics.layoutWidth)} × {formatDimension(statistics.layoutHeight)}
					</span>
				</div>
			</div>
		{/if}
		{/if}
	</div>
{/if}

<style>
	.performance-panel {
		position: fixed;
		background: rgba(0, 0, 0, 0.85);
		border: 1px solid #444;
		border-radius: 4px;
		padding: 12px;
		font-family: monospace;
		font-size: 11px;
		color: #fff;
		min-width: 280px;
		max-height: calc(100vh - 50px);
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		backdrop-filter: blur(4px);
		user-select: none;
	}

	.performance-panel.collapsed { max-height: 50px; overflow: hidden; }
	.performance-panel.dragging { cursor: grabbing; opacity: 0.9; }

	/* Mobile responsive adjustments */
	@media (max-width: 1023px) {
		.performance-panel {
			max-height: calc(100vh - 100px);
			max-width: calc(100vw - 20px);
			font-size: 10px;
		}
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
		padding-bottom: 8px;
		border-bottom: 1px solid #444;
		cursor: grab;
	}

	.performance-panel.dragging .panel-header { cursor: grabbing; }
	.panel-header:hover { background: rgba(255, 255, 255, 0.05); }

	h3 {
		margin: 0;
		font-size: 12px;
		font-weight: bold;
		color: #4a9eff;
	}

	.chevron-icon {
		width: 16px;
		height: 16px;
		color: #888;
		transition: transform 0.2s ease-out;
		flex-shrink: 0;
	}
	.chevron-icon.rotated { transform: rotate(-90deg); }

	.metrics-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 6px;
	}

	.metric {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.label {
		color: #aaa;
	}

	.value {
		color: #fff;
		font-weight: bold;
	}

	.value.good {
		color: #4ade80;
	}

	.value.warning {
		color: #fbbf24;
	}

	.zoom-thresholds {
		font-size: 10px;
	}

	.section-title {
		margin-top: 12px;
		margin-bottom: 6px;
		padding-top: 8px;
		border-top: 1px solid #444;
		font-size: 11px;
		font-weight: bold;
		color: #888;
		text-transform: uppercase;
	}

	.filename {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 180px;
	}
</style>

