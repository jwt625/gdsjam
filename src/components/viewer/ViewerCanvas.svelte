<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import type {
	CollaborativeViewportState,
	Comment,
	CommentPermissions,
	ParticipantViewport,
} from "../../lib/collaboration/types";
import { DEBUG } from "../../lib/config";
import { KeyboardShortcutManager } from "../../lib/keyboard/KeyboardShortcutManager";
import { PixiRenderer } from "../../lib/renderer/PixiRenderer";
import { generateUUID } from "../../lib/utils/uuid";
import { collaborationStore } from "../../stores/collaborationStore";
import { commentStore } from "../../stores/commentStore";
import { gdsStore } from "../../stores/gdsStore";
import { layerStore } from "../../stores/layerStore";
import type { BoundingBox, GDSDocument } from "../../types/gds";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import CommentBubble from "../comments/CommentBubble.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import CommentInputModal from "../comments/CommentInputModal.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import LayerPanel from "../ui/LayerPanel.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import Minimap from "../ui/Minimap.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import MobileControls from "../ui/MobileControls.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import PerformancePanel from "../ui/PerformancePanel.svelte";

// Props for fullscreen mode
interface Props {
	fullscreenMode?: boolean;
	onToggleFullscreen?: (enabled: boolean) => void;
}

const { fullscreenMode = false, onToggleFullscreen }: Props = $props();

// Mobile breakpoint (matches CSS media query)
const MOBILE_BREAKPOINT = 1024; // pixels

let canvas: HTMLCanvasElement;
let renderer = $state<PixiRenderer | null>(null);
let lastRenderedDocument: GDSDocument | null = null;
let panelsVisible = $state(false);
// Layer panel: visible by default on desktop, hidden on mobile
// Initial state is just a hint - CSS media query (max-width: 1023px) handles actual visibility
let layerPanelVisible = $state(
	typeof window !== "undefined" && window.innerWidth >= MOBILE_BREAKPOINT,
);
let minimapVisible = $state(true);
let layerStoreInitialized = false;

// F key hold detection for fullscreen
const FULLSCREEN_HOLD_DURATION_MS = 500;
let fKeyDownTime: number | null = null;
let fKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;
let fKeyTriggeredFullscreen = false;

// C key hold detection for comment visibility toggle
const COMMENT_HOLD_DURATION_MS = 500;
const DOUBLE_CLICK_INTERVAL_MS = 300;
let cKeyDownTime: number | null = null;
let cKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;
let cKeyTriggeredHold = false;
let lastCKeyPressTime: number | null = null;

// Comment mode state
let commentModeActive = $state(false);
let showCommentModal = $state(false);
let pendingCommentPosition: { worldX: number; worldY: number } | null = $state(null);

// Comment display state
const comments = $derived($commentStore.comments);
const allCommentsVisible = $derived($commentStore.allCommentsVisible);
// Track viewport changes to trigger comment bubble position updates
let viewportVersion = $state(0);

// Minimap state
let viewportBounds = $state<BoundingBox | null>(null);
let participantViewports = $state<ParticipantViewport[]>([]);

// Viewport sync state
const isHost = $derived($collaborationStore.isHost);
const isFollowing = $derived($collaborationStore.isFollowing);
const isInSession = $derived($collaborationStore.isInSession);

// Trigger renderer resize when fullscreen mode changes
// The layout changes when header/footer are hidden, so canvas needs to resize
$effect(() => {
	// Access fullscreenMode to track it
	fullscreenMode;
	// Capture renderer reference before async operation
	const currentRenderer = renderer;
	// Schedule resize after DOM updates
	if (currentRenderer) {
		// Use requestAnimationFrame to wait for DOM layout to update
		requestAnimationFrame(() => {
			currentRenderer.triggerResize();
		});
	}
});

const KEYBOARD_OWNER = "ViewerCanvas";

/**
 * Register keyboard shortcuts for viewer controls
 */
