<script lang="ts">
import type { Example } from "../../lib/examples";
import { EXAMPLES, ExampleLoadError, loadExample } from "../../lib/examples";
import { loadGDSIIFromBuffer } from "../../lib/utils/gdsLoader";
import { collaborationStore } from "../../stores/collaborationStore";
import { gdsStore } from "../../stores/gdsStore";

/** Custom error for collaboration sync failures */
class CollaborationSyncError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CollaborationSyncError";
	}
}

// biome-ignore lint/correctness/noUnusedVariables: Used in Svelte class binding
let isDragging = $state(false);
let fileInputElement = $state<HTMLInputElement>();
let loadingExampleId: string | null = $state(null);

/**
 * Sync file to collaboration session
 * - If in session as host: upload file to session for immediate sync
 * - If not in session: store locally for future session creation (NO server upload)
 * - If in session as viewer: do nothing (viewers don't upload)
 *
 * @throws CollaborationSyncError if sync fails (file is still loaded locally)
 */
async function syncFileToCollaboration(arrayBuffer: ArrayBuffer, fileName: string): Promise<void> {
	if ($collaborationStore.isInSession && $collaborationStore.isHost) {
		// In session as host - upload file to session for immediate sync to viewers
		try {
			await collaborationStore.uploadFile(arrayBuffer, fileName);
		} catch (error) {
			console.error("[FileUpload] Failed to upload file to session:", error);
			throw new CollaborationSyncError(error instanceof Error ? error.message : String(error));
		}
	} else if (!$collaborationStore.isInSession) {
		// Not in a session - store locally only (NO server upload)
		// File will be uploaded when session is created
		try {
			collaborationStore.storePendingFile(arrayBuffer, fileName);
		} catch (error) {
			console.error("[FileUpload] Failed to store pending file:", error);
			// Don't throw - file is loaded locally, just won't be shareable
		}
	}
}

/**
 * Handle example click
 */
async function handleExampleClick(example: Example, event: Event) {
	event.stopPropagation();

	if (loadingExampleId) {
		return; // Already loading an example
	}

	loadingExampleId = example.id;

	try {
		gdsStore.setLoading(true, `Loading ${example.name}...`, 0);

		const { arrayBuffer, fileName } = await loadExample(example, (progress, message) => {
			gdsStore.updateProgress(progress, message);
		});

		// Sync to collaboration session (handles both pre-session and in-session cases)
		try {
			await syncFileToCollaboration(arrayBuffer, fileName);
		} catch (syncError) {
			// File loaded successfully but sync failed - log warning but don't block user
			if (syncError instanceof CollaborationSyncError) {
				console.warn("[FileUpload] Sync failed but file loaded locally:", syncError.message);
				// Note: File is loaded and viewable locally, sync will be retried on next action
				// A proper warning toast could be added here in the future
			} else {
				throw syncError;
			}
		}
	} catch (error) {
		console.error("[FileUpload] Failed to load example:", error);

		// Provide specific error messages based on error type
		if (error instanceof ExampleLoadError) {
			gdsStore.setError(`Failed to load example: ${error.message}`);
		} else {
			gdsStore.setError(
				`Failed to load example: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	} finally {
		loadingExampleId = null;
	}
}

/**
 * Handle file selection
 */
async function handleFile(file: File) {
	try {
		gdsStore.setLoading(true, "Reading file...", 0);

		const arrayBuffer = await file.arrayBuffer();

		// Load file locally first
		await loadGDSIIFromBuffer(arrayBuffer, file.name);

		// Sync to collaboration session (handles both pre-session and in-session cases)
		await syncFileToCollaboration(arrayBuffer, file.name);
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
	fileInputElement?.click();
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
						{#if example.previewOverviewUrl}
							<div class="example-preview">
								<img
									src={example.previewOverviewUrl}
									alt={example.name}
									loading="lazy"
								/>
							</div>
						{:else}
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
						{/if}
						<div class="example-info">
							<span class="example-name">{example.name}</span>
							<span class="example-desc">{example.description}</span>
							<span class="example-meta">
								{example.fileSizeMB < 1 ? `${Math.round(example.fileSizeMB * 1000)} KB` : `${example.fileSizeMB.toFixed(1)} MB`}
								·
								<a
									href={example.sourceUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="example-source-link"
									onclick={(e) => e.stopPropagation()}
								>{example.attribution}</a>
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
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.75rem;
	}

	.example-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0;
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

	.example-preview {
		width: 100%;
		aspect-ratio: 3 / 2;
		background: #111;
		overflow: hidden;
	}

	.example-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.example-icon {
		flex-shrink: 0;
		width: 100%;
		height: 80px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #111;
		color: #4a9eff;
	}

	.example-icon svg {
		width: 40px;
		height: 40px;
	}

	.example-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		padding: 0.5rem 0.75rem 0.75rem;
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

	.example-source-link {
		color: #4a9eff;
		text-decoration: none;
	}

	.example-source-link:hover {
		text-decoration: underline;
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
			grid-template-columns: 1fr 1fr;
		}

		.example-preview {
			aspect-ratio: 4 / 3;
		}

		.example-icon {
			height: 60px;
		}

		.example-info {
			padding: 0.375rem 0.5rem 0.5rem;
		}

		.example-name {
			font-size: 0.75rem;
		}

		.example-desc {
			font-size: 0.625rem;
		}
	}
</style>
