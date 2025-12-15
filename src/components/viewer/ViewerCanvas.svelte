<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import type {
	CollaborativeViewportState,
	Comment,
	CommentPermissions,
	ParticipantViewport,
} from "../../lib/collaboration/types";
import { DEBUG_MEASUREMENT } from "../../lib/debug";
import { KeyboardShortcutManager } from "../../lib/keyboard/KeyboardShortcutManager";
import { snapToAxis } from "../../lib/measurements/utils";
import { PixiRenderer } from "../../lib/renderer/PixiRenderer";
import { generateUUID } from "../../lib/utils/uuid";
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

// E key hold detection for editor mode
const EDITOR_HOLD_DURATION_MS = 500;
let eKeyDownTime: number | null = null;
let eKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;

// M key hold detection for measurement mode
const MEASUREMENT_HOLD_DURATION_MS = 500;
let mKeyDownTime: number | null = null;
let mKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;
let mKeyTriggeredHold = false;

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
		// Note: M key is handled by handleMKeyDown/handleMKeyUp for hold detection
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
		commentStore.toggleAllCommentsVisibility();
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
		cKeyDownTime = null;
		cKeyTriggeredHold = false;
		return;
	}

	// Check for double-click
	const now = Date.now();
	const isDoubleClick =
		lastCKeyPressTime !== null && now - lastCKeyPressTime < DOUBLE_CLICK_INTERVAL_MS;

	if (isDoubleClick) {
		// Double-click: toggle comment panel and exit comment mode
		commentPanelVisible = !commentPanelVisible;
		commentModeActive = false;
		lastCKeyPressTime = null;
	} else {
		// Single click: toggle comment mode
		if (cKeyDownTime !== null) {
			const holdDuration = now - cKeyDownTime;
			if (holdDuration < COMMENT_HOLD_DURATION_MS) {
				commentModeActive = !commentModeActive;
			}
		}
		lastCKeyPressTime = now;
	}

	// Reset state
	cKeyDownTime = null;
	cKeyTriggeredHold = false;
}

/**
 * Handle E key down - start hold detection timer for editor mode
 * Hold (>=500ms) = toggle editor mode
 */
function handleEKeyDown(event: KeyboardEvent): void {
	// Only handle E key
	if (event.code !== "KeyE") return;

	// Don't handle in input fields
	const target = event.target as HTMLElement;
	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
		return;
	}

	// Already holding - ignore
	if (eKeyDownTime !== null) return;

	// Record key down time
	eKeyDownTime = Date.now();

	// Start hold detection timer
	eKeyHoldTimer = setTimeout(() => {
		// Hold threshold reached - toggle editor mode
		onToggleEditorMode?.();
	}, EDITOR_HOLD_DURATION_MS);
}

/**
 * Handle E key up - clear hold timer
 */
function handleEKeyUp(event: KeyboardEvent): void {
	// Only handle E key
	if (event.code !== "KeyE") return;

	// Clear the hold timer
	if (eKeyHoldTimer) {
		clearTimeout(eKeyHoldTimer);
		eKeyHoldTimer = null;
	}

	// Reset state
	eKeyDownTime = null;
}

/**
 * Handle M key down - start hold detection timer for measurement mode
 * Single press = toggle minimap, Hold = toggle measurement mode
 */
function handleMKeyDown(event: KeyboardEvent): void {
	// Only handle M key
	if (event.code !== "KeyM") return;

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
	mKeyDownTime = Date.now();
	mKeyTriggeredHold = false;

	// Start hold detection timer
	mKeyHoldTimer = setTimeout(() => {
		// Hold threshold reached - toggle measurement mode
		mKeyTriggeredHold = true;
		measurementStore.toggleMeasurementMode();
	}, MEASUREMENT_HOLD_DURATION_MS);
}

/**
 * Handle M key up - if short press, toggle minimap; if hold, measurement mode already toggled
 */
function handleMKeyUp(event: KeyboardEvent): void {
	// Only handle M key
	if (event.code !== "KeyM") return;

	// Clear the hold timer
	if (mKeyHoldTimer) {
		clearTimeout(mKeyHoldTimer);
		mKeyHoldTimer = null;
	}

	// If we triggered hold, just reset the flag (measurement mode already toggled)
	if (mKeyTriggeredHold) {
		mKeyDownTime = null;
		mKeyTriggeredHold = false;
		return;
	}

	// Short press: toggle minimap
	if (mKeyDownTime !== null) {
		const holdDuration = Date.now() - mKeyDownTime;
		if (holdDuration < MEASUREMENT_HOLD_DURATION_MS) {
			minimapVisible = !minimapVisible;
		}
	}

	// Reset state
	mKeyDownTime = null;
	mKeyTriggeredHold = false;
}

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
		// For touch devices in mobile mode, use touch-and-drag gesture instead
		if (
			typeof window !== "undefined" &&
			window.innerWidth < MOBILE_BREAKPOINT &&
			"pointerType" in event &&
			event.pointerType === "touch"
		) {
			return;
		}

		// Get click position relative to canvas
		const rect = canvas.getBoundingClientRect();
		const screenX = event.clientX - rect.left;
		const screenY = event.clientY - rect.top;

		// Convert screen coordinates to world coordinates
		const viewportState = renderer.getViewportState();
		const worldX = (screenX - viewportState.x) / viewportState.scale;
		const worldY = -((screenY - viewportState.y) / viewportState.scale);

		// Add point to measurement
		const documentUnits = $gdsStore.document?.units || { database: 1e-9, user: 1e-6 };
		measurementStore.addPoint(worldX, worldY, documentUnits);

		return;
	}

	// Handle comment mode
	if (commentModeActive) {
		// For touch devices in mobile mode, use the fixed crosshair button instead
		if (
			typeof window !== "undefined" &&
			window.innerWidth < MOBILE_BREAKPOINT &&
			"pointerType" in event &&
			event.pointerType === "touch"
		) {
			return;
		}

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

		// Store pending position and show modal
		pendingCommentPosition = { worldX, worldY };
		showCommentModal = true;
	}
}

