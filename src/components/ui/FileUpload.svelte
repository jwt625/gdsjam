<script lang="ts">
import { DEBUG } from "../../lib/config";
import { loadGDSIIFromBuffer } from "../../lib/utils/gdsLoader";
import { collaborationStore } from "../../stores/collaborationStore";
import { gdsStore } from "../../stores/gdsStore";

// biome-ignore lint/correctness/noUnusedVariables: Used in Svelte class binding
let isDragging = false;
let fileInputElement: HTMLInputElement;

/**
 * Handle file selection
 */
async function handleFile(file: File) {
	const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
	if (DEBUG) {
		console.log(`[FileUpload] Loading ${file.name} (${fileSizeMB} MB)`);
	}

	try {
		gdsStore.setLoading(true, "Reading file...", 0);

		const arrayBuffer = await file.arrayBuffer();
		if (DEBUG) {
			console.log(`[FileUpload] File read complete: ${arrayBuffer.byteLength} bytes`);
		}

		// Load file locally first
		await loadGDSIIFromBuffer(arrayBuffer, file.name);

		// If in a session and is host, upload file to session
		if (DEBUG) {
			console.log("[FileUpload] Checking collaboration state:");
			console.log("  - isInSession:", $collaborationStore.isInSession);
			console.log("  - isHost:", $collaborationStore.isHost);
		}

		if ($collaborationStore.isInSession && $collaborationStore.isHost) {
			if (DEBUG) {
				console.log("[FileUpload] Uploading file to collaboration session...");
			}

			try {
				await collaborationStore.uploadFile(arrayBuffer, file.name);
				if (DEBUG) {
					console.log("[FileUpload] File uploaded to session successfully");
				}
			} catch (error) {
				console.error("[FileUpload] Failed to upload file to session:", error);
				gdsStore.setError(
					`File loaded locally but failed to upload to session: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} else if (DEBUG) {
			console.log("[FileUpload] Not uploading to session (not in session or not host)");
		}
	} catch (error) {
		console.error("[FileUpload] Failed to read file:", error);
		gdsStore.setError(
			`Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Handle file input change
 */
// biome-ignore lint/correctness/noUnusedVariables: Used in template
function handleFileInput(event: Event) {
	const target = event.target as HTMLInputElement;
	const file = target.files?.[0];
	if (file) {
		handleFile(file);
	}
}

/**
 * Handle drag over
 */
// biome-ignore lint/correctness/noUnusedVariables: Used in template
function handleDragOver(event: DragEvent) {
	event.preventDefault();
	isDragging = true;
}

/**
 * Handle drag leave
 */
// biome-ignore lint/correctness/noUnusedVariables: Used in template
function handleDragLeave() {
	isDragging = false;
}

/**
 * Handle drop
 */
// biome-ignore lint/correctness/noUnusedVariables: Used in template
function handleDrop(event: DragEvent) {
	event.preventDefault();
	isDragging = false;

	const file = event.dataTransfer?.files[0];
	if (file) {
		handleFile(file);
	}
}

/**
 * Trigger file input click
 */
// biome-ignore lint/correctness/noUnusedVariables: Used in template
function triggerFileInput() {
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
		accept=".gds,.gdsii,.dxf"
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
		<p class="upload-text">Drop GDSII or DXF file here or click to browse</p>
		<p class="upload-hint">Supports .gds, .gdsii, and .dxf files</p>
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
