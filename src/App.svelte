<script lang="ts">
import { onDestroy, onMount } from "svelte";
import ErrorToast from "./components/ui/ErrorToast.svelte";
import FileUpload from "./components/ui/FileUpload.svelte";
import HeaderBar from "./components/ui/HeaderBar.svelte";
import LoadingOverlay from "./components/ui/LoadingOverlay.svelte";
import ParticipantList from "./components/ui/ParticipantList.svelte";
import ViewerCanvas from "./components/viewer/ViewerCanvas.svelte";
import { KeyboardShortcutManager } from "./lib/keyboard/KeyboardShortcutManager";
import { loadGDSIIFromBuffer } from "./lib/utils/gdsLoader";
import { fetchGDSIIFromURL } from "./lib/utils/urlLoader";
import { collaborationStore } from "./stores/collaborationStore";
import { commentStore } from "./stores/commentStore";
import { gdsStore } from "./stores/gdsStore";

const KEYBOARD_OWNER = "App";

// Hidden file input for keyboard shortcut
let globalFileInput: HTMLInputElement;

// Fullscreen mode state (hides header and footer)
let fullscreenMode = $state(false);

/**
 * Toggle fullscreen mode (hide/show header and footer)
 */
function handleToggleFullscreen(enabled: boolean): void {
	fullscreenMode = enabled;
}

/**
 * Handle file selection from the global file input (Ctrl/Cmd+O shortcut)
 */
