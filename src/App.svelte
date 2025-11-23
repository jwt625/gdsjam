<script lang="ts">
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import FileUpload from "./components/ui/FileUpload.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import ViewerCanvas from "./components/viewer/ViewerCanvas.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in template via $gdsStore
import { gdsStore } from "./stores/gdsStore";
</script>

<main class="app-main">
	<div class="header">
		<h1 class="title">GDSJam</h1>
		<p class="subtitle">Collaborative GDSII Viewer</p>
		{#if $gdsStore.fileName}
			<p class="file-name">Loaded: {$gdsStore.fileName}</p>
		{/if}
	</div>

	<div class="viewer-wrapper">
		{#if !$gdsStore.document && !$gdsStore.isLoading}
			<div class="upload-overlay">
				<FileUpload />
			</div>
		{:else if $gdsStore.isLoading || $gdsStore.isRendering}
			<div class="loading-overlay">
				<div class="loading-content">
					<div class="spinner"></div>
					<p class="loading-message">{$gdsStore.loadingMessage}</p>
					<div class="progress-bar">
						<div class="progress-fill" style="width: {$gdsStore.loadingProgress}%"></div>
					</div>
					<p class="progress-text">{Math.round($gdsStore.loadingProgress)}%</p>
				</div>
			</div>
		{/if}

		{#if $gdsStore.document}
			<ViewerCanvas />
		{/if}

		{#if $gdsStore.error}
			<div class="error-overlay">
				<div class="error-content">
					<p class="error-title">Error</p>
					<p class="error-message">{$gdsStore.error}</p>
					<button class="error-button" on:click={() => gdsStore.clearError()}>
						Dismiss
					</button>
				</div>
			</div>
		{/if}
	</div>

	<div class="controls-info">
		<p class="text-sm text-gray-400">
			Controls: Mouse wheel to zoom | Middle mouse or Space+Drag to pan | Arrow keys to move | Enter to zoom in | Shift+Enter to zoom out | F to fit view | O to toggle fill/outline | P to toggle info panel | L to toggle layer panel | Touch: One finger to pan, two fingers to zoom
		</p>
	</div>
</main>

<style>
	.app-main {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		background-color: #1a1a1a;
	}

	.header {
		padding: 1rem 1.5rem;
		background-color: #0f0f0f;
		border-bottom: 1px solid #333;
	}

	.title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
		color: #fff;
	}

	.subtitle {
		margin: 0.25rem 0 0 0;
		font-size: 0.875rem;
		color: #888;
	}

	.file-name {
		margin: 0.5rem 0 0 0;
		font-size: 0.875rem;
		color: #4a9eff;
		font-weight: 500;
	}

	.viewer-wrapper {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.upload-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background-color: #1a1a1a;
	}

	.loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: rgba(26, 26, 26, 0.95);
		z-index: 100;
	}

	.loading-content {
		text-align: center;
		max-width: 400px;
	}

	.spinner {
		width: 48px;
		height: 48px;
		border: 4px solid #333;
		border-top-color: #4a9eff;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin: 0 auto 1rem;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-message {
		margin: 0 0 1rem 0;
		font-size: 1rem;
		color: #ccc;
	}

	.progress-bar {
		width: 100%;
		height: 8px;
		background-color: #333;
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.progress-fill {
		height: 100%;
		background-color: #4a9eff;
		transition: width 0.1s linear;
	}

	.progress-text {
		margin: 0;
		font-size: 0.875rem;
		color: #888;
	}

	.error-overlay {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 200;
	}

	.error-content {
		background-color: #3a1a1a;
		border: 1px solid #ff4444;
		border-radius: 8px;
		padding: 1rem 1.5rem;
		max-width: 400px;
	}

	.error-title {
		margin: 0 0 0.5rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #ff6666;
	}

	.error-message {
		margin: 0 0 1rem 0;
		font-size: 0.875rem;
		color: #ffaaaa;
	}

	.error-button {
		background-color: #ff4444;
		color: #fff;
		border: none;
		border-radius: 4px;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.error-button:hover {
		background-color: #ff6666;
	}

	.controls-info {
		padding: 0.5rem 1.5rem;
		background-color: #0f0f0f;
		border-top: 1px solid #333;
	}
</style>
