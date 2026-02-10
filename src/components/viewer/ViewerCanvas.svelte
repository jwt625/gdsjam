<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import type {
	CollaborativeViewportState,
	CommentPermissions,
	ParticipantViewport,
} from "../../lib/collaboration/types";
import { DEBUG_MEASUREMENT } from "../../lib/debug";
import { KeyboardShortcutManager } from "../../lib/keyboard/KeyboardShortcutManager";
import { PixiRenderer } from "../../lib/renderer/PixiRenderer";
import { initializeViewerRenderer } from "../../lib/viewer/initializeViewerRenderer";
import { setupViewerCollabSync } from "../../lib/viewer/setupViewerCollabSync";
import { ViewerCommentController } from "../../lib/viewer/ViewerCommentController";
import { ViewerKeyModeController } from "../../lib/viewer/ViewerKeyModeController";
import { ViewerMeasurementController } from "../../lib/viewer/ViewerMeasurementController";
import { collaborationStore } from "../../stores/collaborationStore";
import { commentStore } from "../../stores/commentStore";
import { editorStore } from "../../stores/editorStore";
import { gdsStore } from "../../stores/gdsStore";
import { layerStore } from "../../stores/layerStore";
import { measurementStore } from "../../stores/measurementStore";
import type { BoundingBox, GDSDocument } from "../../types/gds";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import CommentBubble from "../comments/CommentBubble.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import CommentInputModal from "../comments/CommentInputModal.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import CommentPanel from "../comments/CommentPanel.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import LayerPanel from "../ui/LayerPanel.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import Minimap from "../ui/Minimap.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import MobileControls from "../ui/MobileControls.svelte";
// biome-ignore lint/correctness/noUnusedImports: Used in Svelte template
import PerformancePanel from "../ui/PerformancePanel.svelte";

// Props for fullscreen mode and editor mode
interface Props {
	fullscreenMode?: boolean;
	onToggleFullscreen?: (enabled: boolean) => void;
	onToggleEditorMode?: () => void;
}

const { fullscreenMode = false, onToggleFullscreen, onToggleEditorMode }: Props = $props();

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
let keyModeController: ViewerKeyModeController | null = null;
let measurementController: ViewerMeasurementController | null = null;
let commentController: ViewerCommentController | null = null;

// Comment mode state
let commentModeActive = $state(false);
let showCommentModal = $state(false);
let pendingCommentPosition: { worldX: number; worldY: number } | null = $state(null);
let commentPanelVisible = $state(false);

// Comment display state
const comments = $derived($commentStore.comments);
const allCommentsVisible = $derived($commentStore.allCommentsVisible);
const commentPermissions = $derived($commentStore.permissions);
// Track viewport changes to trigger comment bubble position updates
let viewportVersion = $state(0);

// Editor mode state
const editorModeActive = $derived($editorStore.editorModeActive);

// Measurement mode state
const measurementModeActive = $derived($measurementStore.measurementModeActive);
const measurements = $derived($measurementStore.measurements);
const activeMeasurement = $derived($measurementStore.activeMeasurement);
const measurementsVisible = $derived($measurementStore.measurementsVisible);
const highlightedMeasurementId = $derived($measurementStore.highlightedMeasurementId);
let cursorWorldPos: { worldX: number; worldY: number } | null = $state(null);

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
			},
			description: "Toggle performance panels",
		},
		{
			id: "toggle-layers",
			key: "KeyL",
			callback: () => {
				layerPanelVisible = !layerPanelVisible;
			},
			description: "Toggle layer panel",
		},
		// Note: M key hold behavior is handled by ViewerKeyModeController
		// Short press = toggle minimap, Hold = toggle measurement mode
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
					// Initialize measurement store (local-only, even in collaboration)
					const fName = fileMetadata.fileName || fileName;
					const fSize = fileMetadata.fileSize || 0;
					measurementStore.initializeForFile(fName, fSize);
				}
			}
		} else {
			// Solo mode: use fileName + fileSize
			const fileSize = $gdsStore.statistics?.fileSizeBytes || 0;
			commentStore.initializeForFile(fileName, fileSize);
			// Initialize measurement store for solo mode (always local-only)
			measurementStore.initializeForFile(fileName, fileSize);
		}
	}
});

