import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	LOD_CHANGE_COOLDOWN,
	LOD_DECREASE_THRESHOLD,
	LOD_INCREASE_THRESHOLD,
	LOD_MAX_DEPTH,
	LOD_MIN_DEPTH,
} from "../../src/lib/config";
import { LODManager } from "../../src/lib/renderer/lod/LODManager";

describe("LODManager", () => {
	let callbacks: {
		onDepthChange: ReturnType<typeof vi.fn>;
		getBudgetUtilization: ReturnType<typeof vi.fn>;
		shouldRerenderOnZoomChange?: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		callbacks = {
			onDepthChange: vi.fn(),
			getBudgetUtilization: vi.fn(),
			shouldRerenderOnZoomChange: vi.fn(),
		};
	});

	describe("getCurrentDepth", () => {
		it("should return initial depth of 0", () => {
			const manager = new LODManager(100000, callbacks);
			expect(manager.getCurrentDepth()).toBe(0);
		});
	});

	describe("getScaledBudget", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should return base budget at depth 0", () => {
			const manager = new LODManager(100000, callbacks);
			expect(manager.getScaledBudget()).toBe(100000);
		});

		it("should return 1.5x budget at depth 1", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.2); // Low utilization
			manager.updateZoomThresholds(1.0);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100); // Advance past initial cooldown
			manager.checkAndTriggerRerender(2.5, false); // Trigger depth increase

			expect(manager.getCurrentDepth()).toBe(1);
			expect(manager.getScaledBudget()).toBe(150000);
		});

		it("should return 2x budget at depth 2", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.2);
			manager.updateZoomThresholds(1.0);

			// Increase to depth 1
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);
			manager.checkAndTriggerRerender(2.5, false);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);

			// Increase to depth 2
			manager.updateZoomThresholds(2.5);
			manager.checkAndTriggerRerender(6.0, false);

			expect(manager.getCurrentDepth()).toBe(2);
			expect(manager.getScaledBudget()).toBe(200000);
		});

		it("should return 2.5x budget at depth 3", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.2);
			manager.updateZoomThresholds(1.0);

			// Increase to depth 3 (max)
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100); // Initial cooldown

			// Depth 0 → 1
			manager.checkAndTriggerRerender(2.5, false);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);
			manager.updateZoomThresholds(2.5);

			// Depth 1 → 2
			manager.checkAndTriggerRerender(6.0, false);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);
			manager.updateZoomThresholds(6.0);

			// Depth 2 → 3
			manager.checkAndTriggerRerender(15.0, false);

			expect(manager.getCurrentDepth()).toBe(3);
			expect(manager.getScaledBudget()).toBe(250000);
		});
	});

	describe("updateZoomThresholds", () => {
		it("should set low threshold to 0.2x current zoom", () => {
			const manager = new LODManager(100000, callbacks);
			manager.updateZoomThresholds(1.0);

			const thresholds = manager.getZoomThresholds();
			expect(thresholds.low).toBe(0.2);
		});

		it("should set high threshold to 2.0x current zoom", () => {
			const manager = new LODManager(100000, callbacks);
			manager.updateZoomThresholds(1.0);

			const thresholds = manager.getZoomThresholds();
			expect(thresholds.high).toBe(2.0);
		});
	});

	describe("hasZoomChangedSignificantly", () => {
		it("should return true when zoomed out past low threshold", () => {
			const manager = new LODManager(100000, callbacks);
			manager.updateZoomThresholds(1.0); // low = 0.2, high = 2.0

			expect(manager.hasZoomChangedSignificantly(0.15)).toBe(true);
		});

		it("should return true when zoomed in past high threshold", () => {
			const manager = new LODManager(100000, callbacks);
			manager.updateZoomThresholds(1.0); // low = 0.2, high = 2.0

			expect(manager.hasZoomChangedSignificantly(2.5)).toBe(true);
		});

		it("should return false when zoom is within thresholds", () => {
			const manager = new LODManager(100000, callbacks);
			manager.updateZoomThresholds(1.0); // low = 0.2, high = 2.0

			expect(manager.hasZoomChangedSignificantly(0.5)).toBe(false);
			expect(manager.hasZoomChangedSignificantly(1.0)).toBe(false);
			expect(manager.hasZoomChangedSignificantly(1.5)).toBe(false);
		});
	});

	describe("checkAndTriggerRerender", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should not trigger rerender if zoom has not changed significantly", () => {
			const manager = new LODManager(100000, callbacks);
			manager.updateZoomThresholds(1.0);

			const triggered = manager.checkAndTriggerRerender(1.0, false);

			expect(triggered).toBe(false);
			expect(callbacks.onDepthChange).not.toHaveBeenCalled();
		});

		it("should increase depth when budget utilization < 30%", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.25); // 25% utilization
			manager.updateZoomThresholds(1.0);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100); // Advance past initial cooldown

			const triggered = manager.checkAndTriggerRerender(2.5, false);

			expect(triggered).toBe(true);
			expect(callbacks.onDepthChange).toHaveBeenCalledWith(1);
			expect(manager.getCurrentDepth()).toBe(1);
		});

		it("should decrease depth when budget utilization > 90%", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.2);
			manager.updateZoomThresholds(1.0);

			// First increase to depth 1
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100); // Advance past initial cooldown
			manager.checkAndTriggerRerender(2.5, false);
			expect(manager.getCurrentDepth()).toBe(1);

			// Wait for cooldown
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);
			manager.updateZoomThresholds(2.5);

			// Now decrease with high utilization
			callbacks.getBudgetUtilization.mockReturnValue(0.95); // 95% utilization
			const triggered = manager.checkAndTriggerRerender(0.4, false);

			expect(triggered).toBe(true);
			expect(manager.getCurrentDepth()).toBe(0);
		});

		it("should not exceed max depth", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.1); // Very low utilization
			manager.updateZoomThresholds(1.0);

			// Try to increase beyond max depth
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100); // Initial cooldown

			// Depth 0 → 1
			manager.checkAndTriggerRerender(2.5, false);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);
			manager.updateZoomThresholds(2.5);

			// Depth 1 → 2
			manager.checkAndTriggerRerender(6.0, false);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);
			manager.updateZoomThresholds(6.0);

			// Depth 2 → 3
			manager.checkAndTriggerRerender(15.0, false);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);
			manager.updateZoomThresholds(15.0);

			// Try to go beyond max depth (should stay at 3)
			manager.checkAndTriggerRerender(40.0, false);

			expect(manager.getCurrentDepth()).toBe(LOD_MAX_DEPTH);
		});

		it("should not go below min depth", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.95); // High utilization
			manager.updateZoomThresholds(1.0);

			// Try to decrease below min depth
			const triggered = manager.checkAndTriggerRerender(0.1, false);

			expect(triggered).toBe(false); // No change since already at min
			expect(manager.getCurrentDepth()).toBe(LOD_MIN_DEPTH);
		});

		it("should respect cooldown period", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.2);
			manager.updateZoomThresholds(1.0);

			// First trigger
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100); // Advance past initial cooldown
			const triggered1 = manager.checkAndTriggerRerender(2.5, false);
			expect(triggered1).toBe(true);
			expect(manager.getCurrentDepth()).toBe(1);

			// Immediate second trigger (should be blocked by cooldown)
			manager.updateZoomThresholds(2.5);
			const triggered2 = manager.checkAndTriggerRerender(6.0, false);
			expect(triggered2).toBe(false);
			expect(manager.getCurrentDepth()).toBe(1); // No change

			// After cooldown
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100);
			const triggered3 = manager.checkAndTriggerRerender(6.0, false);
			expect(triggered3).toBe(true);
			expect(manager.getCurrentDepth()).toBe(2);
		});

		it("should not trigger if already rerendering", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.2);
			manager.updateZoomThresholds(1.0);

			const triggered = manager.checkAndTriggerRerender(2.5, true); // isRerendering = true

			expect(triggered).toBe(false);
			expect(callbacks.onDepthChange).not.toHaveBeenCalled();
		});

		it("should trigger rerender in outline mode even without depth change", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.5); // Mid utilization (no depth change)
			callbacks.shouldRerenderOnZoomChange!.mockReturnValue(true); // Outline mode
			manager.updateZoomThresholds(1.0);
			vi.advanceTimersByTime(LOD_CHANGE_COOLDOWN + 100); // Advance past initial cooldown

			const triggered = manager.checkAndTriggerRerender(2.5, false);

			expect(triggered).toBe(true);
			expect(callbacks.onDepthChange).toHaveBeenCalled();
		});

		it("should not trigger rerender without depth change in fill mode", () => {
			const manager = new LODManager(100000, callbacks);
			callbacks.getBudgetUtilization.mockReturnValue(0.5); // Mid utilization (no depth change)
			callbacks.shouldRerenderOnZoomChange!.mockReturnValue(false); // Fill mode
			manager.updateZoomThresholds(1.0);

			const triggered = manager.checkAndTriggerRerender(2.5, false);

			expect(triggered).toBe(false);
			expect(callbacks.onDepthChange).not.toHaveBeenCalled();
		});
	});
});
