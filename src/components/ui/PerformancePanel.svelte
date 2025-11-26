<script lang="ts">
import { onDestroy, onMount } from "svelte";
import type { PixiRenderer } from "../../lib/renderer/PixiRenderer";
import type { FileStatistics } from "../../types/gds";

interface Props {
	renderer: PixiRenderer | null;
	visible: boolean;
	statistics: FileStatistics | null;
}

// biome-ignore lint/correctness/noUnusedVariables: statistics is used in template
const { renderer, visible, statistics }: Props = $props();

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

{#if visible}
	<div class="performance-panel">
		<div class="panel-header">
			<h3>Performance & File Info</h3>
			<span class="hint">Press 'P' to toggle</span>
		</div>

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
	</div>
{/if}

<style>
	.performance-panel {
		position: fixed;
		top: 35px;
		right: 10px;
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
		z-index: 1000;
		backdrop-filter: blur(4px);
	}

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
	}

	h3 {
		margin: 0;
		font-size: 12px;
		font-weight: bold;
		color: #4a9eff;
	}

	.hint {
		font-size: 9px;
		color: #888;
	}

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