/**
 * Handle canvas click/tap for comment placement and measurement
 * Unified handler for both mouse and touch (via pointer events or click)
 */
function handleCanvasClick(event: MouseEvent | PointerEvent): void {
	if (!renderer) return;

	if (DEBUG_MEASUREMENT) {
		console.log("[ViewerCanvas] Canvas click, measurementModeActive:", measurementModeActive);
	}

	// Handle measurement mode
	if (measurementModeActive) {
		if (DEBUG_MEASUREMENT) {
			console.log("[ViewerCanvas] In measurement mode, adding point");
		}
		if (measurementController?.handleMeasurementCanvasClick(event)) {
			return;
		}

		return;
	}

	// Handle comment mode
	if (commentModeActive) {
		const pending = commentController?.getPendingFromCanvasPointer(event, MOBILE_BREAKPOINT);
		if (pending) {
			pendingCommentPosition = pending;
			showCommentModal = true;
		}
	}
}

/**
 * Handle comment submission from modal
 */
function handleCommentSubmit(content: string): void {
	const submitted = commentController?.submitComment(content, pendingCommentPosition) ?? false;
	if (!submitted) return;

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
	return commentController?.worldToScreen(worldX, worldY) ?? null;
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
	const pending = commentController?.getPendingFromViewportCenter();
	if (!pending) return;

	pendingCommentPosition = pending;
	showCommentModal = true;
}

/**
 * Handle viewport recentering from comment panel
 */
function handleRecenterViewport(worldX: number, worldY: number): void {
	commentController?.recenterViewport(worldX, worldY);
}

/**
 * Handle mouse move for measurement cursor tracking
 */
function handleMouseMove(event: MouseEvent): void {
	measurementController?.handleMouseMove(event, measurementModeActive);
}

/**
 * Handle touch start for measurement mode on mobile
 * Touch down = first click (place first point)
 * Two-finger touch = auto-exit measurement mode and allow zoom
 */
function handleMeasurementTouchStart(event: TouchEvent): void {
	measurementController?.handleTouchStart(event);
}

/**
 * Handle touch move for measurement mode on mobile
 * Drag = mouse move (update cursor position)
 * Two-finger touch = auto-exit measurement mode and allow zoom
 */
function handleMeasurementTouchMove(event: TouchEvent): void {
	measurementController?.handleTouchMove(event);
}

/**
 * Handle touch end for measurement mode on mobile
 * Let go touch = second click (place second point and complete measurement)
 */
function handleMeasurementTouchEnd(event: TouchEvent): void {
	measurementController?.handleTouchEnd(event);
}

/**
 * Handle Ctrl/Cmd+K to clear all measurements (KLayout-style)
 */
function handleClearMeasurements(event: KeyboardEvent): void {
	// Check for Ctrl+K (Windows/Linux) or Cmd+K (Mac)
	if (event.code !== "KeyK") return;
	if (!event.ctrlKey && !event.metaKey) return;

	// Don't handle in input fields
	const target = event.target as HTMLElement;
	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
		return;
	}

	// Clear all measurements
	measurementStore.clearAllMeasurements();
	event.preventDefault();
}

function isInputFocused(event: KeyboardEvent): boolean {
	const target = event.target as HTMLElement | null;
	if (!target) return false;
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * Handle ESC key to cancel comment mode and measurement mode
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
		event.preventDefault();
		return;
	}

	// Cancel measurement mode if active
	if (measurementModeActive) {
		measurementStore.exitMeasurementMode();
		event.preventDefault();
	}
}

