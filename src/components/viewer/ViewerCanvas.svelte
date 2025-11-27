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
import MobileControls from "../ui/MobileControls.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import PerformancePanel from "../ui/PerformancePanel.svelte";

let canvas: HTMLCanvasElement;
let renderer = $state<PixiRenderer | null>(null);
let lastRenderedDocument: GDSDocument | null = null;
let panelsVisible = $state(false);
let layerPanelVisible = $state(false);
let layerStoreInitialized = false;

onMount(() => {
	if (DEBUG) console.log("[ViewerCanvas] Initializing...");

	// Initialize renderer asynchronously
	if (canvas) {
		(async () => {
			const newRenderer = new PixiRenderer();
			await newRenderer.init(canvas);

			// Set renderer AFTER init completes so $effect sees it as ready
			renderer = newRenderer;

			if (DEBUG) console.log("[ViewerCanvas] Renderer initialized and ready");

			// If document was loaded before renderer was ready, render it now
			if ($gdsStore.document) {
				if (DEBUG) console.log("[ViewerCanvas] Document was waiting, rendering now");
				lastRenderedDocument = $gdsStore.document;
				gdsStore.setRendering(true, "Rendering...", 0);
				await newRenderer.renderGDSDocument($gdsStore.document, (progress, message) => {
					gdsStore.setRendering(true, message, progress);
					if (progress >= 100) {
						setTimeout(() => gdsStore.setRendering(false), 500);
					}
				});
			} else {
				if (DEBUG) console.log("[ViewerCanvas] No document to render yet");
			}
		})();
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
// React to both document changes AND renderer becoming ready
$effect(() => {
	const gdsDocument = $gdsStore.document;
	const rendererReady = renderer?.isReady() ?? false;

	if (DEBUG && gdsDocument && !rendererReady) {
		console.log("[ViewerCanvas] Document ready but renderer not initialized yet");
	}

	if (rendererReady && renderer && gdsDocument && gdsDocument !== lastRenderedDocument) {
		if (DEBUG) {
			console.log("[ViewerCanvas] Rendering document:", gdsDocument.name);
		}
		lastRenderedDocument = gdsDocument;
		// Reset layer store initialization flag when new document is loaded
		layerStoreInitialized = false;
		gdsStore.setRendering(true, "Rendering...", 0);

		// Capture renderer reference for async callback
		const currentRenderer = renderer;
		(async () => {
			await currentRenderer.renderGDSDocument(gdsDocument, (progress, message) => {
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
	<MobileControls
		{renderer}
		onTogglePerformance={() => { panelsVisible = !panelsVisible; }}
		onToggleLayers={() => { layerPanelVisible = !layerPanelVisible; }}
		performanceVisible={panelsVisible}
		layersVisible={layerPanelVisible}
	/>
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

