/**
 * ViewportSync - Handles viewport synchronization between host and followers
 *
 * Responsibilities:
 * - Broadcast host's viewport state to all followers via Awareness API
 * - Throttle viewport updates (200ms) to reduce network load
 * - Provide current host viewport for followers to apply
 * - Track broadcast enabled state in session map
 *
 * Architecture:
 * - Uses awareness.setLocalStateField() to merge viewport with existing state
 * - Does not interfere with ParticipantManager's awareness writes
 * - Separate from ParticipantManager for Phase 1 (may consolidate in Phase 3)
 */

import { DEBUG } from "../config";
import type { AwarenessState, CollaborativeViewportState } from "./types";
import type { YjsProvider } from "./YjsProvider";

// Throttle interval for viewport broadcasts (milliseconds)
const VIEWPORT_BROADCAST_THROTTLE = 200;

export interface ViewportSyncCallbacks {
	/** Called when host's viewport changes (for followers to apply) */
	onHostViewportChanged?: (viewport: CollaborativeViewportState) => void;
	/** Called when broadcast state changes */
	onBroadcastStateChanged?: (enabled: boolean, hostId: string | null) => void;
}

export class ViewportSync {
	private yjsProvider: YjsProvider;
	private userId: string;
	private callbacks: ViewportSyncCallbacks;

	// Throttle state
	private lastBroadcastTime: number = 0;
	private pendingViewport: CollaborativeViewportState | null = null;
	private throttleTimeout: ReturnType<typeof setTimeout> | null = null;

	// Screen dimensions (needed to construct CollaborativeViewportState)
	private screenWidth: number = 0;
	private screenHeight: number = 0;

	constructor(yjsProvider: YjsProvider, userId: string, callbacks: ViewportSyncCallbacks = {}) {
		this.yjsProvider = yjsProvider;
		this.userId = userId;
		this.callbacks = callbacks;

		this.setupAwarenessListener();
		this.setupSessionMapListener();

		if (DEBUG) {
			console.log("[ViewportSync] Initialized for user:", userId);
		}
	}

	/**
	 * Update callbacks (for dynamic callback changes)
	 */
	setCallbacks(callbacks: ViewportSyncCallbacks): void {
		this.callbacks = callbacks;
	}

	/**
	 * Set screen dimensions (call on init and resize)
	 */
	setScreenDimensions(width: number, height: number): void {
		this.screenWidth = width;
		this.screenHeight = height;
	}

	/**
	 * Broadcast viewport state (throttled)
	 * Called by host when viewport changes
	 */
	broadcastViewport(x: number, y: number, scale: number): void {
		if (!this.isBroadcastEnabled()) {
			return;
		}

		const viewport: CollaborativeViewportState = {
			x,
			y,
			scale,
			width: this.screenWidth,
			height: this.screenHeight,
			updatedAt: Date.now(),
		};

		const now = Date.now();
		const timeSinceLastBroadcast = now - this.lastBroadcastTime;

		if (timeSinceLastBroadcast >= VIEWPORT_BROADCAST_THROTTLE) {
			// Can broadcast immediately
			this.doBroadcast(viewport);
		} else {
			// Throttle: store pending and schedule
			this.pendingViewport = viewport;
			if (!this.throttleTimeout) {
				const delay = VIEWPORT_BROADCAST_THROTTLE - timeSinceLastBroadcast;
				this.throttleTimeout = setTimeout(() => {
					if (this.pendingViewport) {
						this.doBroadcast(this.pendingViewport);
						this.pendingViewport = null;
					}
					this.throttleTimeout = null;
				}, delay);
			}
		}
	}

	/**
	 * Actually broadcast the viewport via Awareness
	 */
	private doBroadcast(viewport: CollaborativeViewportState): void {
		try {
			const awareness = this.yjsProvider.getAwareness();
			const currentState = awareness.getLocalState() || {};

			awareness.setLocalState({
				...currentState,
				viewport,
			});

			this.lastBroadcastTime = Date.now();

			if (DEBUG) {
				console.log("[ViewportSync] Broadcast viewport:", viewport);
			}
		} catch (error) {
			console.error("[ViewportSync] Failed to broadcast viewport:", error);
			// Don't throw - viewport sync is non-critical
		}
	}