onMount(() => {
	// Register keyboard shortcuts via centralized manager
	registerKeyboardShortcuts();

	measurementController = new ViewerMeasurementController({
		getRenderer: () => renderer,
		getCanvas: () => canvas,
		getDocumentUnits: () => $gdsStore.document?.units || { database: 1e-9, user: 1e-6 },
		getActiveMeasurementPoint1: () => activeMeasurement?.point1 || null,
		setCursorWorldPos: (point) => {
			cursorWorldPos = point;
		},
		addMeasurementPoint: (worldX, worldY, units) => {
			measurementStore.addPoint(worldX, worldY, units);
		},
		exitMeasurementMode: () => {
			measurementStore.exitMeasurementMode();
		},
	});

	commentController = new ViewerCommentController({
		getRenderer: () => renderer,
		getCanvas: () => canvas,
		getCommentsCount: () => comments.size,
		getIsInSession: () => $collaborationStore.isInSession,
		getIsHost: () => $collaborationStore.isHost,
		getCommentPermissions: () => commentPermissions,
		getSessionManager: () => collaborationStore.getSessionManager(),
		checkRateLimit: (userId, isHost) => commentStore.checkRateLimit(userId, isHost),
		showToast: (message) => commentStore.showToast(message),
		addComment: (comment, isInSession) => commentStore.addComment(comment, isInSession),
	});

	keyModeController = new ViewerKeyModeController({
		isInputFocused,
		toggleFullscreen: () => {
			if (onToggleFullscreen) {
				onToggleFullscreen(!fullscreenMode);
			}
		},
		fitToView: () => renderer?.fitToView(),
		toggleCommentVisibility: () => commentStore.toggleAllCommentsVisibility(),
		toggleCommentMode: () => {
			commentModeActive = !commentModeActive;
		},
		toggleCommentPanel: () => {
			commentPanelVisible = !commentPanelVisible;
			commentModeActive = false;
		},
		toggleEditorMode: () => onToggleEditorMode?.(),
		toggleMeasurementMode: () => measurementStore.toggleMeasurementMode(),
		toggleMinimap: () => {
			minimapVisible = !minimapVisible;
		},
	});

	// Register F/C/E/M key handlers for hold and double-tap behavior
	window.addEventListener("keydown", keyModeController.handleKeyDown);
	window.addEventListener("keyup", keyModeController.handleKeyUp);

	// Register ESC key handler for cancelling modes
	window.addEventListener("keydown", handleEscKey);

	// Register Ctrl/Cmd+K handler for clearing measurements
	window.addEventListener("keydown", handleClearMeasurements);

	// Register canvas pointer handler for comment/measurement placement (handles both mouse and touch)
	canvas.addEventListener("pointerup", handleCanvasClick);

	// Register mouse move handler for measurement cursor tracking
	canvas.addEventListener("mousemove", handleMouseMove);

	// Listen for custom resize event from EditorLayout
	const viewerContainer = canvas.parentElement;
	if (viewerContainer) {
		viewerContainer.addEventListener("viewer-resize", () => {
			renderer?.triggerResize();
		});
	}

	// Initialize renderer asynchronously
	if (canvas) {
		(async () => {
			const initialDocument = $gdsStore.document;
			if (initialDocument) {
				lastRenderedDocument = initialDocument;
				gdsStore.setRendering(true, "Rendering...", 0);
			}

			const result = await initializeViewerRenderer({
				canvas,
				initialDocument,
				onViewportChanged: (viewportState) => {
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
					sessionManager.broadcastOwnViewport(
						viewportState.x,
						viewportState.y,
						viewportState.scale,
					);

					// Broadcast to followers if host and broadcasting
					if (state.isHost && state.isBroadcasting) {
						sessionManager.broadcastViewport(viewportState.x, viewportState.y, viewportState.scale);
					}
				},
				onInitialRenderProgress: ({ progress, message }) => {
					gdsStore.setRendering(true, message, progress);
					if (progress >= 100) {
						setTimeout(() => gdsStore.setRendering(false), 500);
					}
				},
			});
			renderer = result.renderer;

			// Set up viewport sync callbacks
			setupViewportSync();

			if (result.initialDocumentRendered) {
				// After render completes, fitToView has run - get correct viewport bounds
				viewportBounds = renderer.getPublicViewportBounds();
			}
		})();
	}

	return () => {
		// Unregister keyboard shortcuts on unmount
		KeyboardShortcutManager.unregisterByOwner(KEYBOARD_OWNER);

		// Remove F/C/E/M key handlers
		if (keyModeController) {
			window.removeEventListener("keydown", keyModeController.handleKeyDown);
			window.removeEventListener("keyup", keyModeController.handleKeyUp);
		}

		// Remove ESC key handler
		window.removeEventListener("keydown", handleEscKey);

		// Remove Ctrl/Cmd+K handler
		window.removeEventListener("keydown", handleClearMeasurements);

		// Remove canvas pointer handler
		canvas.removeEventListener("pointerup", handleCanvasClick);

		// Remove mouse move handler
		canvas.removeEventListener("mousemove", handleMouseMove);

		keyModeController?.destroy();
		keyModeController = null;
		measurementController = null;
		commentController = null;
	};
});

