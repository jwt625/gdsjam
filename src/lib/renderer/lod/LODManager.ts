import {
	LOD_CHANGE_COOLDOWN,
	LOD_DECREASE_THRESHOLD,
	LOD_INCREASE_THRESHOLD,
	LOD_MAX_DEPTH,
	LOD_MIN_DEPTH,
	LOD_ZOOM_IN_THRESHOLD,
	LOD_ZOOM_OUT_THRESHOLD,
} from "../../config";

/**
 * LODManager - Manages Level of Detail (LOD) system for rendering optimization
 *
 * Responsibilities:
 * - Track current LOD depth
 * - Monitor zoom changes and trigger re-renders when thresholds are crossed
 * - Adjust LOD depth based on polygon budget utilization
 * - Prevent thrashing with cooldown mechanism
 */
export class LODManager {
	private currentDepth = 0;
	private zoomThresholdLow = 0;
	private zoomThresholdHigh = 0;
	private lastLODChangeTime = 0;

	constructor(
		private maxPolygonsPerRender: number,
		private callbacks: {
			onDepthChange: (newDepth: number) => void;
			getBudgetUtilization: () => number;
			shouldRerenderOnZoomChange?: () => boolean; // Optional: check if re-render needed even without depth change (e.g., outline mode)
		},
	) {}

	/**
	 * Get current LOD depth
	 */
	getCurrentDepth(): number {
		return this.currentDepth;
	}

	/**
	 * Get scaled polygon budget based on current LOD depth
	 * Higher depths get larger budgets to accommodate more instances
	 */
	getScaledBudget(): number {
		const budgetMultipliers = [1, 1.5, 2, 2.5];
		const multiplier = budgetMultipliers[Math.min(this.currentDepth, 3)] ?? 1;
		return Math.floor(this.maxPolygonsPerRender * multiplier);
	}

	/**
	 * Get current zoom thresholds
	 */
	getZoomThresholds(): { low: number; high: number } {
		return {
			low: this.zoomThresholdLow,
			high: this.zoomThresholdHigh,
		};
	}

	/**
	 * Update zoom thresholds based on current zoom level
	 */
	updateZoomThresholds(currentZoom: number): void {
		this.zoomThresholdLow = currentZoom * LOD_ZOOM_OUT_THRESHOLD;
		this.zoomThresholdHigh = currentZoom * LOD_ZOOM_IN_THRESHOLD;
	}

	/**
	 * Check if zoom level has changed significantly (0.2x or 2.0x)
	 */
	hasZoomChangedSignificantly(currentZoom: number): boolean {
		// Check if we've crossed the low threshold (zoomed out significantly)
		if (currentZoom <= this.zoomThresholdLow) {
			return true;
		}

		// Check if we've crossed the high threshold (zoomed in significantly)
		if (currentZoom >= this.zoomThresholdHigh) {
			return true;
		}

		return false;
	}

	/**
	 * Check if LOD re-render should be triggered and execute if needed
	 * Returns true if re-render was triggered
	 */
	checkAndTriggerRerender(currentZoom: number, isRerendering: boolean): boolean {
		// Check if zoom has changed significantly
		if (!this.hasZoomChangedSignificantly(currentZoom)) {
			return false;
		}

		return this.triggerRerender(isRerendering);
	}

	/**
	 * Trigger LOD re-render based on budget utilization
	 * Returns true if re-render was triggered
	 */
	private triggerRerender(isRerendering: boolean): boolean {
		// Prevent re-render loops
		if (isRerendering) {
			return false;
		}

		// Check cooldown to prevent thrashing
		const now = performance.now();
		if (now - this.lastLODChangeTime < LOD_CHANGE_COOLDOWN) {
			return false;
		}

		// Calculate new LOD depth based on visible polygon count
		const utilization = this.callbacks.getBudgetUtilization();
		let newDepth = this.currentDepth;

		// If budget is underutilized (< 30%), increase depth to show more detail
		if (utilization < LOD_INCREASE_THRESHOLD && this.currentDepth < LOD_MAX_DEPTH) {
			newDepth = this.currentDepth + 1;
		}
		// If budget is overutilized (> 90%), decrease depth to improve performance
		else if (utilization > LOD_DECREASE_THRESHOLD && this.currentDepth > LOD_MIN_DEPTH) {
			newDepth = this.currentDepth - 1;
		}

		// Check if re-render is needed
		const depthChanged = newDepth !== this.currentDepth;
		const shouldRerenderAnyway = this.callbacks.shouldRerenderOnZoomChange?.() ?? false;
		const shouldRerender = depthChanged || shouldRerenderAnyway;

		if (shouldRerender) {
			this.currentDepth = newDepth;
			this.lastLODChangeTime = now;

			// Notify callback
			this.callbacks.onDepthChange(newDepth);
			return true;
		}

		return false;
	}
}
