<script lang="ts">
import { gdsStore } from "../../stores/gdsStore";
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
	// Update gdsStore first (source of truth for document state)
	gdsStore.toggleLayerVisibility(key);

	// Then update layerStore (UI state) to match
	layerStore.toggleLayer(key);

	// Get the updated visibility from gdsStore (source of truth)
	const updatedVisibility = getVisibilityFromGdsStore();
	console.log("[LayerPanel] Toggled layer", key, "visibility:", updatedVisibility);
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
			detail: { visibility, syncEnabled },
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
						gdsStore.setAllLayersVisibility(true);
						layerStore.showAll();
						const updatedVisibility = getVisibilityFromGdsStore();
						onLayerVisibilityChange(updatedVisibility);
					}}
				>
					Show All
				</button>
				<button
					onclick={() => {
						gdsStore.setAllLayersVisibility(false);
						layerStore.hideAll();
						const updatedVisibility = getVisibilityFromGdsStore();
						onLayerVisibilityChange(updatedVisibility);
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
					<div class="layer-color" style="background-color: {getLayerColor(layerStat.layer, layerStat.datatype)}"></div>
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
		top: 10px;
		right: 10px;
		width: 280px;
		max-height: 80vh;
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

