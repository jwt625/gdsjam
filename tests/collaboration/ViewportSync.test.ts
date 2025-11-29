/**
 * ViewportSync Tests
 *
 * Tests for viewport synchronization between host and followers
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportSyncCallbacks } from "../../src/lib/collaboration/ViewportSync";
import { ViewportSync } from "../../src/lib/collaboration/ViewportSync";

// Mock YjsProvider
const createMockYjsProvider = () => {
	const sessionMapData = new Map<string, unknown>();
	const awarenessStates = new Map<number, Record<string, unknown>>();
	const sessionMapObservers: Array<(event: { keysChanged: Set<string> }) => void> = [];
	const awarenessListeners: Array<(changes: unknown) => void> = [];

	let localAwarenessState: Record<string, unknown> = {};

	return {
		getDoc: () => ({
			transact: (fn: () => void) => fn(),
		}),
		getMap: <T>(_name: string) => ({
			get: (key: string) => sessionMapData.get(key) as T | undefined,
			set: (key: string, value: T) => {
				sessionMapData.set(key, value);
				// Notify observers
				for (const observer of sessionMapObservers) {
					observer({ keysChanged: new Set([key]) });
				}
			},
			delete: (key: string) => {
				sessionMapData.delete(key);
				for (const observer of sessionMapObservers) {
					observer({ keysChanged: new Set([key]) });
				}
			},
			observe: (callback: (event: { keysChanged: Set<string> }) => void) => {
				sessionMapObservers.push(callback);
			},
		}),
		getAwareness: () => ({
			getLocalState: () => localAwarenessState,
			setLocalState: (state: Record<string, unknown>) => {
				localAwarenessState = state;
			},
			getStates: () => awarenessStates,
			on: (_event: string, callback: () => void) => {
				awarenessListeners.push(callback);
			},
		}),
		// Test helpers
		_sessionMapData: sessionMapData,
		_awarenessStates: awarenessStates,
		_setLocalAwarenessState: (state: Record<string, unknown>) => {
			localAwarenessState = state;
		},
		_triggerAwarenessChange: () => {
			for (const listener of awarenessListeners) {
				listener({});
			}
		},
	};
};

describe("ViewportSync", () => {
	let mockProvider: ReturnType<typeof createMockYjsProvider>;
	let callbacks: ViewportSyncCallbacks;

	beforeEach(() => {
		vi.useFakeTimers();
		mockProvider = createMockYjsProvider();
		callbacks = {
			onHostViewportChanged: vi.fn(),
			onBroadcastStateChanged: vi.fn(),
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("constructor", () => {
		it("should initialize with given userId", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			expect(sync).toBeDefined();
		});
	});

	describe("enableBroadcast / disableBroadcast", () => {
		it("should set broadcastEnabled and broadcastHostId when enabling", () => {
			const sync = new ViewportSync(mockProvider as any, "host-user", callbacks);

			sync.enableBroadcast();

			expect(mockProvider._sessionMapData.get("broadcastEnabled")).toBe(true);
			expect(mockProvider._sessionMapData.get("broadcastHostId")).toBe("host-user");
		});

		it("should clear broadcastHostId when disabling", () => {
			const sync = new ViewportSync(mockProvider as any, "host-user", callbacks);

			sync.enableBroadcast();
			sync.disableBroadcast();

			expect(mockProvider._sessionMapData.get("broadcastEnabled")).toBe(false);
			expect(mockProvider._sessionMapData.has("broadcastHostId")).toBe(false);
		});
	});

	describe("isBroadcastEnabled", () => {
		it("should return false when broadcast is not enabled", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			expect(sync.isBroadcastEnabled()).toBe(false);
		});

		it("should return true when broadcast is enabled", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			sync.enableBroadcast();
			expect(sync.isBroadcastEnabled()).toBe(true);
		});
	});

	describe("getBroadcastHostId", () => {
		it("should return null when no broadcast host", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			expect(sync.getBroadcastHostId()).toBeNull();
		});

		it("should return host id when broadcast enabled", () => {
			const sync = new ViewportSync(mockProvider as any, "host-user", callbacks);
			sync.enableBroadcast();
			expect(sync.getBroadcastHostId()).toBe("host-user");
		});
	});

	describe("setScreenDimensions", () => {
		it("should store screen dimensions for viewport broadcast", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			sync.setScreenDimensions(1920, 1080);
			// Dimensions are used internally for broadcastViewport
			expect(sync).toBeDefined();
		});
	});

	describe("broadcastViewport", () => {
		it("should throttle broadcasts to 200ms", () => {
			const sync = new ViewportSync(mockProvider as any, "host-user", callbacks);
			sync.setScreenDimensions(1920, 1080);
			sync.enableBroadcast();

			// First broadcast should go through immediately
			sync.broadcastViewport(100, 200, 1.5);
			const state1 = mockProvider.getAwareness().getLocalState();
			expect(state1.viewport).toBeDefined();

			// Second broadcast within 200ms should be pending
			sync.broadcastViewport(150, 250, 2.0);

			// Advance time past throttle
			vi.advanceTimersByTime(200);

			const state2 = mockProvider.getAwareness().getLocalState();
			expect((state2.viewport as any)?.x).toBe(150);
			expect((state2.viewport as any)?.y).toBe(250);
			expect((state2.viewport as any)?.scale).toBe(2.0);
		});
	});

	describe("getHostViewport", () => {
		it("should return null when no broadcast host", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			expect(sync.getHostViewport()).toBeNull();
		});

		it("should return host viewport from awareness states", () => {
			const sync = new ViewportSync(mockProvider as any, "viewer-user", callbacks);

			// Set up host's awareness state
			mockProvider._awarenessStates.set(1, {
				userId: "host-user",
				viewport: { x: 100, y: 200, scale: 1.5, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			// Enable broadcast from host
			mockProvider._sessionMapData.set("broadcastEnabled", true);
			mockProvider._sessionMapData.set("broadcastHostId", "host-user");

			const viewport = sync.getHostViewport();
			expect(viewport).not.toBeNull();
			expect(viewport?.x).toBe(100);
			expect(viewport?.y).toBe(200);
			expect(viewport?.scale).toBe(1.5);
		});
	});

	describe("callbacks", () => {
		it("should call onBroadcastStateChanged when broadcast state changes", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);

			sync.enableBroadcast();

			expect(callbacks.onBroadcastStateChanged).toHaveBeenCalledWith(true, "user-123");
		});

		it("should call onHostViewportChanged when host viewport updates (for non-host)", () => {
			// Set up as viewer
			new ViewportSync(mockProvider as any, "viewer-user", callbacks);

			// Set up host's broadcast
			mockProvider._sessionMapData.set("broadcastEnabled", true);
			mockProvider._sessionMapData.set("broadcastHostId", "host-user");

			// Add host viewport to awareness with broadcastEnabled for P2 heartbeat
			mockProvider._awarenessStates.set(1, {
				userId: "host-user",
				isHost: true,
				broadcastEnabled: true, // P2 heartbeat
				viewport: { x: 100, y: 200, scale: 1.5, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			// Trigger awareness change
			mockProvider._triggerAwarenessChange();

			expect(callbacks.onHostViewportChanged).toHaveBeenCalled();
		});

		it("should notify current broadcast state when called after sync", () => {
			// Set up existing broadcast before viewer joins
			mockProvider._sessionMapData.set("broadcastEnabled", true);
			mockProvider._sessionMapData.set("broadcastHostId", "host-user");

			// Create sync as a late-joining viewer
			const sync = new ViewportSync(mockProvider as any, "late-viewer", callbacks);

			// Should NOT have been called during construction
			expect(callbacks.onBroadcastStateChanged).not.toHaveBeenCalled();

			// Simulate calling after Y.js sync completes
			sync.notifyCurrentBroadcastState();

			// Now should have been called with the broadcast state
			expect(callbacks.onBroadcastStateChanged).toHaveBeenCalledWith(true, "host-user");
		});

		it("should not notify when broadcast is disabled", () => {
			// No broadcast set up

			// Create sync
			const sync = new ViewportSync(mockProvider as any, "viewer-user", callbacks);

			// Call notify
			sync.notifyCurrentBroadcastState();

			// Should NOT have been called (broadcast not enabled)
			expect(callbacks.onBroadcastStateChanged).not.toHaveBeenCalled();
		});

		it("should re-broadcast state when rebroadcastState is called", () => {
			// Enable broadcast first
			const sync = new ViewportSync(mockProvider as any, "host-user", callbacks);
			sync.enableBroadcast();

			// Clear the mock calls
			vi.clearAllMocks();

			// Call rebroadcast
			sync.rebroadcastState();

			// Should have set the session map values again
			expect(mockProvider._sessionMapData.get("broadcastEnabled")).toBe(true);
			expect(mockProvider._sessionMapData.get("broadcastHostId")).toBe("host-user");
		});

		it("should not re-broadcast if broadcast is not enabled", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);

			// Call rebroadcast without enabling
			sync.rebroadcastState();

			// Should NOT have set any values
			expect(mockProvider._sessionMapData.has("broadcastEnabled")).toBe(false);
		});
	});

	describe("destroy", () => {
		it("should clean up throttle timeout", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			sync.destroy();
			// No error should be thrown
			expect(sync).toBeDefined();
		});
	});

	describe("broadcastOwnViewport", () => {
		it("should broadcast viewport via awareness", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			sync.setScreenDimensions(1920, 1080);

			sync.broadcastOwnViewport(100, 200, 1.5);

			const state = mockProvider.getAwareness().getLocalState();
			expect(state.viewport).toBeDefined();
			expect((state.viewport as any).x).toBe(100);
			expect((state.viewport as any).y).toBe(200);
			expect((state.viewport as any).scale).toBe(1.5);
			expect((state.viewport as any).width).toBe(1920);
			expect((state.viewport as any).height).toBe(1080);
		});

		it("should throttle broadcasts to 200ms", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			sync.setScreenDimensions(1920, 1080);

			// First broadcast should go through immediately
			sync.broadcastOwnViewport(100, 200, 1.5);
			const state1 = mockProvider.getAwareness().getLocalState();
			expect((state1.viewport as any).x).toBe(100);

			// Second broadcast within 200ms should be pending
			sync.broadcastOwnViewport(150, 250, 2.0);
			const state2 = mockProvider.getAwareness().getLocalState();
			expect((state2.viewport as any).x).toBe(100); // Still old value

			// Advance time past throttle
			vi.advanceTimersByTime(200);

			const state3 = mockProvider.getAwareness().getLocalState();
			expect((state3.viewport as any).x).toBe(150);
			expect((state3.viewport as any).y).toBe(250);
			expect((state3.viewport as any).scale).toBe(2.0);
		});

		it("should not require broadcast mode to be enabled", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			sync.setScreenDimensions(1920, 1080);

			// Don't enable broadcast mode
			sync.broadcastOwnViewport(100, 200, 1.5);

			const state = mockProvider.getAwareness().getLocalState();
			expect(state.viewport).toBeDefined();
			// broadcastEnabled should NOT be set
			expect(state.broadcastEnabled).toBeUndefined();
		});
	});

	describe("getParticipantViewports", () => {
		it("should return empty array when no participants have viewports", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);
			expect(sync.getParticipantViewports()).toEqual([]);
		});

		it("should exclude self from participant viewports", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);

			// Add self to awareness
			mockProvider._awarenessStates.set(1, {
				userId: "user-123",
				displayName: "Self User",
				color: "#ff0000",
				viewport: { x: 100, y: 200, scale: 1.5, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			const viewports = sync.getParticipantViewports();
			expect(viewports).toEqual([]);
		});

		it("should return other participants viewports", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);

			// Add another participant
			mockProvider._awarenessStates.set(2, {
				userId: "other-user",
				displayName: "Other User",
				color: "#00ff00",
				viewport: { x: 300, y: 400, scale: 2.0, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			const viewports = sync.getParticipantViewports();
			expect(viewports).toHaveLength(1);
			expect(viewports[0].userId).toBe("other-user");
			expect(viewports[0].displayName).toBe("Other User");
			expect(viewports[0].color).toBe("#00ff00");
			expect(viewports[0].viewport.x).toBe(300);
		});

		it("should mark followed user correctly", () => {
			const sync = new ViewportSync(mockProvider as any, "viewer-user", callbacks);

			// Set up broadcast host in session map (P0)
			mockProvider._sessionMapData.set("broadcastEnabled", true);
			mockProvider._sessionMapData.set("broadcastHostId", "host-user");

			// Add host to awareness with isHost and broadcastEnabled (P2 heartbeat)
			mockProvider._awarenessStates.set(1, {
				userId: "host-user",
				displayName: "Host User",
				color: "#ff0000",
				isHost: true, // Required for P2 heartbeat detection
				broadcastEnabled: true, // P2 heartbeat
				viewport: { x: 100, y: 200, scale: 1.5, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			// Add another participant
			mockProvider._awarenessStates.set(2, {
				userId: "other-user",
				displayName: "Other User",
				color: "#00ff00",
				viewport: { x: 300, y: 400, scale: 2.0, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			const viewports = sync.getParticipantViewports();
			expect(viewports).toHaveLength(2);

			const hostViewport = viewports.find((v) => v.userId === "host-user");
			const otherViewport = viewports.find((v) => v.userId === "other-user");

			expect(hostViewport?.isFollowed).toBe(true);
			expect(otherViewport?.isFollowed).toBe(false);
		});

		it("should use default values for missing displayName and color", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);

			// Add participant with missing displayName and color
			mockProvider._awarenessStates.set(2, {
				userId: "other-user",
				viewport: { x: 100, y: 200, scale: 1.0, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			const viewports = sync.getParticipantViewports();
			expect(viewports).toHaveLength(1);
			expect(viewports[0].displayName).toBe("Unknown");
			expect(viewports[0].color).toBe("#888888");
		});

		it("should skip participants without viewport data", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);

			// Add participant without viewport
			mockProvider._awarenessStates.set(2, {
				userId: "other-user",
				displayName: "Other User",
				color: "#00ff00",
				// No viewport
			});

			const viewports = sync.getParticipantViewports();
			expect(viewports).toEqual([]);
		});

		it("should skip participants without userId", () => {
			const sync = new ViewportSync(mockProvider as any, "user-123", callbacks);

			// Add incomplete participant data
			mockProvider._awarenessStates.set(2, {
				viewport: { x: 100, y: 200, scale: 1.0, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			const viewports = sync.getParticipantViewports();
			expect(viewports).toEqual([]);
		});
	});

	describe("onParticipantViewportsChanged callback", () => {
		it("should call callback when awareness changes", () => {
			const onParticipantViewportsChanged = vi.fn();
			const callbacksWithParticipants = {
				...callbacks,
				onParticipantViewportsChanged,
			};

			new ViewportSync(mockProvider as any, "user-123", callbacksWithParticipants);

			// Add a participant
			mockProvider._awarenessStates.set(2, {
				userId: "other-user",
				displayName: "Other User",
				color: "#00ff00",
				viewport: { x: 100, y: 200, scale: 1.0, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			// Trigger awareness change
			mockProvider._triggerAwarenessChange();

			expect(onParticipantViewportsChanged).toHaveBeenCalled();
			const calledViewports = onParticipantViewportsChanged.mock.calls[0][0];
			expect(calledViewports).toHaveLength(1);
			expect(calledViewports[0].userId).toBe("other-user");
		});
	});

	describe("P1 follow override", () => {
		it("should start with undefined override", () => {
			const sync = new ViewportSync(mockProvider as any, "viewer-user", callbacks);
			expect(sync.getFollowOverride()).toBeUndefined();
		});

		it("should set P1 override when setFollowOverride is called", () => {
			const sync = new ViewportSync(mockProvider as any, "viewer-user", callbacks);
			sync.setFollowOverride(false);
			expect(sync.getFollowOverride()).toBe(false);

			sync.setFollowOverride(true);
			expect(sync.getFollowOverride()).toBe(true);
		});

		it("should reset P1 override on P0 broadcast state change", () => {
			const sync = new ViewportSync(mockProvider as any, "viewer-user", callbacks);

			// Set P1 override
			sync.setFollowOverride(false);
			expect(sync.getFollowOverride()).toBe(false);

			// Trigger P0 change by enabling broadcast (uses getMap().set which notifies observers)
			sync.enableBroadcast();

			// P1 should be reset to undefined
			expect(sync.getFollowOverride()).toBeUndefined();
		});

		it("should not call onBroadcastStateChanged on P2 heartbeat when P1 override is set", () => {
			const sync = new ViewportSync(mockProvider as any, "viewer-user", callbacks);

			// Set P1 override to false (viewer manually disabled following)
			sync.setFollowOverride(false);

			// Clear previous calls
			vi.clearAllMocks();

			// Add host with broadcast enabled in awareness
			mockProvider._sessionMapData.set("broadcastEnabled", true);
			mockProvider._sessionMapData.set("broadcastHostId", "host-user");
			mockProvider._awarenessStates.set(1, {
				userId: "host-user",
				isHost: true,
				broadcastEnabled: true,
			});

			// Trigger awareness change (P2 heartbeat)
			mockProvider._triggerAwarenessChange();

			// Should NOT call onBroadcastStateChanged because P1 override is set
			expect(callbacks.onBroadcastStateChanged).not.toHaveBeenCalled();
		});
	});
});
