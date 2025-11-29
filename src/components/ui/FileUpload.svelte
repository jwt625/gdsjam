<script lang="ts">
import { DEBUG } from "../../lib/config";
import { EXAMPLES, loadExample } from "../../lib/examples";
import type { Example } from "../../lib/examples";
import { loadGDSIIFromBuffer } from "../../lib/utils/gdsLoader";
import { collaborationStore } from "../../stores/collaborationStore";
import { gdsStore } from "../../stores/gdsStore";

// biome-ignore lint/correctness/noUnusedVariables: Used in Svelte class binding
let isDragging = $state(false);
let fileInputElement: HTMLInputElement;
let loadingExampleId: string | null = $state(null);

/**
 * Handle example click
 */
async function handleExampleClick(example: Example, event: Event) {
	event.stopPropagation();

	if (loadingExampleId) {
		return; // Already loading an example
	}

	if (DEBUG) {
		console.log(`[FileUpload] Loading example: ${example.name}`);
	}

	loadingExampleId = example.id;

	try {
		gdsStore.setLoading(true, `Loading ${example.name}...`, 0);

		await loadExample(example, (progress, message) => {
			gdsStore.updateProgress(progress, message);
		});

		if (DEBUG) {
			console.log(`[FileUpload] Example loaded: ${example.name}`);
		}
	} catch (error) {
		console.error("[FileUpload] Failed to load example:", error);
		gdsStore.setError(
			`Failed to load example: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		loadingExampleId = null;
	}
}

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
		} else if (!$collaborationStore.isInSession) {
			// Not in a session - upload as pending so it can be shared when session is created
			if (DEBUG) {
				console.log("[FileUpload] Uploading file as pending (for future session)...");
			}

			try {
				await collaborationStore.uploadFilePending(arrayBuffer, file.name);
				if (DEBUG) {
					console.log("[FileUpload] File uploaded as pending successfully");
				}
			} catch (error) {
				console.error("[FileUpload] Failed to upload pending file:", error);
				// Don't show error - file is loaded locally, just won't be shareable
				if (DEBUG) {
					console.log("[FileUpload] File loaded locally but not uploaded for sharing");
				}
			}
		} else if (DEBUG) {
			console.log("[FileUpload] Client in session - file loaded locally only");
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

{#if $collaborationStore.isInSession && !$collaborationStore.isHost}
	<!-- Client in session - show waiting message -->
	<div class="file-upload waiting">
		<div class="upload-content">
			<svg class="upload-icon waiting-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
				<circle cx="12" cy="12" r="10" stroke-width="2" />
				<path stroke-linecap="round" stroke-width="2" d="M12 6v6l4 2" />
			</svg>
			<p class="upload-text">Waiting for host to share a file...</p>
			<p class="upload-hint">You'll automatically receive the file when it's ready</p>
		</div>
	</div>
{:else}
	<!-- Normal file upload UI -->
	<div class="file-upload-container">
		<div
			class="file-upload"
			class:dragging={isDragging}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			role="button"
			tabindex="0"
			onclick={triggerFileInput}
			onkeydown={(e) => e.key === 'Enter' && triggerFileInput()}
		>
			<input
				type="file"
				accept=".gds,.gdsii,.dxf"
				bind:this={fileInputElement}
				onchange={handleFileInput}
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

		<!-- Examples section -->
		<div class="examples-section">
			<h3 class="examples-title">Or try an example:</h3>
			<div class="examples-grid">
				{#each EXAMPLES as example (example.id)}
					<button
						class="example-card"
						class:loading={loadingExampleId === example.id}
						disabled={loadingExampleId !== null}
						onclick={(e) => handleExampleClick(example, e)}
					>
						<div class="example-icon">
							{#if example.category === 'photonics'}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<circle cx="12" cy="12" r="3" stroke-width="2"/>
									<path stroke-width="2" d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
								</svg>
							{:else if example.category === 'digital'}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2"/>
									<path stroke-width="2" d="M9 9h6M9 12h6M9 15h4"/>
								</svg>
							{:else}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/>
									<path stroke-width="2" d="M3 9h18M9 21V9"/>
								</svg>
							{/if}
						</div>
						<div class="example-info">
							<span class="example-name">{example.name}</span>
							<span class="example-desc">{example.description}</span>
							<span class="example-meta">
								{example.fileSizeMB < 1 ? `${Math.round(example.fileSizeMB * 1000)} KB` : `${example.fileSizeMB.toFixed(1)} MB`}
								· {example.source}
							</span>
						</div>
						{#if loadingExampleId === example.id}
							<div class="example-loading">
								<div class="loading-spinner"></div>
							</div>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

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

	.file-upload.waiting {
		cursor: default;
		border-color: #4a9eff;
		border-style: solid;
	}

	.file-upload.waiting:hover {
		border-color: #4a9eff;
		background-color: #1a1a1a;
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

	.waiting-icon {
		color: #4a9eff;
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
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

	/* Container for upload and examples */
	.file-upload-container {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		max-width: 600px;
		width: 100%;
	}

	/* Examples section */
	.examples-section {
		text-align: left;
	}

	.examples-title {
		margin: 0 0 0.75rem 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.examples-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
	}

	.example-card {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		position: relative;
		overflow: hidden;
	}

	.example-card:hover:not(:disabled) {
		background: #222;
		border-color: #4a9eff;
	}

	.example-card:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.example-card.loading {
		border-color: #4a9eff;
	}

	.example-icon {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		color: #4a9eff;
	}

	.example-icon svg {
		width: 100%;
		height: 100%;
	}

	.example-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.example-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: #eee;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.example-desc {
		font-size: 0.75rem;
		color: #888;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.example-meta {
		font-size: 0.625rem;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.example-loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(26, 26, 26, 0.8);
	}

	.loading-spinner {
		width: 24px;
		height: 24px;
		border: 2px solid #333;
		border-top-color: #4a9eff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Mobile-first responsive adjustments */
	@media (max-width: 480px) {
		.examples-grid {
			grid-template-columns: 1fr;
		}

		.example-card {
			padding: 0.625rem;
		}

		.example-icon {
			width: 28px;
			height: 28px;
		}
	}
</style>
