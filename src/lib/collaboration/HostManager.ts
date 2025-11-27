/**
 * HostManager - Manages host state for collaboration sessions
 *
 * Responsibilities:
 * - Track current host in Y.js shared state
 * - Handle host recovery after page refresh
 * - Manage host claim when original host is absent
 * - Handle host transfer between participants
 * - Provide host-related warnings and notifications
 */

import { DEBUG } from "../config";
import type { YjsProvider } from "./YjsProvider";

// localStorage key prefix for host recovery (same browser, cross-tab)
// Format: gdsjam_host_{sessionId} = userId
const HOST_RECOVERY_KEY_PREFIX = "gdsjam_host_";

// Grace period for disconnect detection (milliseconds)
const DISCONNECT_GRACE_PERIOD = 10000; // 10 seconds

// Interval for updating hostLastSeen (milliseconds)
const HOST_HEARTBEAT_INTERVAL = 5000; // 5 seconds

export class HostManager {
	private yjsProvider: YjsProvider;
	private userId: string;
	private sessionId: string | null = null;
	private isHost: boolean = false;
	private hostHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private hostChangedCallbacks: Array<(newHostId: string) => void> = [];
	private hostAbsentCallbacks: Array<() => void> = [];

	constructor(yjsProvider: YjsProvider, userId: string) {
		this.yjsProvider = yjsProvider;
		this.userId = userId;

		if (DEBUG) {
			console.log("[HostManager] Initialized for user:", userId);
		}
	}

	/**
	 * Initialize host manager for a session
	 */
	initialize(sessionId: string): void {
		this.sessionId = sessionId;
		this.setupHostObserver();

		if (DEBUG) {
			console.log("[HostManager] Initialized for session:", sessionId);
		}
	}

