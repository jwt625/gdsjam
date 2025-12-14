<script lang="ts">
import { onDestroy, onMount } from "svelte";
import EditorLayout from "./components/code/EditorLayout.svelte";
import ErrorToast from "./components/ui/ErrorToast.svelte";
import FileUpload from "./components/ui/FileUpload.svelte";
import HeaderBar from "./components/ui/HeaderBar.svelte";
import HelpModal from "./components/ui/HelpModal.svelte";
import LoadingOverlay from "./components/ui/LoadingOverlay.svelte";
import ParticipantList from "./components/ui/ParticipantList.svelte";
import ViewerCanvas from "./components/viewer/ViewerCanvas.svelte";
import { type ExecutionResult, pythonExecutor } from "./lib/api/pythonExecutor";
import { getDefaultCode } from "./lib/code/defaultExample";
import { EmbedAPI } from "./lib/embed/EmbedAPI";
import { KeyboardShortcutManager } from "./lib/keyboard/KeyboardShortcutManager";
import { loadGDSIIFromBuffer } from "./lib/utils/gdsLoader";
import { fetchGDSIIFromURL } from "./lib/utils/urlLoader";
import { collaborationStore } from "./stores/collaborationStore";
import { commentStore } from "./stores/commentStore";
import { editorStore } from "./stores/editorStore";
import { gdsStore } from "./stores/gdsStore";

const KEYBOARD_OWNER = "App";
const HELP_MODAL_SEEN_KEY = "gdsjam_help_modal_seen";

// Hidden file input for keyboard shortcut
let globalFileInput: HTMLInputElement;

// Help modal state
let showHelpModal = $state(false);

// Fullscreen mode state (hides header and footer)
let fullscreenMode = $state(false);

// Editor mode state
const editorModeActive = $derived($editorStore.editorModeActive);

// Embed mode state (iframe-friendly, viewer-only)
let embedMode = $state(false);
let embedApi: EmbedAPI | null = null;

// Rate limit countdown interval (needs cleanup on unmount)
let rateLimitCountdownInterval: NodeJS.Timeout | null = null;

/**
 * Toggle fullscreen mode (hide/show header and footer)
 */
function handleToggleFullscreen(enabled: boolean): void {
	fullscreenMode = enabled;
}

/**
 * Toggle editor mode
 */
function handleToggleEditorMode(): void {
	const sessionId = $collaborationStore.sessionId;

	if (editorModeActive) {
		editorStore.exitEditorMode();
	} else {
		// Load default code if no code exists
		if (!$editorStore.code) {
			editorStore.setCode(getDefaultCode());
		}
		editorStore.enterEditorMode(sessionId);
	}

	// Trigger ViewerCanvas resize after mode toggle
	// Wait for DOM to update (EditorLayout to mount/unmount)
	requestAnimationFrame(() => {
		const viewerContainer = document.querySelector(".viewer-container");
		if (viewerContainer) {
			const resizeEvent = new CustomEvent("viewer-resize");
			viewerContainer.dispatchEvent(resizeEvent);
		}
	});
}

/**
 * Execute Python code
 */
