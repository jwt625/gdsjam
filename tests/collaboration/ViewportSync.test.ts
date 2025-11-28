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
			const sync = new ViewportSync(mockProvider as any, "viewer-user", callbacks);

			// Set up host's broadcast
			mockProvider._sessionMapData.set("broadcastEnabled", true);
			mockProvider._sessionMapData.set("broadcastHostId", "host-user");

			// Add host viewport to awareness
			mockProvider._awarenessStates.set(1, {
				userId: "host-user",
				viewport: { x: 100, y: 200, scale: 1.5, width: 1920, height: 1080, updatedAt: Date.now() },
			});

			// Trigger awareness change
			mockProvider._triggerAwarenessChange();

			expect(callbacks.onHostViewportChanged).toHaveBeenCalled();
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
});
