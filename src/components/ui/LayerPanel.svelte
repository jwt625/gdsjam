<script lang="ts">
import { layerStore } from "../../stores/layerStore";
import type { FileStatistics } from "../../types/gds";

interface Props {
	statistics: FileStatistics | null;
	visible?: boolean;
}

const { statistics, visible = true }: Props = $props();

const storeState = $derived($layerStore);
const layerVisibility = $derived(storeState.visibility);
const syncEnabled = $derived(storeState.syncEnabled);

function toggleLayer(key: string) {
	layerStore.toggleLayer(key);
	onLayerVisibilityChange();
}

function onLayerVisibilityChange() {
	// Notify renderer to update visibility
	window.dispatchEvent(
		new CustomEvent("layer-visibility-changed", {
			detail: { visibility: layerVisibility, syncEnabled },
		}),
	);

	// If sync enabled, broadcast to Y.js (Week 2 - collaboration)
	if (syncEnabled) {
		// TODO: Sync with Y.js shared state
		console.log("[LayerPanel] Sync enabled - would broadcast to Y.js");
	}
}

function toggleSyncMode() {
	layerStore.toggleSync();
	console.log(`[LayerPanel] Layer sync ${!syncEnabled ? "enabled" : "disabled"}`);
}

function getLayerColor(layer: number): string {
	// Simple color mapping using golden angle for good distribution
	const hue = (layer * 137.5) % 360;
	return `hsl(${hue}, 70%, 50%)`;
}
</script>

{#if visible && statistics}
	<div class="layer-panel">
		<div class="panel-header">
			<h3>Layers ({statistics.layerStats.size})</h3>

			<div class="sync-toggle">
				<label>
					<input type="checkbox" checked={syncEnabled} onchange={toggleSyncMode} />
					<span class="sync-label">Sync with others</span>
				</label>
			</div>

			<div class="bulk-actions">
				<button
					onclick={() => {
						layerStore.showAll();
						onLayerVisibilityChange();
					}}
				>
					Show All
				</button>
				<button
					onclick={() => {
						layerStore.hideAll();
						onLayerVisibilityChange();
					}}
				>
					Hide All
				</button>
			</div>
		</div>

		<div class="layer-list">
			{#each Array.from(statistics.layerStats.entries()).sort((a, b) => a[1].layer - b[1].layer) as [key, layerStat]}
				<div class="layer-item">
					<input type="checkbox" checked={layerVisibility[key] ?? true} onchange={() => toggleLayer(key)} />
					<div class="layer-color" style="background-color: {getLayerColor(layerStat.layer)}"></div>
					<span class="layer-name">{layerStat.layer}:{layerStat.datatype}</span>
					<span class="layer-count">{layerStat.polygonCount.toLocaleString()}</span>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.layer-panel {
		position: fixed;
		bottom: 10px;
		left: 10px;
		width: 280px;
		max-height: 500px;
		background: rgba(0, 0, 0, 0.9);
		color: #ccc;
		border-radius: 4px;
		font-family: monospace;
		font-size: 12px;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
	}

	.panel-header {
		padding: 12px;
		border-bottom: 1px solid #444;
	}

	h3 {
		margin: 0 0 8px 0;
		font-size: 14px;
		color: #fff;
	}

	.sync-toggle {
		margin-bottom: 8px;
		padding: 6px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 3px;
	}

	.sync-toggle label {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}

	.sync-label {
		font-size: 11px;
		color: #aaa;
	}

	.sync-toggle input[type="checkbox"]:checked + .sync-label {
		color: #4a9eff;
	}

	.bulk-actions {
		display: flex;
		gap: 8px;
	}

	.bulk-actions button {
		flex: 1;
		padding: 4px 8px;
		background: #333;
		color: #ccc;
		border: 1px solid #555;
		border-radius: 3px;
		cursor: pointer;
		font-size: 11px;
	}

	.bulk-actions button:hover {
		background: #444;
		border-color: #666;
	}

	.layer-list {
		overflow-y: auto;
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
	}

	.layer-item:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.layer-color {
		width: 16px;
		height: 16px;
		border-radius: 2px;
		border: 1px solid #666;
		flex-shrink: 0;
	}

	.layer-name {
		flex: 1;
		color: #aaa;
	}

	.layer-count {
		color: #0f0;
		font-size: 11px;
	}

	input[type="checkbox"] {
		cursor: pointer;
	}
</style>

