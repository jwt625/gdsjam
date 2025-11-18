<script lang="ts">
import { parseGDSII } from "../../lib/gds/GDSParser";
import { gdsStore } from "../../stores/gdsStore";

let _isDragging = false;
let fileInputElement: HTMLInputElement;

/**
 * Handle file selection
 */
async function handleFile(file: File) {
	console.log("[FileUpload] handleFile called with:", file.name, file.size, "bytes");

	if (!file.name.toLowerCase().endsWith(".gds") && !file.name.toLowerCase().endsWith(".gdsii")) {
		console.warn("[FileUpload] Invalid file extension");
		gdsStore.setError("Please select a valid GDSII file (.gds or .gdsii)");
		return;
	}

	try {
		console.log("[FileUpload] Starting file load...");
		gdsStore.setLoading(true, "Reading file...", 0);

		// Read file
		console.log("[FileUpload] Reading file as ArrayBuffer...");
		const arrayBuffer = await file.arrayBuffer();
		console.log("[FileUpload] File read complete, size:", arrayBuffer.byteLength);

		// Parse GDSII
		gdsStore.updateProgress(50, "Parsing GDSII file...");
		console.log("[FileUpload] Calling parseGDSII...");
		const document = await parseGDSII(arrayBuffer);
		console.log("[FileUpload] Parsing complete, document:", document);

		// Update store
		gdsStore.updateProgress(100, "Complete!");
		console.log("[FileUpload] Setting document in store...");
		gdsStore.setDocument(document, file.name);
		console.log("[FileUpload] File load complete!");
	} catch (error) {
		console.error("[FileUpload] Failed to load GDSII file:", error);
		gdsStore.setError(
			`Failed to load file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Handle file input change
 */
function _handleFileInput(event: Event) {
	const target = event.target as HTMLInputElement;
	const file = target.files?.[0];
	if (file) {
		handleFile(file);
	}
}

/**
 * Handle drag over
 */
function _handleDragOver(event: DragEvent) {
	event.preventDefault();
	_isDragging = true;
}

/**
 * Handle drag leave
 */
function _handleDragLeave() {
	_isDragging = false;
}

/**
 * Handle drop
 */
function _handleDrop(event: DragEvent) {
	event.preventDefault();
	_isDragging = false;

	const file = event.dataTransfer?.files[0];
	if (file) {
		handleFile(file);
	}
}

/**
 * Trigger file input click
 */
function _triggerFileInput() {
	fileInputElement.click();
}
</script>

<div
	class="file-upload"
	class:dragging={isDragging}
	on:dragover={handleDragOver}
	on:dragleave={handleDragLeave}
	on:drop={handleDrop}
	role="button"
	tabindex="0"
	on:click={triggerFileInput}
	on:keydown={(e) => e.key === 'Enter' && triggerFileInput()}
>
	<input
		type="file"
		accept=".gds,.gdsii"
		bind:this={fileInputElement}
		on:change={handleFileInput}
		style="display: none;"
	/>

	<div class="upload-content">
		<svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
			/>
		</svg>
		<p class="upload-text">Drop GDSII file here or click to browse</p>
		<p class="upload-hint">Supports .gds and .gdsii files</p>
	</div>
</div>

<style>
	.file-upload {
		border: 2px dashed #444;
		border-radius: 8px;
		padding: 2rem;
		text-align: center;
		cursor: pointer;
		transition: all 0.2s ease;
		background-color: #1a1a1a;
	}

	.file-upload:hover {
		border-color: #666;
		background-color: #222;
	}

	.file-upload.dragging {
		border-color: #4a9eff;
		background-color: #1a2a3a;
	}

	.upload-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.upload-icon {
		width: 48px;
		height: 48px;
		color: #888;
	}

	.upload-text {
		margin: 0;
		font-size: 1rem;
		color: #ccc;
	}

	.upload-hint {
		margin: 0;
		font-size: 0.875rem;
		color: #666;
	}
</style>

