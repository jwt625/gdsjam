<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import type {
	CollaborativeViewportState,
	ParticipantViewport,
} from "../../lib/collaboration/types";
import { DEBUG } from "../../lib/config";
import { KeyboardShortcutManager } from "../../lib/keyboard/KeyboardShortcutManager";
import { PixiRenderer } from "../../lib/renderer/PixiRenderer";
import { collaborationStore } from "../../stores/collaborationStore";
import { gdsStore } from "../../stores/gdsStore";
import { layerStore } from "../../stores/layerStore";
import type { BoundingBox, GDSDocument } from "../../types/gds";
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

let canvas: HTMLCanvasElement;
let renderer = $state<PixiRenderer | null>(null);
let lastRenderedDocument: GDSDocument | null = null;
let panelsVisible = $state(false);
let layerPanelVisible = $state(true);
let minimapVisible = $state(true);
let layerStoreInitialized = false;

// F key hold detection for fullscreen
const FULLSCREEN_HOLD_DURATION_MS = 500;
let fKeyDownTime: number | null = null;
let fKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;
let fKeyTriggeredFullscreen = false;

// Minimap state
let viewportBounds = $state<BoundingBox | null>(null);
let participantViewports = $state<ParticipantViewport[]>([]);

// Viewport sync state
const isHost = $derived($collaborationStore.isHost);
const isFollowing = $derived($collaborationStore.isFollowing);
const isBroadcasting = $derived($collaborationStore.isBroadcasting);
const isInSession = $derived($collaborationStore.isInSession);

// Trigger renderer resize when fullscreen mode changes
// The layout changes when header/footer are hidden, so canvas needs to resize
$effect(() => {
	// Access fullscreenMode to track it
	const _fullscreen = fullscreenMode;
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

onMount(() => {
	if (DEBUG) console.log("[ViewerCanvas] Initializing...");

	// Register keyboard shortcuts via centralized manager
	registerKeyboardShortcuts();

	// Register F key handlers for hold detection (fit view vs fullscreen)
	window.addEventListener("keydown", handleFKeyDown);
	window.addEventListener("keyup", handleFKeyUp);

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

		// Clear any pending timer
		if (fKeyHoldTimer) {
			clearTimeout(fKeyHoldTimer);
			fKeyHoldTimer = null;
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

	if (DEBUG) {
		console.log("[ViewerCanvas] Viewport sync set up");
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

<div class="viewer-container">
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
		performanceVisible={panelsVisible}
		minimapVisible={minimapVisible}
		layersVisible={layerPanelVisible}
		{fullscreenMode}
	/>

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