function registerKeyboardShortcuts(): void {
	KeyboardShortcutManager.registerMany(KEYBOARD_OWNER, [
		{
			id: "toggle-panels",
			key: "KeyP",
			callback: () => {
				panelsVisible = !panelsVisible;
				if (DEBUG) console.log(`[ViewerCanvas] Panels ${panelsVisible ? "shown" : "hidden"}`);
			},
			description: "Toggle performance panels",
		},
		{
			id: "toggle-layers",
			key: "KeyL",
			callback: () => {
				layerPanelVisible = !layerPanelVisible;
				if (DEBUG)
					console.log(`[ViewerCanvas] Layer panel ${layerPanelVisible ? "shown" : "hidden"}`);
			},
			description: "Toggle layer panel",
		},
		{
			id: "toggle-minimap",
			key: "KeyM",
			callback: () => {
				minimapVisible = !minimapVisible;
				if (DEBUG) console.log(`[ViewerCanvas] Minimap ${minimapVisible ? "shown" : "hidden"}`);
			},
			description: "Toggle minimap",
		},
		{
			id: "toggle-fill",
			key: "KeyO",
			callback: () => {
				renderer?.toggleFill();
			},
			description: "Toggle fill/outline mode",
		},
	]);
}

/**
 * Initialize comment store when file is loaded
 */
$effect(() => {
	const fileName = $gdsStore.fileName;
	const document = $gdsStore.document;

	if (fileName && document) {
		const isInSession = $collaborationStore.isInSession;

		if (isInSession) {
			// Collaboration mode: use file hash from session
			const sessionManager = collaborationStore.getSessionManager();
			if (sessionManager) {
				const fileMetadata = sessionManager.getFileMetadata();
				if (fileMetadata?.fileHash) {
					// Get permissions from Y.js session map
					const provider = sessionManager.getProvider();
					const sessionMap = provider.getDoc().getMap<any>("session");
					const commentPermissions = sessionMap.get("commentPermissions") as
						| CommentPermissions
						| undefined;

					const permissions = commentPermissions || {
						viewersCanComment: false,
						viewerRateLimit: 60000, // 1 minute
						hostRateLimit: 10000, // 10 seconds
					};

					commentStore.initializeForSession(fileMetadata.fileHash, permissions);
					if (DEBUG) {
						console.log(
							`[ViewerCanvas] Comment store initialized for session: ${fileMetadata.fileHash}`,
						);
					}
				}
			}
		} else {
			// Solo mode: use fileName + fileSize
			const fileSize = $gdsStore.statistics?.fileSizeBytes || 0;
			commentStore.initializeForFile(fileName, fileSize);
			if (DEBUG) {
				console.log(
					`[ViewerCanvas] Comment store initialized for solo mode: ${fileName} (${fileSize} bytes)`,
				);
			}
		}
	}
});

/**
 * Handle F key down - start hold detection timer
 * Short press (<500ms) = fit to view, Hold (>=500ms) = fullscreen
 */
function handleFKeyDown(event: KeyboardEvent): void {
	// Only handle F key
	if (event.code !== "KeyF") return;

	// Don't handle in input fields
	const target = event.target as HTMLElement;
	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
		return;
	}

	// Don't handle with modifiers
	if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

	// Ignore repeat events (key held down)
	if (event.repeat) return;

	// Prevent default to avoid any browser shortcuts
	event.preventDefault();

	// Record keydown time and start timer
	fKeyDownTime = Date.now();
	fKeyTriggeredFullscreen = false;

	// Start hold detection timer
	fKeyHoldTimer = setTimeout(() => {
		// Hold threshold reached - toggle fullscreen
		fKeyTriggeredFullscreen = true;
		if (onToggleFullscreen) {
			onToggleFullscreen(!fullscreenMode);
			if (DEBUG)
				console.log(
					`[ViewerCanvas] F key hold detected - ${fullscreenMode ? "exiting" : "entering"} fullscreen`,
				);
		}
	}, FULLSCREEN_HOLD_DURATION_MS);
}

/**
 * Handle F key up - if short press, trigger fit to view
 */
