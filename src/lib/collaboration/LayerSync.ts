/**
 * LayerSync - Handles layer visibility synchronization between host and followers
 *
 * Follows ViewportSync pattern with P0/P1/P2 priority system:
 * - P0: Host toggle (Y.Map) - resets viewer overrides
 * - P1: Viewer manual toggle (local) - overrides heartbeat
 * - P2: Heartbeat (awareness) - default sync for late joiners
 */

import type { AwarenessState, CollaborativeLayerVisibility, YjsSessionData } from "./types";
import type { YjsProvider } from "./YjsProvider";

const LAYER_BROADCAST_THROTTLE = 200;

export interface LayerSyncCallbacks {
	onHostLayerVisibilityChanged?: (visibility: { [key: string]: boolean }) => void;
	onBroadcastStateChanged?: (enabled: boolean, hostId: string | null) => void;
}

export class LayerSync {
	private yjsProvider: YjsProvider;
	private userId: string;
	private callbacks: LayerSyncCallbacks;
	private followOverride: boolean | undefined = undefined;
	private lastBroadcastTime = 0;
	private pendingVisibility: CollaborativeLayerVisibility | null = null;
	private throttleTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(yjsProvider: YjsProvider, userId: string, callbacks: LayerSyncCallbacks = {}) {
		this.yjsProvider = yjsProvider;
		this.userId = userId;
		this.callbacks = callbacks;
		this.setupAwarenessListener();
		this.setupSessionMapListener();
	}

	setCallbacks(callbacks: LayerSyncCallbacks): void {
		this.callbacks = callbacks;
	}

	private getSessionMap() {
		return this.yjsProvider.getMap<YjsSessionData[keyof YjsSessionData]>("session");
	}

	enableBroadcast(): void {
		const sessionMap = this.getSessionMap();
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("layerBroadcastEnabled", true);
			sessionMap.set("layerBroadcastHostId", this.userId);
		});
	}

	disableBroadcast(): void {
		const sessionMap = this.getSessionMap();
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("layerBroadcastEnabled", false);
			sessionMap.delete("layerBroadcastHostId");
		});
		this.clearFromAwareness();
	}

	isBroadcastEnabled(): boolean {
		return this.getSessionMap().get("layerBroadcastEnabled") === true;
	}

	getBroadcastHostId(): string | null {
		const hostId = this.getSessionMap().get("layerBroadcastHostId");
		return typeof hostId === "string" ? hostId : null;
	}

	broadcastLayerVisibility(visibility: { [key: string]: boolean }): void {
		if (!this.isBroadcastEnabled()) return;

		const state: CollaborativeLayerVisibility = { visibility, updatedAt: Date.now() };
		const now = Date.now();
		const elapsed = now - this.lastBroadcastTime;

		if (elapsed >= LAYER_BROADCAST_THROTTLE) {
			this.doBroadcast(state);
		} else {
			this.pendingVisibility = state;
			if (!this.throttleTimeout) {
				this.throttleTimeout = setTimeout(() => {
					if (this.pendingVisibility) {
						this.doBroadcast(this.pendingVisibility);
						this.pendingVisibility = null;
					}
					this.throttleTimeout = null;
				}, LAYER_BROADCAST_THROTTLE - elapsed);
			}
		}
	}

	private doBroadcast(state: CollaborativeLayerVisibility): void {
		try {
			const awareness = this.yjsProvider.getAwareness();
			const current = awareness.getLocalState() || {};
			awareness.setLocalState({ ...current, layerVisibility: state, layerBroadcastEnabled: true });
			this.lastBroadcastTime = Date.now();
		} catch (e) {
			console.error("[LayerSync] Broadcast failed:", e);
		}
	}

	private clearFromAwareness(): void {
		const awareness = this.yjsProvider.getAwareness();
		const current = awareness.getLocalState() || {};
		const { layerVisibility: _, layerBroadcastEnabled: __, ...rest } = current as any;
		awareness.setLocalState(rest);
	}

	setFollowOverride(override: boolean | undefined): void {
		this.followOverride = override;
	}

	private shouldFollow(): boolean {
		if (this.getBroadcastHostId() === this.userId) return false;
		if (this.followOverride !== undefined) return this.followOverride;
		return this.getHostBroadcastFromAwareness() === true;
	}

	private getHostBroadcastFromAwareness(): boolean | undefined {
		// Use layerBroadcastHostId from Y.js to identify the host,
		// rather than a separate awareness.isHost flag (avoids duplicate state)
		const broadcastHostId = this.getBroadcastHostId();
		if (!broadcastHostId) return undefined;

		for (const [, state] of this.yjsProvider.getAwareness().getStates()) {
			const s = state as AwarenessState | undefined;
			if (s?.userId === broadcastHostId && s.layerBroadcastEnabled !== undefined) {
				return s.layerBroadcastEnabled;
			}
		}
		return undefined;
	}

	private getHostLayerVisibility(): { [key: string]: boolean } | null {
		const hostId = this.getBroadcastHostId();
		if (!hostId) return null;
		for (const [, state] of this.yjsProvider.getAwareness().getStates()) {
			const s = state as AwarenessState | undefined;
			if (s?.userId === hostId && s.layerVisibility) return s.layerVisibility.visibility;
		}
		return null;
	}

	private setupAwarenessListener(): void {
		this.yjsProvider.getAwareness().on("change", () => {
			if (this.getBroadcastHostId() === this.userId) return;
			if (this.followOverride === undefined) {
				const enabled = this.getHostBroadcastFromAwareness();
				if (enabled !== undefined) {
					this.callbacks.onBroadcastStateChanged?.(enabled, this.getBroadcastHostId());
				}
			}
			if (this.shouldFollow()) {
				const vis = this.getHostLayerVisibility();
				if (vis) this.callbacks.onHostLayerVisibilityChanged?.(vis);
			}
		});
	}

	private setupSessionMapListener(): void {
		this.getSessionMap().observe((event) => {
			if (
				event.keysChanged.has("layerBroadcastEnabled") ||
				event.keysChanged.has("layerBroadcastHostId")
			) {
				this.followOverride = undefined;
				const enabled = this.isBroadcastEnabled();
				this.callbacks.onBroadcastStateChanged?.(enabled, this.getBroadcastHostId());
			}
		});
	}

	destroy(): void {
		if (this.throttleTimeout) clearTimeout(this.throttleTimeout);
	}
}