	/**
	 * Clear viewport from awareness (when broadcast disabled)
	 */
	clearViewportFromAwareness(): void {
		const awareness = this.yjsProvider.getAwareness();
		const currentState = awareness.getLocalState() || {};

		// Remove viewport field by destructuring it out
		const { viewport: _viewport, ...rest } = currentState as any;
		awareness.setLocalState(rest);

		if (DEBUG) {
			console.log("[ViewportSync] Cleared viewport from awareness");
		}
	}

	/**
	 * Enable broadcast mode (host only)
	 */
	enableBroadcast(): void {
		const sessionMap = this.yjsProvider.getMap<boolean | string>("session");
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("broadcastEnabled", true);
			sessionMap.set("broadcastHostId", this.userId);
		});

		if (DEBUG) {
			console.log("[ViewportSync] Broadcast enabled");
		}
	}

	/**
	 * Disable broadcast mode
	 */
	disableBroadcast(): void {
		const sessionMap = this.yjsProvider.getMap<boolean | string>("session");
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("broadcastEnabled", false);
			sessionMap.delete("broadcastHostId");
		});

		this.clearViewportFromAwareness();

		if (DEBUG) {
			console.log("[ViewportSync] Broadcast disabled");
		}
	}

	/**
	 * Check if broadcast is currently enabled
	 */
	isBroadcastEnabled(): boolean {
		const sessionMap = this.yjsProvider.getMap<boolean | string>("session");
		return sessionMap.get("broadcastEnabled") === true;
	}

	/**
	 * Get current broadcast host ID
	 */
	getBroadcastHostId(): string | null {
		const sessionMap = this.yjsProvider.getMap<boolean | string>("session");
		const hostId = sessionMap.get("broadcastHostId");
		return typeof hostId === "string" ? hostId : null;
	}

	/**
	 * Get host's current viewport from awareness
	 */
	getHostViewport(): CollaborativeViewportState | null {
		const broadcastHostId = this.getBroadcastHostId();
		if (!broadcastHostId) return null;

		const awareness = this.yjsProvider.getAwareness();
		const states = awareness.getStates();

		for (const [, state] of states) {
			const awarenessState = state as AwarenessState | undefined;
			if (awarenessState?.userId === broadcastHostId) {
				return awarenessState.viewport ?? null;
			}
		}

		return null;
	}

	/**
	 * Set up listener for awareness changes (to detect host viewport updates)
	 */
	private setupAwarenessListener(): void {
		const awareness = this.yjsProvider.getAwareness();

		awareness.on("change", () => {
			// Only notify if we're not the broadcast host (followers care about host's viewport)
			const broadcastHostId = this.getBroadcastHostId();
			if (!broadcastHostId || broadcastHostId === this.userId) {
				return;
			}

			const hostViewport = this.getHostViewport();
			if (hostViewport && this.callbacks.onHostViewportChanged) {
				this.callbacks.onHostViewportChanged(hostViewport);
			}
		});
	}

	/**
	 * Set up listener for session map changes (broadcast state)
	 */
	private setupSessionMapListener(): void {
		const sessionMap = this.yjsProvider.getMap<boolean | string>("session");

		sessionMap.observe((event: { keysChanged: Set<string> }) => {
			if (event.keysChanged.has("broadcastEnabled") || event.keysChanged.has("broadcastHostId")) {
				const enabled = this.isBroadcastEnabled();
				const hostId = this.getBroadcastHostId();

				if (this.callbacks.onBroadcastStateChanged) {
					this.callbacks.onBroadcastStateChanged(enabled, hostId);
				}

				if (DEBUG) {
					console.log("[ViewportSync] Broadcast state changed:", { enabled, hostId });
				}
			}
		});
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		if (this.throttleTimeout) {
			clearTimeout(this.throttleTimeout);
			this.throttleTimeout = null;
		}

		if (DEBUG) {
			console.log("[ViewportSync] Destroyed");
		}
	}
}
