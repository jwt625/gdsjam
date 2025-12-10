/**
 * FullscreenSync - Handles fullscreen mode synchronization between host and followers
 *
 * Follows ViewportSync pattern with P0/P1/P2 priority system:
 * - P0: Host toggle (Y.Map) - resets viewer overrides
 * - P1: Viewer manual toggle (local) - overrides heartbeat
 * - P2: Heartbeat (awareness) - default sync for late joiners
 */

import type { AwarenessState, YjsSessionData } from "./types";
import type { YjsProvider } from "./YjsProvider";

export interface FullscreenSyncCallbacks {
	onFullscreenStateChanged?: (enabled: boolean, hostId: string | null) => void;
}

export class FullscreenSync {
	private yjsProvider: YjsProvider;
	private userId: string;
	private callbacks: FullscreenSyncCallbacks;
	private fullscreenOverride: boolean | undefined = undefined;

	constructor(yjsProvider: YjsProvider, userId: string, callbacks: FullscreenSyncCallbacks = {}) {
		this.yjsProvider = yjsProvider;
		this.userId = userId;
		this.callbacks = callbacks;
		this.setupAwarenessListener();
		this.setupSessionMapListener();
	}

	setCallbacks(callbacks: FullscreenSyncCallbacks): void {
		this.callbacks = callbacks;
	}

	/**
	 * Notify callback of current fullscreen state
	 * Call this after Y.js sync completes for viewers joining after broadcast started
	 */
	notifyCurrentFullscreenState(): void {
		const enabled = this.isFullscreenEnabled();
		const hostId = this.getBroadcastHostId();

		if (enabled && this.callbacks.onFullscreenStateChanged) {
			this.callbacks.onFullscreenStateChanged(enabled, hostId);
		}
	}

	private getSessionMap() {
		return this.yjsProvider.getMap<YjsSessionData[keyof YjsSessionData]>("session");
	}

	/**
	 * Enable fullscreen mode (host only, called when broadcast is enabled)
	 */
	enableFullscreen(): void {
		const sessionMap = this.getSessionMap();
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("fullscreenEnabled", true);
			sessionMap.set("fullscreenHostId", this.userId);
		});

		// Broadcast in awareness for P2 heartbeat sync
		this.broadcastFullscreenState(true);
	}

	/**
	 * Disable fullscreen mode
	 */
	disableFullscreen(): void {
		const sessionMap = this.getSessionMap();
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("fullscreenEnabled", false);
			sessionMap.delete("fullscreenHostId");
		});

		// Clear from awareness
		this.clearFromAwareness();
	}

	/**
	 * Check if fullscreen is currently enabled
	 */
	isFullscreenEnabled(): boolean {
		const sessionMap = this.getSessionMap();
		return sessionMap.get("fullscreenEnabled") === true;
	}

	/**
	 * Get current fullscreen host ID
	 */
	getBroadcastHostId(): string | null {
		const sessionMap = this.getSessionMap();
		const hostId = sessionMap.get("fullscreenHostId");
		return typeof hostId === "string" ? hostId : null;
	}

	/**
	 * Broadcast fullscreen state via awareness (for P2 heartbeat sync)
	 */
	private broadcastFullscreenState(enabled: boolean): void {
		try {
			const awareness = this.yjsProvider.getAwareness();
			const current = awareness.getLocalState() || {};
			awareness.setLocalState({ ...current, fullscreenEnabled: enabled });
		} catch (e) {
			console.error("[FullscreenSync] Broadcast failed:", e);
		}
	}

	private clearFromAwareness(): void {
		const awareness = this.yjsProvider.getAwareness();
		const current = awareness.getLocalState() || {};
		const { fullscreenEnabled: _, ...rest } = current as any;
		awareness.setLocalState(rest);
	}

	/**
	 * Get host's fullscreenEnabled from awareness (P2 heartbeat)
	 */
	private getHostFullscreenEnabledFromAwareness(): boolean | undefined {
		const hostId = this.getBroadcastHostId();
		if (!hostId) return undefined;

		const awareness = this.yjsProvider.getAwareness();
		const states = awareness.getStates();

		for (const [, state] of states) {
			const awarenessState = state as AwarenessState | undefined;
			if (awarenessState?.userId === hostId && awarenessState.fullscreenEnabled !== undefined) {
				return awarenessState.fullscreenEnabled;
			}
		}
		return undefined;
	}

	/**
	 * Determine if we should enable fullscreen based on priority system
	 * P1 (local override) takes precedence over P2 (heartbeat)
	 */
	shouldEnableFullscreen(): boolean {
		// If we're the host, we control our own fullscreen
		const isHost = this.getBroadcastHostId() === this.userId;
		if (isHost) return this.isFullscreenEnabled();

		// P1: Local override takes precedence
		if (this.fullscreenOverride !== undefined) {
			return this.fullscreenOverride;
		}

		// P2: Use heartbeat state
		const hostFullscreenEnabled = this.getHostFullscreenEnabledFromAwareness();
		return hostFullscreenEnabled === true;
	}

	/**
	 * Set the P1 fullscreen override (viewer manual toggle)
	 * @param override - true/false for manual override, undefined to use P2 heartbeat
	 */
	setFullscreenOverride(override: boolean | undefined): void {
		this.fullscreenOverride = override;
	}

	/**
	 * Get current P1 fullscreen override
	 */
	getFullscreenOverride(): boolean | undefined {
		return this.fullscreenOverride;
	}

	/**
	 * Reset P1 fullscreen override (called on P0 host toggle)
	 */
	resetFullscreenOverride(): void {
		this.fullscreenOverride = undefined;
	}

	/**
	 * Set up listener for awareness changes (P2 heartbeat sync)
	 */
	private setupAwarenessListener(): void {
		const awareness = this.yjsProvider.getAwareness();

		awareness.on("change", () => {
			// Host doesn't need to listen to awareness for fullscreen sync
			const isHost = this.getBroadcastHostId() === this.userId;
			if (isHost) return;

			// Check for P2 heartbeat: host's fullscreenEnabled in awareness
			const hostFullscreenEnabled = this.getHostFullscreenEnabledFromAwareness();
			const hostId = this.getBroadcastHostId();

			// P2: If no P1 override, sync with heartbeat
			if (this.fullscreenOverride === undefined && hostFullscreenEnabled !== undefined) {
				// Notify callback of fullscreen state from heartbeat
				if (this.callbacks.onFullscreenStateChanged) {
					this.callbacks.onFullscreenStateChanged(hostFullscreenEnabled, hostId);
				}
			}
		});
	}

	/**
	 * Set up listener for session map changes (P0)
	 * P0 changes reset P1 overrides
	 */
	private setupSessionMapListener(): void {
		const sessionMap = this.getSessionMap();

		sessionMap.observe((event) => {
			if (event.keysChanged.has("fullscreenEnabled") || event.keysChanged.has("fullscreenHostId")) {
				const enabled = this.isFullscreenEnabled();
				const hostId = this.getBroadcastHostId();

				// P0 toggle: Reset P1 overrides so viewers sync with new state
				this.resetFullscreenOverride();

				if (this.callbacks.onFullscreenStateChanged) {
					this.callbacks.onFullscreenStateChanged(enabled, hostId);
				}
			}
		});
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {}
}
