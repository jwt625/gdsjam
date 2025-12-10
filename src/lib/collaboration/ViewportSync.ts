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

import type {
	AwarenessState,
	CollaborativeViewportState,
	ParticipantViewport,
	YjsSessionData,
} from "./types";
import type { YjsProvider } from "./YjsProvider";

// Throttle interval for viewport broadcasts (milliseconds)
const VIEWPORT_BROADCAST_THROTTLE = 200;

export interface ViewportSyncCallbacks {
	/** Called when host's viewport changes (for followers to apply) */
	onHostViewportChanged?: (viewport: CollaborativeViewportState) => void;
	/** Called when broadcast state changes (P0 or P2 triggered) */
	onBroadcastStateChanged?: (enabled: boolean, hostId: string | null) => void;
	/** Called when participant viewports change (for minimap display) */
	onParticipantViewportsChanged?: (viewports: ParticipantViewport[]) => void;
}

/**
 * Priority levels for follow state:
 * - P0: Host toggle (Y.Map) - resets viewer overrides
 * - P1: Viewer manual toggle (local) - overrides heartbeat
 * - P2: Heartbeat (awareness) - default sync
 */
export class ViewportSync {
	private yjsProvider: YjsProvider;
	private userId: string;
	private callbacks: ViewportSyncCallbacks;

	// Throttle state for host broadcast
	private lastBroadcastTime: number = 0;
	private pendingViewport: CollaborativeViewportState | null = null;
	private throttleTimeout: ReturnType<typeof setTimeout> | null = null;

	// Throttle state for own viewport broadcast (all users)
	private lastOwnBroadcastTime: number = 0;
	private pendingOwnViewport: CollaborativeViewportState | null = null;
	private ownThrottleTimeout: ReturnType<typeof setTimeout> | null = null;

	// Screen dimensions (needed to construct CollaborativeViewportState)
	private screenWidth: number = 0;
	private screenHeight: number = 0;

	/**
	 * P1 local override for following (viewer only)
	 * - undefined: use P2 heartbeat state (default)
	 * - true: manually enabled following
	 * - false: manually disabled following
	 */
	private followOverride: boolean | undefined = undefined;

	constructor(yjsProvider: YjsProvider, userId: string, callbacks: ViewportSyncCallbacks = {}) {
		this.yjsProvider = yjsProvider;
		this.userId = userId;
		this.callbacks = callbacks;

		this.setupAwarenessListener();
		this.setupSessionMapListener();
	}