/**
 * Dynamically add/remove touch event listeners for measurement mode on mobile
 * When measurement mode is active, touch events are used for drawing rulers instead of pan/zoom
 */
$effect(() => {
	if (!canvas) return;

	// Only manage touch listeners on mobile
	const isMobile = typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
	if (!isMobile) return;

	if (measurementModeActive) {
		// Add touch listeners for measurement in CAPTURE phase (fires before TouchController)
		// with passive: false to allow preventDefault and stopImmediatePropagation
		canvas.addEventListener("touchstart", handleMeasurementTouchStart, {
			capture: true,
			passive: false,
		});
		canvas.addEventListener("touchmove", handleMeasurementTouchMove, {
			capture: true,
			passive: false,
		});
		canvas.addEventListener("touchend", handleMeasurementTouchEnd, {
			capture: true,
			passive: false,
		});
	}

	// Cleanup: remove listeners when measurement mode is deactivated or component unmounts
	return () => {
		if (isMobile && measurementModeActive) {
			canvas.removeEventListener("touchstart", handleMeasurementTouchStart, { capture: true });
			canvas.removeEventListener("touchmove", handleMeasurementTouchMove, { capture: true });
			canvas.removeEventListener("touchend", handleMeasurementTouchEnd, { capture: true });
		}
	};
});

/**
 * Update measurement overlay when measurements or viewport changes
 */