function handleFKeyUp(event: KeyboardEvent): void {
	// Only handle F key
	if (event.code !== "KeyF") return;

	// Clear the hold timer
	if (fKeyHoldTimer) {
		clearTimeout(fKeyHoldTimer);
		fKeyHoldTimer = null;
	}

	// If we didn't trigger fullscreen (short press), do fit to view
	if (!fKeyTriggeredFullscreen && fKeyDownTime !== null) {
		const holdDuration = Date.now() - fKeyDownTime;
		if (holdDuration < FULLSCREEN_HOLD_DURATION_MS) {
			renderer?.fitToView();
			if (DEBUG) console.log("[ViewerCanvas] F key short press - fit to view");
		}
	}

	// Reset state
	fKeyDownTime = null;
	fKeyTriggeredFullscreen = false;
}

/**
 * Handle C key down - start hold detection timer and double-click detection
 * Single press = toggle comment mode, Double press = toggle comment panel, Hold = show/hide all comments
 */
function handleCKeyDown(event: KeyboardEvent): void {
	// Only handle C key
	if (event.code !== "KeyC") return;

	// Don't handle in input fields
	const target = event.target as HTMLElement;
	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
		return;
	}

	// Don't handle with modifiers
	if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

	// Ignore repeat events (key held down)
	if (event.repeat) return;

	// Prevent default to avoid any browser shortcuts
	event.preventDefault();

	// Record keydown time and start timer
	cKeyDownTime = Date.now();
	cKeyTriggeredHold = false;

	// Start hold detection timer
	cKeyHoldTimer = setTimeout(() => {
		// Hold threshold reached - toggle all comments visibility (persistent)
		cKeyTriggeredHold = true;
		const currentVisibility = $commentStore.allCommentsVisible;
		commentStore.toggleAllCommentsVisibility();
		if (DEBUG) {
			console.log(
				`[ViewerCanvas] C key hold detected - ${currentVisibility ? "hiding" : "showing"} all comments`,
			);
		}
	}, COMMENT_HOLD_DURATION_MS);
}

/**
 * Handle C key up - if short press, toggle comment mode or panel (double-click)
 */
function handleCKeyUp(event: KeyboardEvent): void {
	// Only handle C key
	if (event.code !== "KeyC") return;

	// Clear the hold timer
	if (cKeyHoldTimer) {
		clearTimeout(cKeyHoldTimer);
		cKeyHoldTimer = null;
	}

	// If we triggered hold, just reset the flag (visibility stays toggled)
	if (cKeyTriggeredHold) {
		if (DEBUG) console.log("[ViewerCanvas] C key released - visibility stays toggled");
		cKeyDownTime = null;
		cKeyTriggeredHold = false;
		return;
	}

	// Check for double-click
	const now = Date.now();
	const isDoubleClick =
		lastCKeyPressTime !== null && now - lastCKeyPressTime < DOUBLE_CLICK_INTERVAL_MS;

	if (isDoubleClick) {
		// Double-click: toggle comment panel (TODO: implement in Phase 4)
		if (DEBUG) console.log("[ViewerCanvas] C key double-click - toggle comment panel (TODO)");
		lastCKeyPressTime = null;
	} else {
		// Single click: toggle comment mode
		if (cKeyDownTime !== null) {
			const holdDuration = now - cKeyDownTime;
			if (holdDuration < COMMENT_HOLD_DURATION_MS) {
				commentModeActive = !commentModeActive;
				if (DEBUG)
					console.log(
						`[ViewerCanvas] C key short press - comment mode ${commentModeActive ? "ON" : "OFF"}`,
					);
			}
		}
		lastCKeyPressTime = now;
	}

	// Reset state
	cKeyDownTime = null;
	cKeyTriggeredHold = false;
}

/**
 * Handle canvas click for comment placement
 */
function handleCanvasClick(event: MouseEvent): void {
	if (!commentModeActive || !renderer) return;

	// Get click position relative to canvas
	const rect = canvas.getBoundingClientRect();
	const screenX = event.clientX - rect.left;
	const screenY = event.clientY - rect.top;

	// Convert screen coordinates to world coordinates (same logic as CoordinatesDisplay)
	// Access mainContainer properties via renderer's viewport state
	const viewportState = renderer.getViewportState();
	const worldX = (screenX - viewportState.x) / viewportState.scale;
	// Y-axis is flipped (mainContainer.scale.y = -1), so negate Y coordinate
	const worldY = -((screenY - viewportState.y) / viewportState.scale);

	if (DEBUG) {
		console.log(`[ViewerCanvas] Comment placement at world: (${worldX}, ${worldY})`);
	}

	// Store pending position and show modal
	pendingCommentPosition = { worldX, worldY };
	showCommentModal = true;
}

