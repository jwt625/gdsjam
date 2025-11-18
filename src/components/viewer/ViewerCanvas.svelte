<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { PixiRenderer } from "../../lib/renderer/PixiRenderer";

let canvas: HTMLCanvasElement;
let renderer: PixiRenderer | null = null;

onMount(async () => {
	console.log("[ViewerCanvas] onMount called");
	if (canvas) {
		console.log("[ViewerCanvas] Initializing renderer...");
		renderer = new PixiRenderer(canvas);
		await renderer.init(canvas);
		console.log("[ViewerCanvas] Renderer initialized");

		// If there's already a document loaded, render it
		if ($gdsStore.document) {
			console.log("[ViewerCanvas] Document already loaded, rendering...");
			renderer.renderGDSDocument($gdsStore.document);
		} else {
			// Otherwise render test geometry for prototyping
			console.log("[ViewerCanvas] No document, rendering test geometry");
			renderer.renderTestGeometry(1000); // 1K polygons for initial test
		}
	}
});

onDestroy(() => {
	console.log("[ViewerCanvas] onDestroy called");
	renderer?.destroy();
});

// Subscribe to GDS store and render when document changes
$: if (renderer && $gdsStore.document) {
	console.log("[ViewerCanvas] Reactive: Document changed, rendering...");
	console.log("[ViewerCanvas] Document:", $gdsStore.document);
	renderer.renderGDSDocument($gdsStore.document);
}
</script>

<div class="viewer-container">
	<canvas bind:this={canvas} class="viewer-canvas"></canvas>
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