	/**
	 * Set up Y.js observer for currentHostId changes
	 */
	private setupHostObserver(): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		sessionMap.observe((event) => {
			if (event.keysChanged.has("currentHostId")) {
				const newHostId = sessionMap.get("currentHostId") as string | undefined;
				if (newHostId) {
					this.isHost = newHostId === this.userId;
					this.notifyHostChanged(newHostId);

					if (DEBUG) {
						console.log("[HostManager] Host changed to:", newHostId, "isHost:", this.isHost);
					}
				} else {
					// Host was cleared (intentional leave) - notify for auto-promotion
					this.isHost = false;
					if (DEBUG) {
						console.log("[HostManager] Host was cleared, triggering auto-promotion check");
					}
					this.notifyHostAbsent();
				}
			}
		});
	}

	/**
	 * Get current host ID from Y.js session map
	 */
	getCurrentHostId(): string | null {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		return sessionMap.get("currentHostId") ?? null;
	}

	/**
	 * Set current host ID in Y.js session map
	 */
	setCurrentHostId(hostId: string): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.set("currentHostId", hostId);
			sessionMap.set("hostLastSeen", Date.now());
		});
		this.isHost = hostId === this.userId;

		// Start heartbeat if we're the host
		if (this.isHost) {
			this.startHostHeartbeat();
		}

		if (DEBUG) {
			console.log("[HostManager] Set host ID:", hostId);
		}
	}

	/**
	 * Update hostLastSeen timestamp (called periodically by host)
	 */
	updateHostLastSeen(): void {
		if (!this.isHost) return;

		const sessionMap = this.yjsProvider.getMap<any>("session");
		sessionMap.set("hostLastSeen", Date.now());

		if (DEBUG) {
			console.log("[HostManager] Updated hostLastSeen");
		}
	}

	/**
	 * Set local isHost state without writing to Y.js
	 * Used when host state is already set in a transaction
	 */
	setIsHostLocal(isHost: boolean): void {
		this.isHost = isHost;

		if (DEBUG) {
			console.log("[HostManager] Set local isHost:", isHost);
		}
	}

	/**
	 * Start heartbeat interval to update hostLastSeen
	 */
	startHostHeartbeat(): void {
		this.stopHostHeartbeat();
		this.hostHeartbeatInterval = setInterval(() => {
			this.updateHostLastSeen();
		}, HOST_HEARTBEAT_INTERVAL);

		if (DEBUG) {
			console.log("[HostManager] Started host heartbeat");
		}
	}

	/**
	 * Stop heartbeat interval
	 */
	private stopHostHeartbeat(): void {
		if (this.hostHeartbeatInterval) {
			clearInterval(this.hostHeartbeatInterval);
			this.hostHeartbeatInterval = null;

			if (DEBUG) {
				console.log("[HostManager] Stopped host heartbeat");
			}
		}
	}

	/**
	 * Check if current host is connected via Awareness API
	 */
	isCurrentHostConnected(): boolean {
		const currentHostId = this.getCurrentHostId();
		if (!currentHostId) return false;

		// Check awareness states for the host
		const awareness = this.yjsProvider.getAwareness();
		const states = awareness.getStates();

		// Look for host in awareness states
		for (const [, state] of states) {
			if (state && (state as any).userId === currentHostId) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Get hostLastSeen timestamp from Y.js
	 */
	getHostLastSeen(): number | null {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		return sessionMap.get("hostLastSeen") ?? null;
	}

	/**
	 * Mark host for recovery (called before page unload)
	 * Uses localStorage for same-browser cross-tab recovery
	 */
	markHostForRecovery(): void {
		if (!this.isHost || !this.sessionId) return;

		const key = `${HOST_RECOVERY_KEY_PREFIX}${this.sessionId}`;
		try {
			localStorage.setItem(key, this.userId);
			if (DEBUG) {
				console.log("[HostManager] Marked host for recovery:", key);
			}
		} catch (error) {
			console.error("[HostManager] Failed to mark host for recovery:", error);
		}
	}

	/**
	 * Clear host recovery flag (called on intentional leave)
	 */
	clearHostRecoveryFlag(): void {
		if (!this.sessionId) return;

		const key = `${HOST_RECOVERY_KEY_PREFIX}${this.sessionId}`;
		try {
			localStorage.removeItem(key);
			if (DEBUG) {
				console.log("[HostManager] Cleared host recovery flag:", key);
			}
		} catch (error) {
			console.error("[HostManager] Failed to clear host recovery flag:", error);
		}
	}

	/**
	 * Check if user has host recovery flag for current session
	 * Used to detect host refresh scenario before sync
	 */
	hasHostRecoveryFlag(): boolean {
		if (!this.sessionId) return false;

		const key = `${HOST_RECOVERY_KEY_PREFIX}${this.sessionId}`;
		try {
			const storedUserId = localStorage.getItem(key);
			return storedUserId === this.userId;
		} catch {
			return false;
		}
	}

	/**
	 * Try to reclaim host status after page refresh
	 * Returns true if successfully reclaimed
	 */
	tryReclaimHost(): boolean {
		if (!this.sessionId) return false;

		const key = `${HOST_RECOVERY_KEY_PREFIX}${this.sessionId}`;
		try {
			const storedUserId = localStorage.getItem(key);
			if (!storedUserId || storedUserId !== this.userId) {
				return false;
			}

			// Check if we're still the registered host in Y.js
			const currentHostId = this.getCurrentHostId();
			if (currentHostId && currentHostId !== this.userId) {
				// Someone else is now host, clear our flag
				localStorage.removeItem(key);
				if (DEBUG) {
					console.log("[HostManager] Cannot reclaim - different host:", currentHostId);
				}
				return false;
			}

			// Reclaim host status
			this.setCurrentHostId(this.userId);
			localStorage.removeItem(key); // Clear flag after successful reclaim

			if (DEBUG) {
				console.log("[HostManager] Successfully reclaimed host status");
			}
			return true;
		} catch (error) {
			console.error("[HostManager] Failed to try reclaim host:", error);
			return false;
		}
	}

	/**
	 * Check if viewer can claim host (host is absent)
	 * For intentional leave: immediate claim allowed
	 * For disconnect: grace period applies
	 */
	canClaimHost(): boolean {
		// Already host
		if (this.isHost) return false;

		const currentHostId = this.getCurrentHostId();

		// No host set - can claim immediately
		if (!currentHostId) return true;

		// Check if host is connected via awareness
		if (this.isCurrentHostConnected()) {
			return false;
		}

		// Host not connected - check grace period
		const hostLastSeen = this.getHostLastSeen();
		if (!hostLastSeen) {
			// No hostLastSeen means intentional leave or old session - can claim
			return true;
		}

		const elapsed = Date.now() - hostLastSeen;
		return elapsed > DISCONNECT_GRACE_PERIOD;
	}

	/**
	 * Claim host status (viewer becomes host)
	 */
	claimHost(): boolean {
		if (!this.canClaimHost()) {
			if (DEBUG) {
				console.log("[HostManager] Cannot claim host - conditions not met");
			}
			return false;
		}

		this.setCurrentHostId(this.userId);

		if (DEBUG) {
			console.log("[HostManager] Successfully claimed host status");
		}
		return true;
	}

	/**
	 * Cleanup host state when intentionally leaving
	 * Clears currentHostId from Y.js so viewers know host left
	 */
	cleanupHostState(): void {
		if (!this.isHost) return;

		this.stopHostHeartbeat();

		const sessionMap = this.yjsProvider.getMap<any>("session");
		this.yjsProvider.getDoc().transact(() => {
			sessionMap.delete("currentHostId");
			sessionMap.delete("hostLastSeen");
		});

		this.isHost = false;
		this.clearHostRecoveryFlag();

		if (DEBUG) {
			console.log("[HostManager] Cleaned up host state on leave");
		}
	}

	/**
	 * Transfer host to another user
	 */
	transferHost(targetUserId: string): boolean {
		if (!this.isHost) {
			if (DEBUG) {
				console.log("[HostManager] Cannot transfer - not host");
			}
			return false;
		}

		// TODO: Validate target is connected via awareness

		this.stopHostHeartbeat();
		this.setCurrentHostId(targetUserId);
		this.isHost = false;

		if (DEBUG) {
			console.log("[HostManager] Transferred host to:", targetUserId);
		}
		return true;
	}

	/**
	 * Get transfer candidates (viewers sorted by joinedAt)
	 * NOTE: This method is deprecated. Use SessionManager.getTransferCandidates() instead.
	 * It coordinates between HostManager and ParticipantManager.
	 */
	getTransferCandidates(): string[] {
		// This is now handled by SessionManager which has access to ParticipantManager
		return [];
	}

	/**
	 * Check if beforeunload warning is needed
	 */
	getHostWarningNeeded(): boolean {
		if (!this.isHost) return false;

		// Check if there are other connected users
		const awareness = this.yjsProvider.getAwareness();
		const states = awareness.getStates();

		// More than just ourselves
		return states.size > 1;
	}

	/**
	 * Register callback for host changes
	 */
	onHostChanged(callback: (newHostId: string) => void): void {
		this.hostChangedCallbacks.push(callback);
	}

	/**
	 * Notify all host changed callbacks
	 */
	private notifyHostChanged(newHostId: string): void {
		for (const callback of this.hostChangedCallbacks) {
			callback(newHostId);
		}
	}

	/**
	 * Register callback for when host becomes absent (leaves)
	 */
	onHostAbsent(callback: () => void): void {
		this.hostAbsentCallbacks.push(callback);
	}

	/**
	 * Notify all host absent callbacks
	 */
	private notifyHostAbsent(): void {
		for (const callback of this.hostAbsentCallbacks) {
			callback();
		}
	}

	/**
	 * Get local isHost state
	 */
	getIsHost(): boolean {
		return this.isHost;
	}

	/**
	 * Set local isHost state (used by SessionManager)
	 */
	setIsHost(isHost: boolean): void {
		this.isHost = isHost;
		if (isHost) {
			this.startHostHeartbeat();
		} else {
			this.stopHostHeartbeat();
		}
	}

	/**
	 * Destroy and cleanup
	 */
	destroy(): void {
		this.stopHostHeartbeat();
		this.hostChangedCallbacks = [];
		this.hostAbsentCallbacks = [];
		this.sessionId = null;
		this.isHost = false;

		if (DEBUG) {
			console.log("[HostManager] Destroyed");
		}
	}
}
