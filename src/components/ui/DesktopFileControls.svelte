<script lang="ts">
/**
 * Desktop File Controls
 *
 * Provides desktop-specific file operations:
 * - Open file dialog
 * - Refresh current file
 * - Auto-watch toggle
 */

import { isTauri, openFileDialog, readFile, saveLastFilePath, watchFile } from "../../lib/tauri";
import { loadGDSIIFromBuffer } from "../../lib/utils/gdsLoader";
import { gdsStore } from "../../stores/gdsStore";

// State
let isWatching = $state(false);
let currentFilePath = $state<string | null>(null);
let unwatchFn: (() => void) | null = null;

// Derived state
const isDesktop = isTauri();
// Show watch/refresh buttons if we have a file path OR if any file is loaded
const hasFile = $derived(currentFilePath !== null || $gdsStore.fileName !== null);
const canWatch = $derived(currentFilePath !== null); // Can only watch if we have a file path

/**
 * Open file dialog and load the selected file
 */
async function handleOpenFile() {
	const filePath = await openFileDialog();
	if (!filePath) {
		return;
	}

	await loadFileFromPath(filePath);
}

/**
 * Load a file from a file path
 */
async function loadFileFromPath(filePath: string) {
	try {
		gdsStore.setLoading(true, "Reading file...", 0);

		// Read file from disk
		const arrayBuffer = await readFile(filePath);

		// Extract file name from path
		const fileName = filePath.split(/[\\/]/).pop() || "unknown.gds";

		// Load the file
		await loadGDSIIFromBuffer(arrayBuffer, fileName);

		// Save the file path
		currentFilePath = filePath;
		await saveLastFilePath(filePath);

		// Start watching if auto-watch is enabled
		if (isWatching) {
			await startWatching(filePath);
		}
	} catch (error) {
		console.error("[DesktopFileControls] Failed to load file:", error);
		gdsStore.setError(
			`Failed to load file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Refresh the current file
 */
async function handleRefresh() {
	if (!currentFilePath) {
		return;
	}

	await loadFileFromPath(currentFilePath);
}

/**
 * Start watching the current file
 */
async function startWatching(filePath: string) {
	// Stop any existing watcher
	if (unwatchFn) {
		unwatchFn();
		unwatchFn = null;
	}

	// Start new watcher
	unwatchFn = await watchFile(
		filePath,
		async () => {
			await loadFileFromPath(filePath);
		},
		(error: string) => {
			console.error("[DesktopFileControls] File watch error:", error);
			gdsStore.setError(`File watch error: ${error}`);
		},
	);
}

/**
 * Toggle auto-watch
 */
async function handleToggleWatch() {
	isWatching = !isWatching;

	if (isWatching && currentFilePath) {
		await startWatching(currentFilePath);
	} else if (!isWatching && unwatchFn) {
		unwatchFn();
		unwatchFn = null;
	}
}

// Cleanup on unmount
$effect(() => {
	return () => {
		if (unwatchFn) {
			unwatchFn();
		}
	};
});
</script>

{#if isDesktop}
	<div class="desktop-controls">
		<button class="control-button" onclick={handleOpenFile} title="Open File (Cmd/Ctrl+O)">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
			</svg>
			<span>Open</span>
		</button>

		{#if hasFile}
			{#if canWatch}
				<button class="control-button" onclick={handleRefresh} title="Refresh File (Cmd/Ctrl+R)">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					<span>Refresh</span>
				</button>

				<button
					class="control-button {isWatching ? 'active' : ''}"
					onclick={handleToggleWatch}
					title="Auto-refresh when file changes"
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
					</svg>
					<span>{isWatching ? "Watching" : "Watch"}</span>
				</button>
			{:else}
				<!-- File loaded via upload, not from disk -->
				<div class="info-message" title="Use 'Open' button to enable file watching">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span>Use "Open" for auto-refresh</span>
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.desktop-controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.control-button {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		background-color: #2a2a2a;
		border: 1px solid #444;
		border-radius: 0.375rem;
		color: #e5e7eb;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.control-button:hover {
		background-color: #333;
		border-color: #555;
	}

	.control-button.active {
		background-color: #1e40af;
		border-color: #3b82f6;
	}

	.control-button svg {
		width: 1rem;
		height: 1rem;
	}

	.info-message {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		background-color: #1e293b;
		border: 1px solid #475569;
		border-radius: 0.375rem;
		color: #94a3b8;
		font-size: 0.875rem;
		font-style: italic;
	}

	.info-message svg {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
	}
</style>

