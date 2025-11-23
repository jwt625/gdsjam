<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { DEBUG } from "../../lib/config";
import { PixiRenderer } from "../../lib/renderer/PixiRenderer";
import { gdsStore } from "../../stores/gdsStore";
import { layerStore } from "../../stores/layerStore";
import type { GDSDocument } from "../../types/gds";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import LayerPanel from "../ui/LayerPanel.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import PerformancePanel from "../ui/PerformancePanel.svelte";

let canvas: HTMLCanvasElement;
let renderer = $state<PixiRenderer | null>(null);
let lastRenderedDocument: GDSDocument | null = null;
let panelsVisible = $state(false);
let layerPanelVisible = $state(false);
let layerStoreInitialized = false;

onMount(async () => {
	if (DEBUG) console.log("[ViewerCanvas] Initializing...");
	if (canvas) {
		renderer = new PixiRenderer();
		await renderer.init(canvas);

		if ($gdsStore.document) {
			lastRenderedDocument = $gdsStore.document;
			gdsStore.setRendering(true, "Rendering...", 0);
			await renderer.renderGDSDocument($gdsStore.document, (progress, message) => {
				gdsStore.setRendering(true, message, progress);
				if (progress >= 100) {
					setTimeout(() => gdsStore.setRendering(false), 500);
				}
			});
		} else {
			if (DEBUG) console.log("[ViewerCanvas] Rendering test geometry");
			renderer.renderTestGeometry(1000);
		}
	}

	// Add keyboard event listeners
	const handleKeyPress = (e: KeyboardEvent) => {
		// 'P' key to toggle performance panels
		if (e.key === "p" || e.key === "P") {
			panelsVisible = !panelsVisible;
			if (DEBUG) console.log(`[ViewerCanvas] Panels ${panelsVisible ? "shown" : "hidden"}`);
		}

		// 'L' key to toggle layer panel
		if (e.key === "l" || e.key === "L") {
			layerPanelVisible = !layerPanelVisible;
			if (DEBUG)
				console.log(`[ViewerCanvas] Layer panel ${layerPanelVisible ? "shown" : "hidden"}`);
		}

		// 'O' key to toggle polygon fill mode (Outline)
		if (e.key === "o" || e.key === "O") {
			renderer?.toggleFill();
		}
	};

	window.addEventListener("keydown", handleKeyPress);

	return () => {
		window.removeEventListener("keydown", handleKeyPress);
	};
});

onDestroy(() => {
	if (DEBUG) console.log("[ViewerCanvas] Destroying renderer");
	renderer?.destroy();
});

// Subscribe to GDS store and render when document changes
// Only react to document changes, not other store properties
$effect(() => {
	const gdsDocument = $gdsStore.document;
	if (renderer?.isReady() && gdsDocument && gdsDocument !== lastRenderedDocument) {
		console.log("[ViewerCanvas] Rendering document:", gdsDocument.name);
		lastRenderedDocument = gdsDocument;
		// Reset layer store initialization flag when new document is loaded
		layerStoreInitialized = false;
		gdsStore.setRendering(true, "Rendering...", 0);
		(async () => {
			await renderer.renderGDSDocument(gdsDocument, (progress, message) => {
				gdsStore.setRendering(true, message, progress);
				if (progress >= 100) {
					setTimeout(() => gdsStore.setRendering(false), 500);
				}
			});
		})();
	}
});

// Initialize layer store when document is FIRST loaded (not on every update)
$effect(() => {
	const gdsDocument = $gdsStore.document;
	if (gdsDocument && !layerStoreInitialized) {
		layerStore.setLayers(gdsDocument.layers);
		layerStoreInitialized = true;
		if (DEBUG)
			console.log("[ViewerCanvas] Initialized layer store with", gdsDocument.layers.size, "layers");
	}
});
</script>

<div class="viewer-container">
	<canvas bind:this={canvas} class="viewer-canvas"></canvas>
	<PerformancePanel {renderer} statistics={$gdsStore.statistics} visible={panelsVisible} />
	<LayerPanel statistics={$gdsStore.statistics} visible={layerPanelVisible} />
</div>

<style>
	.viewer-container {
		width: 100%;
		height: 100%;
		position: relative;
		overflow: hidden;
	}

	.viewer-canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>