/**
 * Handle comment submission from modal
 */
function handleCommentSubmit(content: string): void {
	if (!pendingCommentPosition) return;

	// Check 100 comment limit
	const currentCommentCount = comments.size;
	if (currentCommentCount >= 100) {
		if (DEBUG) console.log("[ViewerCanvas] Comment limit (100) reached");
		// TODO: Show toast notification
		return;
	}

	// Get user info
	const isInSession = $collaborationStore.isInSession;
	const isHost = $collaborationStore.isHost;
	let userId: string;
	let displayName: string;
	let color: string;

	if (isInSession) {
		// Collaboration mode: get from session manager
		const sessionManager = collaborationStore.getSessionManager();
		if (!sessionManager) return;

		userId = sessionManager.getUserId();
		const users = sessionManager.getConnectedUsers();
		const currentUser = users.find((u) => u.id === userId);
		displayName = currentUser?.displayName || "Anonymous";
		color = currentUser?.color || "#888888";

		// Check rate limit
		if (!commentStore.checkRateLimit(userId, isHost)) {
			if (DEBUG) console.log("[ViewerCanvas] Rate limit exceeded");
			// TODO: Show toast notification
			return;
		}
	} else {
		// Solo mode: generate user info
		userId = localStorage.getItem("gdsjam_userId") || generateUUID();
		if (!localStorage.getItem("gdsjam_userId")) {
			localStorage.setItem("gdsjam_userId", userId);
		}
		displayName = "You";
		color = "#4ECDC4";
	}

	// Create comment
	const comment: Comment = {
		id: generateUUID(),
		authorId: userId,
		authorName: displayName,
		authorColor: color,
		content,
		worldX: pendingCommentPosition.worldX,
		worldY: pendingCommentPosition.worldY,
		createdAt: Date.now(),
		editedAt: null,
	};

	// Add to store (local state)
	commentStore.addComment(comment, isInSession);

	// Sync to Y.js if in collaboration mode
	if (isInSession) {
		const sessionManager = collaborationStore.getSessionManager();
		const commentSync = sessionManager?.getCommentSync();
		if (commentSync) {
			commentSync.addComment(comment);
			if (DEBUG) {
				console.log("[ViewerCanvas] Comment synced to Y.js:", comment.id);
			}
		}
	}

	if (DEBUG) {
		console.log("[ViewerCanvas] Comment created:", comment.id);
	}

	// Reset state
	pendingCommentPosition = null;
	showCommentModal = false;
	commentModeActive = false;
}

/**
 * Handle comment modal cancel
 */
function handleCommentCancel(): void {
	pendingCommentPosition = null;
	showCommentModal = false;
	// Keep comment mode active so user can try again
}

/**
 * Convert world coordinates to screen coordinates
 */
function worldToScreen(worldX: number, worldY: number): { x: number; y: number } | null {
	if (!renderer) return null;

	const viewportState = renderer.getViewportState();
	const screenX = worldX * viewportState.scale + viewportState.x;
	// Y-axis is flipped in the renderer (mainContainer.scale.y = -1)
	const screenY = -worldY * viewportState.scale + viewportState.y;

	return { x: screenX, y: screenY };
}

/**
 * Handle comment bubble click - cycle through display states
 */
function handleCommentBubbleClick(commentId: string): void {
	commentStore.cycleDisplayState(commentId);
}

/**
 * Handle mobile comment placement (fixed crosshair at viewport center)
 */
function handleMobilePlaceComment(): void {
	if (!renderer || !canvas) return;

	// Get viewport center in screen coordinates
	const rect = canvas.getBoundingClientRect();
	const centerScreenX = rect.width / 2;
	const centerScreenY = rect.height / 2;

	// Convert to world coordinates
	const viewportState = renderer.getViewportState();
	const worldX = (centerScreenX - viewportState.x) / viewportState.scale;
	const worldY = -((centerScreenY - viewportState.y) / viewportState.scale);

	if (DEBUG) {
		console.log(`[ViewerCanvas] Mobile comment placement at center: (${worldX}, ${worldY})`);
	}

	// Store pending position and show modal
	pendingCommentPosition = { worldX, worldY };
	showCommentModal = true;
}