$effect(() => {
	if (!renderer) return;

	// Access reactive dependencies
	const m = measurements;
	const am = activeMeasurement;
	const mv = measurementsVisible;
	const hm = highlightedMeasurementId;
	const cwp = cursorWorldPos;
	void viewportVersion; // Trigger update on viewport changes

	// Update measurement overlay
	renderer.updateMeasurementOverlay(m, am, cwp, mv, hm);
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

	setupViewerCollabSync(renderer, sessionManager, {
		onHostViewportChanged: (viewport: CollaborativeViewportState) => {
			// Read current state from store (not captured $derived values)
			const state = get(collaborationStore);
			if (!renderer || !state.isFollowing) return;

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
		onBroadcastStateChanged: (enabled: boolean, hostId: string | null) => {
			collaborationStore.handleBroadcastStateChanged(enabled, hostId);
		},
		onParticipantViewportsChanged: (viewports: ParticipantViewport[]) => {
			participantViewports = viewports;
		},
		onViewportBlocked: () => {
			// Read current state from store (not captured $derived values)
			const state = get(collaborationStore);
			if (state.isFollowing && !state.isHost) {
				collaborationStore.showFollowToast();
			}
		},
		onHostLayerVisibilityChanged: (visibility: { [key: string]: boolean }) => {
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
		onLayerBroadcastStateChanged: (enabled: boolean, _hostId: string | null) => {
			collaborationStore.handleLayerBroadcastStateChanged(enabled);
		},
		onFullscreenStateChanged: (enabled: boolean, _hostId: string | null) => {
			collaborationStore.handleFullscreenStateChanged(enabled, _hostId);
			// Trigger fullscreen mode change in App.svelte via callback
			if (onToggleFullscreen) {
				onToggleFullscreen(enabled);
			}
		},
		onCommentsChanged: (comments) => {
			commentStore.syncFromYjs(comments);
		},
		onPermissionsChanged: (permissions) => {
			commentStore.syncPermissionsFromYjs(permissions);
		},
	});
}

onDestroy(() => {
	renderer?.destroy();
});

// Subscribe to GDS store and render when document changes
// Only react to document changes, not other store properties
$effect(() => {
	const gdsDocument = $gdsStore.document;
	if (renderer?.isReady() && gdsDocument && gdsDocument !== lastRenderedDocument) {
		lastRenderedDocument = gdsDocument;
		// Reset layer store initialization flag when new document is loaded
		layerStoreInitialized = false;
		gdsStore.setRendering(true, "Rendering...", 0);
		(async () => {
			try {
				await renderer.renderGDSDocument(gdsDocument, (progress, message) => {
					gdsStore.setRendering(true, message, progress);
					if (progress >= 100) {
						setTimeout(() => gdsStore.setRendering(false), 500);
					}
				});
				// Update viewport bounds after render completes (for minimap)
				viewportBounds = renderer?.getPublicViewportBounds() ?? null;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error("[ViewerCanvas] Render failed:", error);
				gdsStore.setError(message);
				gdsStore.setRendering(false);
			}
		})();
	}
});

// Initialize layer store when document is FIRST loaded (not on every update)
$effect(() => {
	const gdsDocument = $gdsStore.document;
	if (gdsDocument && !layerStoreInitialized) {
		layerStore.setLayers(gdsDocument.layers);
		layerStoreInitialized = true;
	}
});

// Lock/unlock viewport when following state changes
$effect(() => {
	if (!renderer) return;

	// Lock viewport when following (viewer only, not host)
	const shouldLock = isFollowing && !isHost;
	renderer.setViewportLocked(shouldLock);
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
		onToggleCommentPanel={() => { commentPanelVisible = !commentPanelVisible; }}
		onToggleEditorMode={onToggleEditorMode}
		onToggleMeasurementMode={() => measurementStore.toggleMeasurementMode()}
		onClearMeasurements={() => measurementStore.clearAllMeasurements()}
		performanceVisible={panelsVisible}
		minimapVisible={minimapVisible}
		layersVisible={layerPanelVisible}
		{fullscreenMode}
		{commentModeActive}
		commentsVisible={allCommentsVisible}
		{commentPanelVisible}
		{editorModeActive}
		{measurementModeActive}
	/>

	<!-- Comment input modal -->
	<CommentInputModal
		visible={showCommentModal}
		onSubmit={handleCommentSubmit}
		onCancel={handleCommentCancel}
	/>

	<!-- Comment panel -->
	<CommentPanel
		visible={commentPanelVisible}
		onRecenterViewport={handleRecenterViewport}
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

	<!-- Measurement mode toast -->
	{#if $measurementStore.modeToastMessage}
		<div class="mode-toast" role="status" aria-live="polite">
			<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M3 3l18 18"/>
				<path d="M3 21V3h18"/>
			</svg>
			<span>{$measurementStore.modeToastMessage}</span>
			<button
				type="button"
				class="toast-dismiss"
				onclick={() => measurementStore.hideModeToast()}
				aria-label="Dismiss"
			>
				×
			</button>
		</div>
	{/if}

	<!-- Comment toast -->
	{#if $commentStore.toastMessage}
		<div class="comment-toast" role="status" aria-live="polite">
			<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
			</svg>
			<span>{$commentStore.toastMessage}</span>
			<button
				type="button"
				class="toast-dismiss"
				onclick={() => commentStore.hideToast()}
				aria-label="Dismiss"
			>
				×
			</button>
		</div>
	{/if}

	<!-- Measurement toast -->
	{#if $measurementStore.toastMessage}
		<div class="measurement-toast" role="status" aria-live="polite">
			<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M3 3l18 18"/>
				<path d="M3 21V3h18"/>
				<path d="M7 7v14"/>
				<path d="M11 11v10"/>
				<path d="M15 15v6"/>
				<path d="M19 19v2"/>
			</svg>
			<span>{$measurementStore.toastMessage}</span>
			<button
				type="button"
				class="toast-dismiss"
				onclick={() => measurementStore.hideToast()}
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

	/* Measurement mode toast */
	.mode-toast {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: rgba(0, 188, 212, 0.9);
		color: white;
		border-radius: 6px;
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 13px;
		font-weight: 500;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		z-index: 1001;
		/* NO ANIMATIONS */
		transition: none;
	}

	/* Comment toast */
	.comment-toast {
		position: absolute;
		top: 60px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: rgba(255, 152, 0, 0.9);
		color: white;
		border-radius: 6px;
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 13px;
		font-weight: 500;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		z-index: 1000;
		/* NO ANIMATIONS */
		transition: none;
	}

	/* Measurement toast */
	.measurement-toast {
		position: absolute;
		top: 104px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: rgba(0, 188, 212, 0.9);
		color: white;
		border-radius: 6px;
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 13px;
		font-weight: 500;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		z-index: 1000;
		/* NO ANIMATIONS */
		transition: none;
	}
</style>