async function handleExecuteCode(): Promise<void> {
	const code = $editorStore.code;
	if (!code.trim()) {
		editorStore.setExecutionError("No code to execute");
		return;
	}

	// Set executing state
	editorStore.setExecuting(true);
	editorStore.setExecutionError(null);
	editorStore.setConsoleOutput("");

	try {
		// Execute code on server
		const result: ExecutionResult = await pythonExecutor.execute(code);

		// Update console output
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
		editorStore.setConsoleOutput(output);

		if (!result.success) {
			editorStore.setExecutionError(result.error || "Execution failed");

			// Handle rate limiting
			if ("retryAfter" in result) {
				const retryAfter = (result as ExecutionResult & { retryAfter?: number }).retryAfter || 60;
				editorStore.setRateLimitCountdown(retryAfter);

				// Clear existing countdown interval if any (prevent memory leak)
				if (rateLimitCountdownInterval) {
					clearInterval(rateLimitCountdownInterval);
				}

				// Countdown timer
				rateLimitCountdownInterval = setInterval(() => {
					const current = $editorStore.rateLimitCountdown;
					if (current <= 1) {
						if (rateLimitCountdownInterval) {
							clearInterval(rateLimitCountdownInterval);
							rateLimitCountdownInterval = null;
						}
						editorStore.setRateLimitCountdown(0);
					} else {
						editorStore.setRateLimitCountdown(current - 1);
					}
				}, 1000);
			}
			return;
		}

		// If GDS file was generated, load it
		if (result.fileId) {
			await loadGeneratedGDS(result.fileId, result.size || 0);
		}
	} catch (error) {
		editorStore.setExecutionError(
			`Execution error: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		editorStore.setExecuting(false);
	}
}

/**
 * Load generated GDS file from server
 */
async function loadGeneratedGDS(fileId: string, fileSize: number): Promise<void> {
	const FILE_SIZE_THRESHOLD_MB = 10;
	const fileSizeMB = fileSize / (1024 * 1024);

	// Check if in session and is host
	const isHost = $collaborationStore.isHost;
	const isInSession = $collaborationStore.isInSession;

	// Auto-upload to session if host and file size <= 10MB
	if (isHost && isInSession && fileSizeMB <= FILE_SIZE_THRESHOLD_MB) {
		// Auto-upload: Store file metadata in Y.js (file already on server)
		const sessionManager = collaborationStore.getSessionManager();
		if (sessionManager) {
			const ydoc = sessionManager.getProvider().getDoc();
			if (ydoc) {
				// Store metadata in Y.js (file already on server, no upload needed)
				ydoc.transact(() => {
					const sessionMap = ydoc.getMap<unknown>("session");
					sessionMap.set("fileId", fileId);
					sessionMap.set("fileName", `generated_${Date.now()}.gds`);
					sessionMap.set("fileSize", fileSize);
					sessionMap.set("fileHash", fileId); // fileId is the SHA-256 hash
					sessionMap.set("uploadedBy", sessionManager.getUserId());
					sessionMap.set("uploadedAt", Date.now());
				});

				// Save to localStorage for session recovery
				sessionManager.saveSessionToLocalStorage(
					fileId,
					`generated_${Date.now()}.gds`,
					fileId,
					fileSize,
				);
			}
		}
	} else if (isHost && isInSession && fileSizeMB > FILE_SIZE_THRESHOLD_MB) {
		// Show warning toast for large files
		// TODO: Implement toast notification with "Sync to Session" button
		console.warn(
			`Generated GDS file is ${fileSizeMB.toFixed(2)}MB (>${FILE_SIZE_THRESHOLD_MB}MB). Manual sync required.`,
		);
	}

	// Load GDS file locally
	try {
		gdsStore.setLoading(true, "Loading generated GDS...", 0);

		// Download file from server
		const arrayBuffer = await pythonExecutor.downloadFile(fileId);

		// Load into viewer
		await loadGDSIIFromBuffer(arrayBuffer, `generated_${Date.now()}.gds`);

		// Clear comments (MVP behavior)
		commentStore.reset();

		gdsStore.setLoading(false);
	} catch (error) {
		gdsStore.setLoading(false);
		editorStore.setExecutionError(
			`Failed to load GDS: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function loadFileFromUrl(fileUrl: string): Promise<void> {
	// Fetch the file from URL
	const { arrayBuffer, fileName } = await fetchGDSIIFromURL(fileUrl, (progress, message) => {
		gdsStore.setLoading(true, message, progress);
	});

	// Load the file
	await loadGDSIIFromBuffer(arrayBuffer, fileName);

	// Clear all comments when a new file is loaded
	commentStore.reset();
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
 * Close help modal and mark as seen
 */
function handleCloseHelpModal(): void {
	showHelpModal = false;
	localStorage.setItem(HELP_MODAL_SEEN_KEY, "true");
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
		{
			id: "toggle-help",
			key: "KeyH",
			callback: () => {
				showHelpModal = !showHelpModal;
			},
			description: "Toggle help modal (H)",
		},
	]);
}

/**
 * Check for URL parameters and handle file loading or session joining
 */
onMount(async () => {
	// Register keyboard shortcuts
	registerKeyboardShortcuts();

	// Check if this is the first time user visits (show help modal)
	const hasSeenHelpModal = localStorage.getItem(HELP_MODAL_SEEN_KEY);

	// Parse URL parameters
	const urlParams = new URLSearchParams(window.location.search);
	const fileUrl = urlParams.get("url");
	const roomId = urlParams.get("room");

	// Detect embed mode either explicitly or by iframe context
	let isInIframe = false;
	try {
		isInIframe = window.self !== window.top;
	} catch {
		// Cross-origin access can throw; if it does, assume we're in an iframe.
		isInIframe = true;
	}
	embedMode = urlParams.get("embed") === "true" || isInIframe;

	if (!embedMode && !hasSeenHelpModal) {
		showHelpModal = true;
	}

	// Initialize embed postMessage API (optional)
	if (embedMode) {
		embedApi = new EmbedAPI();
		embedApi.init({
			loadUrl: async (url) => {
				try {
					await loadFileFromUrl(url);
					embedApi?.notifyFileLoaded({ url, fileName: $gdsStore.fileName ?? undefined });
				} catch (error) {
					embedApi?.notifyError(
						error instanceof Error ? error.message : `Failed to load file: ${String(error)}`,
					);
					throw error;
				}
			},
			getState: () => ({
				fileName: $gdsStore.fileName ?? null,
				isLoading: $gdsStore.isLoading,
				progress: $gdsStore.loadingProgress,
				message: $gdsStore.loadingMessage,
				error: $gdsStore.error,
			}),
		});
		embedApi.notifyReady();
	}

	// Handle room parameter (join collaboration session)
	// Embed mode is viewer-only: ignore collaboration sessions.
	if (roomId && !embedMode) {
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
			await loadFileFromUrl(fileUrl);
			embedApi?.notifyFileLoaded({ url: fileUrl, fileName: $gdsStore.fileName ?? undefined });
		} catch (error) {
			console.error("[App] Failed to load file from URL:", error);
			gdsStore.setError(
				`Failed to load file from URL: ${error instanceof Error ? error.message : String(error)}`,
			);
			embedApi?.notifyError(
				error instanceof Error ? error.message : `Failed to load file: ${String(error)}`,
			);
		}
	}
});

onDestroy(() => {
	// Unregister keyboard shortcuts on app unmount
	KeyboardShortcutManager.unregisterByOwner(KEYBOARD_OWNER);
	embedApi?.destroy();
	embedApi = null;

	// Clean up rate limit countdown interval (prevent memory leak)
	if (rateLimitCountdownInterval) {
		clearInterval(rateLimitCountdownInterval);
		rateLimitCountdownInterval = null;
	}
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
	{#if !fullscreenMode && !embedMode}
		<HeaderBar />
	{/if}

	<div class="viewer-wrapper">
		{#if !$gdsStore.document && !$gdsStore.isLoading}
			{#if embedMode}
				<div class="upload-overlay">
					<div class="text-gray-200 max-w-2xl">
						<h2 class="text-xl font-semibold mb-2">GDSJam Embed</h2>
						<p class="text-sm text-gray-400">
							No file loaded. Provide a URL with <code>?embed=true&amp;url=...</code> or send a
							postMessage <code>loadFile</code> command from the parent page.
						</p>
					</div>
				</div>
			{:else}
				<div class="upload-overlay">
					<FileUpload />
				</div>
			{/if}
		{:else if $gdsStore.isLoading || $gdsStore.isRendering || $collaborationStore.isTransferring}
			<LoadingOverlay
				message={$collaborationStore.isTransferring ? $collaborationStore.fileTransferMessage : $gdsStore.loadingMessage}
				progress={$collaborationStore.isTransferring ? $collaborationStore.fileTransferProgress : $gdsStore.loadingProgress}
			/>
		{/if}

		{#if editorModeActive}
			<!-- Editor Mode: Overlay layout for code editor and console -->
			<EditorLayout onExecute={handleExecuteCode} onClose={handleToggleEditorMode} />
		{/if}

		<!-- ViewerCanvas is always rendered, positioned via CSS based on editor mode -->
		{#if $gdsStore.document}
			<ViewerCanvas
				{fullscreenMode}
				onToggleFullscreen={handleToggleFullscreen}
				onToggleEditorMode={handleToggleEditorMode}
			/>
		{/if}

		<!-- Participant List overlay (only shown in session) -->
		{#if $collaborationStore.isInSession}
			<ParticipantList />
		{/if}

		{#if $gdsStore.error}
			<ErrorToast message={$gdsStore.error} onDismiss={() => gdsStore.clearError()} />
		{/if}

		<!-- Help Modal (shown on first page load) -->
		<HelpModal visible={showHelpModal} onClose={handleCloseHelpModal} />
	</div>

	{#if !fullscreenMode}
		{#if !embedMode}
			<div class="controls-info">
				<p class="text-sm text-gray-400 keyboard-shortcuts">
					Controls: Ctrl/Cmd+O to open file | Mouse wheel to zoom | Middle mouse or Space+Drag to pan | Arrow keys to move | Enter to zoom in | Shift+Enter to zoom out | F to fit view (hold for fullscreen) | Esc to exit fullscreen | G to toggle grid | O to toggle fill/outline | P to toggle info panel | L to toggle layer panel | M to toggle minimap | C to add comment (double-tap for comment panel, hold to toggle visibility) | H for help | Touch: One finger to pan, two fingers to zoom
				</p>
				<p class="text-sm text-gray-400 footer-note">
					When not using sessions, this webapp is client-side only - your GDS file is not uploaded anywhere. Created by <a href="https://outside5sigma.com/" target="_blank" rel="noopener noreferrer" class="creator-link">Wentao</a>. Read or Contribute to source code on <a href="https://github.com/jwt625/gdsjam" target="_blank" rel="noopener noreferrer" class="creator-link">GitHub</a>.
				</p>
			</div>
		{/if}
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