/**
 * Handle comment submission from modal
 */
function handleCommentSubmit(content: string): void {
	if (!pendingCommentPosition) return;

	// Check 100 comment limit
	const currentCommentCount = comments.size;
	if (currentCommentCount >= 100) {
		commentStore.showToast("Comment limit reached (100 comments maximum)");
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

		// Check if viewer is allowed to comment
		if (!isHost && !commentPermissions.viewersCanComment) {
			commentStore.showToast("Commenting is disabled by the host");
			return;
		}

		// Check rate limit
		if (!commentStore.checkRateLimit(userId, isHost)) {
			const rateLimit = isHost ? "10 seconds" : "1 minute";
			commentStore.showToast(
				`Please wait before posting another comment (${rateLimit} rate limit)`,
			);
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
		}
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

	// Store pending position and show modal
	pendingCommentPosition = { worldX, worldY };
	showCommentModal = true;
}

/**
 * Handle viewport recentering from comment panel
 */
function handleRecenterViewport(worldX: number, worldY: number): void {
	if (!renderer || !canvas) return;

	// Get canvas dimensions
	const rect = canvas.getBoundingClientRect();
	const centerScreenX = rect.width / 2;
	const centerScreenY = rect.height / 2;

	// Calculate new viewport position to center the comment
	const viewportState = renderer.getViewportState();
	const newX = centerScreenX - worldX * viewportState.scale;
	const newY = centerScreenY + worldY * viewportState.scale; // Y-axis is flipped

	// Set viewport position
	renderer.setViewportState({
		...viewportState,
		x: newX,
		y: newY,
	});
}

/**
 * Handle mouse move for measurement cursor tracking
 */
function handleMouseMove(event: MouseEvent): void {
	if (!measurementModeActive || !renderer) {
		cursorWorldPos = null;
		return;
	}

	// Get mouse position relative to canvas
	const rect = canvas.getBoundingClientRect();
	const screenX = event.clientX - rect.left;
	const screenY = event.clientY - rect.top;

	// Convert screen coordinates to world coordinates
	const viewportState = renderer.getViewportState();
	const worldX = (screenX - viewportState.x) / viewportState.scale;
	const worldY = -((screenY - viewportState.y) / viewportState.scale);

	let worldPos = { worldX, worldY };

	// Apply snap-to-axis if Shift is held and first point exists
	if (event.shiftKey && activeMeasurement?.point1) {
		worldPos = snapToAxis(activeMeasurement.point1, worldPos);
	}

	cursorWorldPos = worldPos;
}

/**
 * Handle touch start for measurement mode on mobile
 * Touch down = first click (place first point)
 * Two-finger touch = auto-exit measurement mode and allow zoom
 */
function handleMeasurementTouchStart(event: TouchEvent): void {
	if (!renderer) return;

	// Two-finger touch: exit measurement mode and allow zoom gesture
	if (event.touches.length >= 2) {
		measurementStore.toggleMeasurementMode(); // Exit measurement mode
		// Don't stop propagation - let TouchController handle the zoom
		return;
	}

	// ALWAYS stop event propagation and prevent default when in measurement mode
	// This blocks TouchController from processing ANY touch events
	event.stopImmediatePropagation();
	event.preventDefault();

	// Only process single-touch for measurement
	if (event.touches.length !== 1) return;

	const touch = event.touches[0];
	if (!touch) return;

	// Get touch position relative to canvas
	const rect = canvas.getBoundingClientRect();
	const screenX = touch.clientX - rect.left;
	const screenY = touch.clientY - rect.top;

	// Convert screen coordinates to world coordinates
	const viewportState = renderer.getViewportState();
	const worldX = (screenX - viewportState.x) / viewportState.scale;
	const worldY = -((screenY - viewportState.y) / viewportState.scale);

	// Add first point
	const documentUnits = $gdsStore.document?.units || { database: 1e-9, user: 1e-6 };
	measurementStore.addPoint(worldX, worldY, documentUnits);

	// Update cursor position for tracking
	cursorWorldPos = { worldX, worldY };
}

/**
 * Handle touch move for measurement mode on mobile
 * Drag = mouse move (update cursor position)
 * Two-finger touch = auto-exit measurement mode and allow zoom
 */
function handleMeasurementTouchMove(event: TouchEvent): void {
	if (!renderer) return;

	// Two-finger touch: exit measurement mode and allow zoom gesture
	if (event.touches.length >= 2) {
		measurementStore.toggleMeasurementMode(); // Exit measurement mode
		// Don't stop propagation - let TouchController handle the zoom
		return;
	}

	// ALWAYS stop event propagation and prevent default when in measurement mode
	// This blocks TouchController from processing ANY touch events
	event.stopImmediatePropagation();
	event.preventDefault();

	// Only process single-touch for measurement
	if (event.touches.length !== 1) return;

	const touch = event.touches[0];
	if (!touch) return;

	// Get touch position relative to canvas
	const rect = canvas.getBoundingClientRect();
	const screenX = touch.clientX - rect.left;
	const screenY = touch.clientY - rect.top;

	// Convert screen coordinates to world coordinates
	const viewportState = renderer.getViewportState();
	const worldX = (screenX - viewportState.x) / viewportState.scale;
	const worldY = -((screenY - viewportState.y) / viewportState.scale);

	let worldPos = { worldX, worldY };

	// Apply snap-to-axis if Shift is held and first point exists
	// Note: Shift key detection on touch events is rare but supported
	if (event.shiftKey && activeMeasurement?.point1) {
		worldPos = snapToAxis(activeMeasurement.point1, worldPos);
	}

	// Update cursor position for tracking
	cursorWorldPos = worldPos;
}

/**
 * Handle touch end for measurement mode on mobile
 * Let go touch = second click (place second point and complete measurement)
 */
function handleMeasurementTouchEnd(event: TouchEvent): void {
	if (!renderer) return;

	// ALWAYS stop event propagation and prevent default when in measurement mode
	// This blocks TouchController from processing ANY touch events (including two-finger zoom)
	event.stopImmediatePropagation();
	event.preventDefault();

	// Only process single-touch for measurement
	if (event.changedTouches.length !== 1) return;

	const touch = event.changedTouches[0];
	if (!touch) return;

	// Get touch position relative to canvas
	const rect = canvas.getBoundingClientRect();
	const screenX = touch.clientX - rect.left;
	const screenY = touch.clientY - rect.top;

	// Convert screen coordinates to world coordinates
	const viewportState = renderer.getViewportState();
	const worldX = (screenX - viewportState.x) / viewportState.scale;
	const worldY = -((screenY - viewportState.y) / viewportState.scale);

	// Add second point (completes measurement)
	const documentUnits = $gdsStore.document?.units || { database: 1e-9, user: 1e-6 };
	measurementStore.addPoint(worldX, worldY, documentUnits);

	// Clear cursor position
	cursorWorldPos = null;
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

	// Register F key handlers for hold detection (fit view vs fullscreen)
	window.addEventListener("keydown", handleFKeyDown);
	window.addEventListener("keyup", handleFKeyUp);

	// Register C key handlers for comment mode
	window.addEventListener("keydown", handleCKeyDown);
	window.addEventListener("keyup", handleCKeyUp);

	// Register E key handlers for editor mode
	window.addEventListener("keydown", handleEKeyDown);
	window.addEventListener("keyup", handleEKeyUp);

	// Register M key handlers for measurement mode
	window.addEventListener("keydown", handleMKeyDown);
	window.addEventListener("keyup", handleMKeyUp);

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

		// Remove E key handlers
		window.removeEventListener("keydown", handleEKeyDown);
		window.removeEventListener("keyup", handleEKeyUp);

		// Remove M key handlers
		window.removeEventListener("keydown", handleMKeyDown);
		window.removeEventListener("keyup", handleMKeyUp);

		// Remove ESC key handler
		window.removeEventListener("keydown", handleEscKey);

		// Remove Ctrl/Cmd+K handler
		window.removeEventListener("keydown", handleClearMeasurements);

		// Remove canvas pointer handler
		canvas.removeEventListener("pointerup", handleCanvasClick);

		// Remove mouse move handler
		canvas.removeEventListener("mousemove", handleMouseMove);

		// Clear any pending timers
		if (fKeyHoldTimer) {
			clearTimeout(fKeyHoldTimer);
			fKeyHoldTimer = null;
		}
		if (cKeyHoldTimer) {
			clearTimeout(cKeyHoldTimer);
			cKeyHoldTimer = null;
		}
		if (eKeyHoldTimer) {
			clearTimeout(eKeyHoldTimer);
			eKeyHoldTimer = null;
		}
		if (mKeyHoldTimer) {
			clearTimeout(mKeyHoldTimer);
			mKeyHoldTimer = null;
		}
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

	// Set up callbacks for viewport sync
	sessionManager.setViewportSyncCallbacks({
		// When host's viewport changes, apply it if we're following
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