	/**
	 * Notify callback of current broadcast state
	 * Call this after Y.js sync completes for viewers joining after broadcast started
	 * Y.Map observers only fire on changes, not initial state
	 */
	notifyCurrentBroadcastState(): void {
		const enabled = this.isBroadcastEnabled();
		const hostId = this.getBroadcastHostId();

		// Only notify if broadcast is actually enabled
		if (enabled && this.callbacks.onBroadcastStateChanged) {
			this.callbacks.onBroadcastStateChanged(enabled, hostId);
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
	 * Also includes broadcastEnabled: true for P2 heartbeat sync
	 */
	private doBroadcast(viewport: CollaborativeViewportState): void {
		try {
			const awareness = this.yjsProvider.getAwareness();
			const currentState = awareness.getLocalState() || {};

			awareness.setLocalState({
				...currentState,
				viewport,
				// Include broadcast state in awareness for P2 heartbeat sync
				// This allows late joiners to get the state without relying on Y.Map observer timing
				broadcastEnabled: true,
			});

			this.lastBroadcastTime = Date.now();
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

		// Remove viewport and broadcastEnabled fields
		const {
			viewport: _viewport,
			broadcastEnabled: _broadcastEnabled,
			...rest
		} = currentState as any;
		awareness.setLocalState(rest);
	}

	/**
	 * Get typed session map
	 */
	private getSessionMap() {
		return this.yjsProvider.getMap<YjsSessionData[keyof YjsSessionData]>("session");
	}

	/**
	 * Enable broadcast mode (host only)
	 */
	enableBroadcast(): void {
		const sessionMap = this.getSessionMap();
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("broadcastEnabled", true);
			sessionMap.set("broadcastHostId", this.userId);
		});
	}

	/**
	 * Re-broadcast the current broadcast state to trigger Y.Map observers
	 * Call this when a new peer joins and broadcast is already enabled
	 * This forces a Y.Map change event so the new peer's observer fires
	 */
	rebroadcastState(): void {
		if (!this.isBroadcastEnabled()) {
			return;
		}

		// Force a Y.Map update by writing the same values
		// Use a timestamp to ensure the change is detected
		const sessionMap = this.getSessionMap();
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("broadcastEnabled", true);
			sessionMap.set("broadcastHostId", this.userId);
		});
	}

	/**
	 * Disable broadcast mode
	 */
	disableBroadcast(): void {
		const sessionMap = this.getSessionMap();
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("broadcastEnabled", false);
			sessionMap.delete("broadcastHostId");
		});

		this.clearViewportFromAwareness();
	}

	/**
	 * Check if broadcast is currently enabled
	 */
	isBroadcastEnabled(): boolean {
		const sessionMap = this.getSessionMap();
		return sessionMap.get("broadcastEnabled") === true;
	}

	/**
	 * Get current broadcast host ID
	 */
	getBroadcastHostId(): string | null {
		const sessionMap = this.getSessionMap();
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
	 * Broadcast own viewport state (throttled) - for all users
	 * This is separate from host broadcast mode; all users share their viewport for minimap display
	 * Called when local viewport changes
	 */
	broadcastOwnViewport(x: number, y: number, scale: number): void {
		const viewport: CollaborativeViewportState = {
			x,
			y,
			scale,
			width: this.screenWidth,
			height: this.screenHeight,
			updatedAt: Date.now(),
		};

		const now = Date.now();
		const timeSinceLastBroadcast = now - this.lastOwnBroadcastTime;

		if (timeSinceLastBroadcast >= VIEWPORT_BROADCAST_THROTTLE) {
			// Can broadcast immediately
			this.doOwnBroadcast(viewport);
		} else {
			// Throttle: store pending and schedule
			this.pendingOwnViewport = viewport;
			if (!this.ownThrottleTimeout) {
				const delay = VIEWPORT_BROADCAST_THROTTLE - timeSinceLastBroadcast;
				this.ownThrottleTimeout = setTimeout(() => {
					if (this.pendingOwnViewport) {
						this.doOwnBroadcast(this.pendingOwnViewport);
						this.pendingOwnViewport = null;
					}
					this.ownThrottleTimeout = null;
				}, delay);
			}
		}
	}

	/**
	 * Actually broadcast own viewport via Awareness
	 * Does NOT set broadcastEnabled (that's only for host broadcast mode)
	 */
	private doOwnBroadcast(viewport: CollaborativeViewportState): void {
		try {
			const awareness = this.yjsProvider.getAwareness();
			const currentState = awareness.getLocalState() || {};

			awareness.setLocalState({
				...currentState,
				viewport,
			});

			this.lastOwnBroadcastTime = Date.now();
		} catch (error) {
			console.error("[ViewportSync] Failed to broadcast own viewport:", error);
		}
	}

	/**
	 * Get all participants' viewports for minimap display (Phase 3)
	 * Returns array of ParticipantViewport with user info and viewport data
	 */
	getParticipantViewports(): ParticipantViewport[] {
		const awareness = this.yjsProvider.getAwareness();
		const states = awareness.getStates();
		const broadcastHostId = this.getBroadcastHostId();
		const isFollowing = this.shouldFollowHost();

		const viewports: ParticipantViewport[] = [];

		for (const [, state] of states) {
			const awarenessState = state as AwarenessState | undefined;
			if (!awarenessState?.userId || !awarenessState.viewport) {
				continue;
			}

			// Exclude self from the list - we already have our own viewport outline
			const isSelf = awarenessState.userId === this.userId;
			if (isSelf) {
				continue;
			}

			const isFollowed = isFollowing && awarenessState.userId === broadcastHostId;

			viewports.push({
				userId: awarenessState.userId,
				displayName: awarenessState.displayName || "Unknown",
				color: awarenessState.color || "#888888",
				viewport: awarenessState.viewport,
				isFollowed,
			});
		}

		return viewports;
	}

	/**
	 * Set up listener for awareness changes (to detect host viewport updates)
	 * Also handles P2 heartbeat sync for broadcast state
	 */
	private setupAwarenessListener(): void {
		const awareness = this.yjsProvider.getAwareness();

		awareness.on("change", () => {
			// Always notify participant viewports changed (for minimap)
			if (this.callbacks.onParticipantViewportsChanged) {
				const viewports = this.getParticipantViewports();
				this.callbacks.onParticipantViewportsChanged(viewports);
			}

			// Host doesn't need to listen to awareness for viewport sync
			const isHost = this.getBroadcastHostId() === this.userId;
			if (isHost) return;

			// Check for P2 heartbeat: host's broadcastEnabled in awareness
			const hostBroadcastEnabled = this.getHostBroadcastEnabledFromAwareness();
			const hostId = this.getBroadcastHostId();

			// P2: If no P1 override, sync with heartbeat
			if (this.followOverride === undefined && hostBroadcastEnabled !== undefined) {
				// Notify callback of broadcast state from heartbeat
				if (this.callbacks.onBroadcastStateChanged) {
					this.callbacks.onBroadcastStateChanged(hostBroadcastEnabled, hostId);
				}
			}

			// Handle viewport updates if we should be following
			const shouldFollow = this.shouldFollowHost();
			if (shouldFollow) {
				const hostViewport = this.getHostViewport();
				if (hostViewport && this.callbacks.onHostViewportChanged) {
					this.callbacks.onHostViewportChanged(hostViewport);
				}
			}
		});
	}

	/**
	 * Get host's broadcastEnabled from awareness (P2 heartbeat)
	 * Uses broadcastHostId from Y.js session map to identify the host,
	 * rather than a separate awareness.isHost flag (avoids duplicate state)
	 */
	private getHostBroadcastEnabledFromAwareness(): boolean | undefined {
		// Use broadcastHostId from Y.js to identify who the broadcasting host is
		const broadcastHostId = this.getBroadcastHostId();
		if (!broadcastHostId) return undefined;

		const awareness = this.yjsProvider.getAwareness();
		const states = awareness.getStates();

		// Find the broadcasting host's awareness state
		for (const [, state] of states) {
			const awarenessState = state as AwarenessState | undefined;
			if (
				awarenessState?.userId === broadcastHostId &&
				awarenessState.broadcastEnabled !== undefined
			) {
				return awarenessState.broadcastEnabled;
			}
		}
		return undefined;
	}

	/**
	 * Determine if we should follow host based on priority system
	 * P1 (local override) takes precedence over P2 (heartbeat)
	 */
	private shouldFollowHost(): boolean {
		// If we're the host, we don't follow ourselves
		const isHost = this.getBroadcastHostId() === this.userId;
		if (isHost) return false;

		// P1: Local override takes precedence
		if (this.followOverride !== undefined) {
			return this.followOverride;
		}

		// P2: Use heartbeat state
		const hostBroadcastEnabled = this.getHostBroadcastEnabledFromAwareness();
		return hostBroadcastEnabled === true;
	}

	/**
	 * Set the P1 follow override (viewer manual toggle)
	 * @param override - true/false for manual override, undefined to use P2 heartbeat
	 */
	setFollowOverride(override: boolean | undefined): void {
		this.followOverride = override;
	}

	/**
	 * Get current P1 follow override
	 */
	getFollowOverride(): boolean | undefined {
		return this.followOverride;
	}

	/**
	 * Reset P1 follow override (called on P0 host toggle)
	 */
	resetFollowOverride(): void {
		this.followOverride = undefined;
	}

	/**
	 * Set up listener for session map changes (broadcast state - P0)
	 * P0 changes reset P1 overrides
	 */
	private setupSessionMapListener(): void {
		const sessionMap = this.getSessionMap();

		sessionMap.observe((event) => {
			if (event.keysChanged.has("broadcastEnabled") || event.keysChanged.has("broadcastHostId")) {
				const enabled = this.isBroadcastEnabled();
				const hostId = this.getBroadcastHostId();

				// P0 toggle: Reset P1 overrides so viewers sync with new state
				this.resetFollowOverride();

				if (this.callbacks.onBroadcastStateChanged) {
					this.callbacks.onBroadcastStateChanged(enabled, hostId);
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
		if (this.ownThrottleTimeout) {
			clearTimeout(this.ownThrottleTimeout);
			this.ownThrottleTimeout = null;
		}
	}
}