async function handleGlobalFileInput(event: Event) {
	const target = event.target as HTMLInputElement;
	const file = target.files?.[0];
	if (!file) return;

	try {
		gdsStore.setLoading(true, "Reading file...", 0);

		const arrayBuffer = await file.arrayBuffer();

		await loadGDSIIFromBuffer(arrayBuffer, file.name);

		// Clear all comments when a new file is loaded
		commentStore.reset();

		// If in a session and is host, upload file to session
		if ($collaborationStore.isInSession && $collaborationStore.isHost) {
			try {
				await collaborationStore.uploadFile(arrayBuffer, file.name);
			} catch (error) {
				console.error("[App] Failed to upload file to session:", error);
				gdsStore.setError(
					`File loaded locally but failed to upload to session: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} else if (!$collaborationStore.isInSession) {
			// Not in a session - store locally only (NO server upload)
			// File will be uploaded when session is created

			try {
				collaborationStore.storePendingFile(arrayBuffer, file.name);
			} catch (error) {
				console.error("[App] Failed to store pending file:", error);
				// Don't show error - file is loaded locally, just won't be shareable
			}
		}
	} catch (error) {
		console.error("[App] Failed to read file:", error);
		gdsStore.setError(
			`Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// Reset input so the same file can be selected again
	target.value = "";
}

/**
 * Register keyboard shortcuts for app-level controls
 */
function registerKeyboardShortcuts(): void {
	KeyboardShortcutManager.registerMany(KEYBOARD_OWNER, [
		{
			id: "open-file",
			key: "KeyO",
			modifiers: { ctrl: true },
			context: () => {
				// Block file upload for clients in a session (only host can upload)
				if ($collaborationStore.isInSession && !$collaborationStore.isHost) {
					return false;
				}
				return true;
			},
			callback: () => {
				globalFileInput?.click();
			},
			description: "Open file (Ctrl/Cmd+O)",
		},
		{
			id: "exit-fullscreen",
			key: "Escape",
			context: () => fullscreenMode, // Only active when in fullscreen mode
			callback: () => {
				handleToggleFullscreen(false);
			},
			description: "Exit fullscreen mode",
		},
	]);
}

/**
 * Check for URL parameters and handle file loading or session joining
 */
onMount(async () => {
	// Register keyboard shortcuts
	registerKeyboardShortcuts();
	// Parse URL parameters
	const urlParams = new URLSearchParams(window.location.search);
	const fileUrl = urlParams.get("url");
	const roomId = urlParams.get("room");

	// Handle room parameter (join collaboration session)
	if (roomId) {
		// Wait for Y.js sync before checking for file metadata
		await collaborationStore.joinSession(roomId);

		// File metadata should be available after sync
		const sessionManager = collaborationStore.getSessionManager();
		if (!sessionManager) {
			console.error("[App] Session manager not available");
			gdsStore.setError("Failed to initialize collaboration session");
		} else {
			// Set up file observer for the session
			const sessionMap = sessionManager.getProvider().getMap("session");
			const awareness = sessionManager.getProvider().getAwareness();
			let currentFileId: string | null = null;
			let isDownloading = false;
			let hasShownSessionEndedNotice = false;

			const downloadNewFile = async (fileId: string) => {
				if (isDownloading) return;
				isDownloading = true;

				try {
					const { arrayBuffer, fileName } = await collaborationStore.downloadFile();
					await loadGDSIIFromBuffer(arrayBuffer, fileName);
					currentFileId = fileId;
				} catch (error) {
					console.error("[App] Failed to download file from session:", error);
					gdsStore.setError(
						`Failed to download file from session: ${error instanceof Error ? error.message : String(error)}`,
					);
				} finally {
					isDownloading = false;
				}
			};

			const observer = () => {
				if (isDownloading) return;

				const fileId = sessionMap.get("fileId") as string | undefined;
				if (fileId && fileId !== currentFileId) {
					// New file available - download it
					downloadNewFile(fileId);
				}
			};

			// ALWAYS set up the observer to detect new file uploads from host
			sessionMap.observe(observer);

			// Check if file is already available in Y.js
			if (collaborationStore.isFileAvailable()) {
				// Download the initial file - observer will handle future uploads
				observer();
			} else {
				// Check if we have stored session info in localStorage (for recovery after refresh)
				const storedSession = collaborationStore.getStoredSessionInfo();
				if (storedSession) {
					try {
						const { arrayBuffer, fileName } = await collaborationStore.downloadFileById(
							storedSession.fileId,
							storedSession.fileName,
							storedSession.fileHash,
						);
						await loadGDSIIFromBuffer(arrayBuffer, fileName);
						// Set currentFileId so observer doesn't re-download
						currentFileId = storedSession.fileId;
						// Don't return early - observer is already set up for future updates
					} catch (error) {
						console.error("[App] Failed to recover file from localStorage:", error);
						// Continue to waiting logic - maybe peers will sync the file
					}
				}

				// Call observer to check current state and download if available
				observer();

				// Also check after short delays to catch sync timing issues
				setTimeout(observer, 500);
				setTimeout(observer, 1500);

				// Check session status based on peer count instead of aggressive timeout
				const checkSessionStatus = () => {
					if (currentFileId || sessionMap.has("fileId")) {
						return; // File available, no need to check
					}

					// Count peers (excluding self)
					const peerCount = awareness.getStates().size - 1;

					if (peerCount === 0 && !hasShownSessionEndedNotice) {
						// No peers connected - session may have ended
						hasShownSessionEndedNotice = true;
						// Don't show error, just info - the FileUpload component shows waiting UI
						// Only show notice after giving time for WebRTC to connect
					}
				};

				// Check after giving WebRTC time to establish connections
				setTimeout(checkSessionStatus, 5000);
				// Check again later in case connections were slow
				setTimeout(checkSessionStatus, 15000);

				// Listen for awareness changes to update peer count
				awareness.on("change", () => {
					// No early return needed - awareness changes don't trigger downloads
					const peerCount = awareness.getStates().size - 1;

					// If peers appeared after we showed "session ended", clear any notices
					if (peerCount > 0) {
						hasShownSessionEndedNotice = false;
					}
				});
			}
		}
	}

	// Handle URL parameter (load file from URL)
	if (fileUrl) {
		try {
			// Fetch the file from URL
			const { arrayBuffer, fileName } = await fetchGDSIIFromURL(fileUrl, (progress, message) => {
				gdsStore.setLoading(true, message, progress);
			});

			// Load the file
			await loadGDSIIFromBuffer(arrayBuffer, fileName);

			// Clear all comments when a new file is loaded
			commentStore.reset();
		} catch (error) {
			console.error("[App] Failed to load file from URL:", error);
			gdsStore.setError(
				`Failed to load file from URL: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
});

onDestroy(() => {
	// Unregister keyboard shortcuts on app unmount
	KeyboardShortcutManager.unregisterByOwner(KEYBOARD_OWNER);
});
</script>

<!-- Hidden file input for Ctrl/Cmd+O keyboard shortcut -->
<input
	type="file"
	accept=".gds,.gdsii,.dxf"
	bind:this={globalFileInput}
	onchange={handleGlobalFileInput}
	style="display: none;"
/>

<main class="app-main">
	{#if !fullscreenMode}
		<HeaderBar />
	{/if}

	<div class="viewer-wrapper">
		{#if !$gdsStore.document && !$gdsStore.isLoading}
			<div class="upload-overlay">
				<FileUpload />
			</div>
		{:else if $gdsStore.isLoading || $gdsStore.isRendering || $collaborationStore.isTransferring}
			<LoadingOverlay
				message={$collaborationStore.isTransferring ? $collaborationStore.fileTransferMessage : $gdsStore.loadingMessage}
				progress={$collaborationStore.isTransferring ? $collaborationStore.fileTransferProgress : $gdsStore.loadingProgress}
			/>
		{/if}

		{#if $gdsStore.document}
			<ViewerCanvas {fullscreenMode} onToggleFullscreen={handleToggleFullscreen} />
		{/if}

		<!-- Participant List overlay (only shown in session) -->
		{#if $collaborationStore.isInSession}
			<ParticipantList />
		{/if}

		{#if $gdsStore.error}
			<ErrorToast message={$gdsStore.error} onDismiss={() => gdsStore.clearError()} />
		{/if}
	</div>

	{#if !fullscreenMode}
		<div class="controls-info">
			<p class="text-sm text-gray-400 keyboard-shortcuts">
				Controls: Ctrl/Cmd+O to open file | Mouse wheel to zoom | Middle mouse or Space+Drag to pan | Arrow keys to move | Enter to zoom in | Shift+Enter to zoom out | F to fit view (hold for fullscreen) | Esc to exit fullscreen | G to toggle grid | O to toggle fill/outline | P to toggle info panel | L to toggle layer panel | M to toggle minimap | Touch: One finger to pan, two fingers to zoom
			</p>
			<p class="text-sm text-gray-400 footer-note">
				When not using sessions, this webapp is client-side only - your GDS file is not uploaded anywhere. Created by <a href="https://outside5sigma.com/" target="_blank" rel="noopener noreferrer" class="creator-link">Wentao</a>. Read or Contribute to source code on <a href="https://github.com/jwt625/gdsjam" target="_blank" rel="noopener noreferrer" class="creator-link">GitHub</a>.
			</p>
		</div>
	{/if}
</main>

<style>
	.app-main {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		background-color: #1a1a1a;
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
		align-items: flex-start;
		justify-content: center;
		padding: 2rem;
		background-color: #1a1a1a;
		overflow-y: auto;
	}

	.controls-info {
		padding: 0.5rem 1.5rem;
		background-color: #0f0f0f;
		border-top: 1px solid #333;
	}

	.footer-note {
		margin-top: 0.25rem;
	}

	.creator-link {
		color: #4a9eff;
		text-decoration: none;
		transition: color 0.2s;
	}

	.creator-link:hover {
		color: #6bb3ff;
		text-decoration: underline;
	}

	/* Hide keyboard shortcuts on mobile (use FAB instead), but keep footer note */
	@media (max-width: 1023px) {
		.keyboard-shortcuts {
			display: none;
		}
	}
</style>