/**
 * Handle ESC key to cancel comment mode
 */
function handleEscKey(event: KeyboardEvent): void {
	if (event.code !== "Escape") return;

	// Cancel comment modal if open
	if (showCommentModal) {
		handleCommentCancel();
		event.preventDefault();
		return;
	}

	// Cancel comment mode if active
	if (commentModeActive) {
		commentModeActive = false;
		if (DEBUG) console.log("[ViewerCanvas] ESC - comment mode cancelled");
		event.preventDefault();
	}
}

onMount(() => {
	if (DEBUG) console.log("[ViewerCanvas] Initializing...");

	// Register keyboard shortcuts via centralized manager
	registerKeyboardShortcuts();

	// Register F key handlers for hold detection (fit view vs fullscreen)
	window.addEventListener("keydown", handleFKeyDown);
	window.addEventListener("keyup", handleFKeyUp);

	// Register C key handlers for comment mode
	window.addEventListener("keydown", handleCKeyDown);
	window.addEventListener("keyup", handleCKeyUp);

	// Register ESC key handler for cancelling comment mode
	window.addEventListener("keydown", handleEscKey);

	// Register canvas click handler for comment placement
	canvas.addEventListener("click", handleCanvasClick);

	// Initialize renderer asynchronously
	if (canvas) {
		(async () => {
			renderer = new PixiRenderer();
			await renderer.init(canvas);

			// Set up viewport change callback for minimap (always, regardless of session)
			// Must be inside async block where renderer is defined
			renderer.setOnViewportChanged((viewportState) => {
				// Update minimap viewport bounds
				viewportBounds = renderer?.getPublicViewportBounds() ?? null;

				// Increment viewport version to trigger comment bubble position updates
				viewportVersion++;

				// Read current state from store (not captured $derived values)
				// This ensures we get the latest state when callback executes
				const state = get(collaborationStore);

				// Skip session-related broadcasts if not in session
				if (!state.isInSession) return;
				const sessionManager = collaborationStore.getSessionManager();
				if (!sessionManager) return;

				// Broadcast own viewport for minimap display (all users in session)
				sessionManager.broadcastOwnViewport(viewportState.x, viewportState.y, viewportState.scale);

				// Broadcast to followers if host and broadcasting
				if (state.isHost && state.isBroadcasting) {
					sessionManager.broadcastViewport(viewportState.x, viewportState.y, viewportState.scale);
				}
			});

			// Set up viewport sync callbacks
			setupViewportSync();

			if ($gdsStore.document) {
				lastRenderedDocument = $gdsStore.document;
				gdsStore.setRendering(true, "Rendering...", 0);
				await renderer.renderGDSDocument($gdsStore.document, (progress, message) => {
					gdsStore.setRendering(true, message, progress);
					if (progress >= 100) {
						setTimeout(() => gdsStore.setRendering(false), 500);
					}
				});
				// After render completes, fitToView has run - get correct viewport bounds
				viewportBounds = renderer.getPublicViewportBounds();
				if (DEBUG) console.log("[ViewerCanvas] Initial viewportBounds set:", viewportBounds);
			} else {
				if (DEBUG) console.log("[ViewerCanvas] No document to render");
			}
		})();
	}

	return () => {
		// Unregister keyboard shortcuts on unmount
		KeyboardShortcutManager.unregisterByOwner(KEYBOARD_OWNER);

		// Remove F key handlers
		window.removeEventListener("keydown", handleFKeyDown);
		window.removeEventListener("keyup", handleFKeyUp);

		// Remove C key handlers
		window.removeEventListener("keydown", handleCKeyDown);
		window.removeEventListener("keyup", handleCKeyUp);

		// Remove ESC key handler
		window.removeEventListener("keydown", handleEscKey);

		// Remove canvas click handler
		canvas.removeEventListener("click", handleCanvasClick);

		// Clear any pending timers
		if (fKeyHoldTimer) {
			clearTimeout(fKeyHoldTimer);
			fKeyHoldTimer = null;
		}
		if (cKeyHoldTimer) {
			clearTimeout(cKeyHoldTimer);
			cKeyHoldTimer = null;
		}
	};
});

/**
 * Set up viewport sync callbacks for collaboration
 */
function setupViewportSync() {
	// Read current state from store (not captured $derived values)
	const currentState = get(collaborationStore);
	if (!renderer || !currentState.isInSession) return;
	const sessionManager = collaborationStore.getSessionManager();
	if (!sessionManager) return;

	// Set up callbacks for viewport sync
	sessionManager.setViewportSyncCallbacks({
		// When host's viewport changes, apply it if we're following
		onHostViewportChanged: (viewport: CollaborativeViewportState) => {
			// Read current state from store (not captured $derived values)
			const state = get(collaborationStore);
			if (!renderer || !state.isFollowing) return;

			if (DEBUG) {
				console.log("[ViewerCanvas] Applying host viewport:", viewport);
			}

			// Apply the host's viewport state
			// We need to convert from host's screen coordinates to our screen
			// The host sends: x, y (container position), scale, width, height
			// We apply: center point and scale, adjusted for our screen size
			const ourScreen = renderer.getScreenDimensions();

			// Calculate the center point in world coordinates from host's viewport
			// Host's center in screen coords: (width/2, height/2)
			// In PixiJS with Y-flip: scaleY = -scaleX, so:
			//   worldX = (screenX - containerX) / scaleX
			//   worldY = (screenY - containerY) / scaleY = (screenY - containerY) / (-scaleX)
			const hostCenterWorldX = (viewport.width / 2 - viewport.x) / viewport.scale;
			const hostCenterWorldY = (viewport.height / 2 - viewport.y) / -viewport.scale;

			// Apply same center point to our screen
			// containerX = screenCenterX - worldX * scaleX
			// containerY = screenCenterY - worldY * scaleY = screenCenterY - worldY * (-scaleX)
			const newX = ourScreen.width / 2 - hostCenterWorldX * viewport.scale;
			const newY = ourScreen.height / 2 - hostCenterWorldY * -viewport.scale;

			renderer.setViewportState({
				x: newX,
				y: newY,
				scale: viewport.scale,
			});

			// Increment viewportVersion to trigger comment bubble position updates
			viewportVersion++;
		},

		// When broadcast state changes
		onBroadcastStateChanged: (enabled: boolean, hostId: string | null) => {
			collaborationStore.handleBroadcastStateChanged(enabled, hostId);
		},

		// When participant viewports change (for minimap)
		onParticipantViewportsChanged: (viewports: ParticipantViewport[]) => {
			participantViewports = viewports;
		},
	});

	// Set up blocked callback for showing toast when user tries to interact while following
	renderer.setOnViewportBlocked(() => {
		// Read current state from store (not captured $derived values)
		const state = get(collaborationStore);
		if (state.isFollowing && !state.isHost) {
			collaborationStore.showFollowToast();
		}
	});

	// Update screen dimensions for viewport sync
	const screen = renderer.getScreenDimensions();
	sessionManager.getViewportSync()?.setScreenDimensions(screen.width, screen.height);

	// Set up layer sync callbacks
	sessionManager.setLayerSyncCallbacks({
		onHostLayerVisibilityChanged: (visibility: { [key: string]: boolean }) => {
			if (DEBUG) console.log("[ViewerCanvas] Applying host layer visibility");
			// Apply to gdsStore (source of truth)
			for (const [key, visible] of Object.entries(visibility)) {
				const doc = $gdsStore.document;
				if (doc?.layers.has(key)) {
					const layer = doc.layers.get(key)!;
					if (layer.visible !== visible) {
						gdsStore.toggleLayerVisibility(key);
					}
				}
			}
			// Apply to layerStore (UI state)
			layerStore.applyRemoteVisibility(visibility);
			// Notify renderer
			window.dispatchEvent(new CustomEvent("layer-visibility-changed", { detail: { visibility } }));
		},
		onBroadcastStateChanged: (enabled: boolean, _hostId: string | null) => {
			collaborationStore.handleLayerBroadcastStateChanged(enabled);
		},
	});

	// Set up callbacks for fullscreen sync
	sessionManager.setFullscreenSyncCallbacks({
		onFullscreenStateChanged: (enabled: boolean, _hostId: string | null) => {
			collaborationStore.handleFullscreenStateChanged(enabled, _hostId);
			// Trigger fullscreen mode change in App.svelte via callback
			if (onToggleFullscreen) {
				onToggleFullscreen(enabled);
			}
		},
	});

	// Set up callbacks for comment sync
	sessionManager.setCommentSyncCallbacks({
		onCommentsChanged: (comments) => {
			if (DEBUG) console.log("[ViewerCanvas] Comments changed from Y.js:", comments.length);
			commentStore.syncFromYjs(comments);
		},
		onPermissionsChanged: (permissions) => {
			if (DEBUG) console.log("[ViewerCanvas] Comment permissions changed from Y.js:", permissions);
			commentStore.syncPermissionsFromYjs(permissions);
		},
	});

	if (DEBUG) {
		console.log("[ViewerCanvas] Viewport, layer, fullscreen, and comment sync set up");
	}
}

onDestroy(() => {
	if (DEBUG) console.log("[ViewerCanvas] Destroying renderer");
	renderer?.destroy();
});

// Subscribe to GDS store and render when document changes
// Only react to document changes, not other store properties
$effect(() => {
	const gdsDocument = $gdsStore.document;
	if (renderer?.isReady() && gdsDocument && gdsDocument !== lastRenderedDocument) {
		if (DEBUG) {
			console.log("[ViewerCanvas] Rendering document:", gdsDocument.name);
		}
		lastRenderedDocument = gdsDocument;
		// Reset layer store initialization flag when new document is loaded
		layerStoreInitialized = false;
		gdsStore.setRendering(true, "Rendering...", 0);
		(async () => {
			await renderer.renderGDSDocument(gdsDocument, (progress, message) => {
				gdsStore.setRendering(true, message, progress);
				if (progress >= 100) {
					setTimeout(() => gdsStore.setRendering(false), 500);
				}
			});
			// Update viewport bounds after render completes (for minimap)
			viewportBounds = renderer?.getPublicViewportBounds() ?? null;
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

// Lock/unlock viewport when following state changes
$effect(() => {
	if (!renderer) return;

	// Lock viewport when following (viewer only, not host)
	const shouldLock = isFollowing && !isHost;
	renderer.setViewportLocked(shouldLock);

	if (DEBUG) {
		console.log("[ViewerCanvas] Viewport locked:", shouldLock);
	}
});

// Re-setup viewport sync when session state changes
// This handles the case where file was uploaded before session was created
// Note: Callbacks use get(collaborationStore) so they always read fresh state
$effect(() => {
	if (isInSession && renderer?.isReady()) {
		setupViewportSync();
	}
});

// Handle minimap navigation (click-to-navigate)
// When scale is provided (clicking on participant viewport), apply exact view
function handleMinimapNavigate(worldX: number, worldY: number, scale?: number) {
	if (!renderer) return;
	if (scale !== undefined) {
		// Navigate to exact view (participant viewport click)
		renderer.setViewportCenterAndScale(worldX, worldY, scale);
	} else {
		// Regular click - just center on position
		renderer.setViewportCenter(worldX, worldY);
	}
}

// Toggle minimap visibility
function toggleMinimap() {
	minimapVisible = !minimapVisible;
}
</script>

<div class="viewer-container" class:comment-mode={commentModeActive}>
	<canvas bind:this={canvas} class="viewer-canvas"></canvas>
	<PerformancePanel {renderer} statistics={$gdsStore.statistics} visible={panelsVisible} />
	<LayerPanel statistics={$gdsStore.statistics} visible={layerPanelVisible} />
	<Minimap
		visible={minimapVisible}
		document={$gdsStore.document}
		{viewportBounds}
		{participantViewports}
		onNavigate={handleMinimapNavigate}
	/>
	<MobileControls
		{renderer}
		onTogglePerformance={() => { panelsVisible = !panelsVisible; }}
		onToggleLayers={() => { layerPanelVisible = !layerPanelVisible; }}
		onToggleMinimap={toggleMinimap}
		onToggleFullscreen={onToggleFullscreen}
		onToggleCommentMode={() => { commentModeActive = !commentModeActive; }}
		onToggleCommentsVisibility={() => commentStore.toggleAllCommentsVisibility()}
		onToggleCommentPanel={() => { /* TODO: Implement in Phase 4 */ }}
		performanceVisible={panelsVisible}
		minimapVisible={minimapVisible}
		layersVisible={layerPanelVisible}
		{fullscreenMode}
		{commentModeActive}
		commentsVisible={allCommentsVisible}
		commentPanelVisible={false}
	/>

	<!-- Comment input modal -->
	<CommentInputModal
		visible={showCommentModal}
		onSubmit={handleCommentSubmit}
		onCancel={handleCommentCancel}
	/>

	<!-- Comment bubbles -->
	{#if allCommentsVisible && renderer}
		{#each Array.from(comments.values()) as comment (`${comment.id}-${viewportVersion}`)}
			{@const screenPos = worldToScreen(comment.worldX, comment.worldY)}
			{#if screenPos}
				<CommentBubble
					{comment}
					screenX={screenPos.x}
					screenY={screenPos.y}
					onClick={() => handleCommentBubbleClick(comment.id)}
				/>
			{/if}
		{/each}
	{/if}

	<!-- Mobile comment placement crosshair (fixed at viewport center) -->
	{#if commentModeActive && typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT}
		<div class="mobile-comment-crosshair">
			<svg viewBox="0 0 40 40" width="40" height="40">
				<line x1="20" y1="0" x2="20" y2="15" stroke="rgba(78, 205, 196, 0.8)" stroke-width="2"/>
				<line x1="20" y1="25" x2="20" y2="40" stroke="rgba(78, 205, 196, 0.8)" stroke-width="2"/>
				<line x1="0" y1="20" x2="15" y2="20" stroke="rgba(78, 205, 196, 0.8)" stroke-width="2"/>
				<line x1="25" y1="20" x2="40" y2="20" stroke="rgba(78, 205, 196, 0.8)" stroke-width="2"/>
				<circle cx="20" cy="20" r="3" fill="rgba(78, 205, 196, 0.8)"/>
			</svg>
		</div>
		<button class="mobile-place-comment-btn" onclick={handleMobilePlaceComment}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
			</svg>
			<span>Place Comment</span>
		</button>
	{/if}

	<!-- Follow mode toast -->
	{#if $collaborationStore.showFollowToast}
		<div class="follow-toast" role="status" aria-live="polite">
			<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"></circle>
				<path d="M12 8v4l2 2"></path>
			</svg>
			<span>Host is controlling your view</span>
			<button
				type="button"
				class="toast-dismiss"
				onclick={() => collaborationStore.hideFollowToast()}
				aria-label="Dismiss"
			>
				×
			</button>
		</div>
	{/if}
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

	/* Comment mode cursor */
	.viewer-container.comment-mode {
		cursor: crosshair;
	}

	.viewer-container.comment-mode .viewer-canvas {
		cursor: crosshair;
	}

	/* Mobile comment placement crosshair (fixed at viewport center) */
	.mobile-comment-crosshair {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: 900;
	}

	/* Mobile place comment button */
	.mobile-place-comment-btn {
		position: fixed;
		bottom: 90px;
		right: 20px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		background: rgba(78, 205, 196, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.3);
		border-radius: 24px;
		color: #ffffff;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 1001;
		backdrop-filter: blur(10px);
		/* NO ANIMATIONS per project requirements */
		transition: none;
	}

	.mobile-place-comment-btn:active {
		transform: scale(0.95);
	}

	.mobile-place-comment-btn svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}

	/* Follow mode toast */
	.follow-toast {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: rgba(74, 158, 255, 0.9);
		color: white;
		border-radius: 6px;
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 13px;
		font-weight: 500;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		z-index: 1000;
		animation: slideDown 0.2s ease-out;
	}

	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}

	.toast-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.toast-dismiss {
		background: none;
		border: none;
		color: white;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		padding: 0 4px;
		opacity: 0.7;
		transition: opacity 0.15s;
	}

	.toast-dismiss:hover {
		opacity: 1;
	}
</style>

