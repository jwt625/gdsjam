import type { BoundingBox } from "../../../types/gds";

/**
 * ZoomLimits - Manages zoom scale constraints based on scale bar visibility
 *
 * Enforces zoom limits to ensure scale bar remains readable:
 * - Min zoom (zoomed out): scale bar shows 1 m
 * - Max zoom (zoomed in): scale bar shows 1 nm
 */
export class ZoomLimits {
	private static readonly MIN_ZOOM_SCALE_BAR_MICROMETERS = 1_000_000; // 1 m in µm
	private static readonly MAX_ZOOM_SCALE_BAR_MICROMETERS = 0.001; // 1 nm in µm

	/**
	 * Calculate minimum allowed zoom scale based on scale bar constraint
	 * Min zoom (zoomed out): scale bar shows 1 m
	 */
	getMinZoomScale(
		viewportBounds: BoundingBox,
		currentScale: number,
		documentUnits: { database: number; user: number },
	): number {
		const viewWidthDB = viewportBounds.maxX - viewportBounds.minX;

		// If no valid bounds, return a very small scale
		if (viewWidthDB <= 0) {
			return 0.00001;
		}

		// Convert database units to micrometers
		// Coordinates are in database units, so: db_units * (database meters) / 1e-6 = micrometers
		const viewWidthMicrometers = (viewWidthDB * documentUnits.database) / 1e-6;

		// Calculate the scale bar width that would be shown at current viewport width
		// Scale bar width is calculated as: 10^floor(log10(viewWidth / 4))
		// We want the scale bar to be at most MIN_ZOOM_SCALE_BAR_MICROMETERS (1 m = 1,000,000 µm)
		// So: 10^floor(log10(viewWidth / 4)) <= 1,000,000
		// This means: viewWidth / 4 <= 1,000,000
		// So: viewWidth <= 4,000,000 µm
		const maxViewWidthMicrometers = ZoomLimits.MIN_ZOOM_SCALE_BAR_MICROMETERS * 4;

		// Calculate minimum scale: current scale * (current view width / max view width)
		const minScale = currentScale * (viewWidthMicrometers / maxViewWidthMicrometers);

		return minScale;
	}

	/**
	 * Calculate maximum allowed zoom scale based on scale bar constraint
	 * Max zoom (zoomed in): scale bar shows 1 nm
	 */
	getMaxZoomScale(
		viewportBounds: BoundingBox,
		currentScale: number,
		documentUnits: { database: number; user: number },
	): number {
		const viewWidthDB = viewportBounds.maxX - viewportBounds.minX;

		// If no valid bounds, return a very large scale
		if (viewWidthDB <= 0) {
			return 100000;
		}

		// Convert database units to micrometers
		// Coordinates are in database units, so: db_units * (database meters) / 1e-6 = micrometers
		const viewWidthMicrometers = (viewWidthDB * documentUnits.database) / 1e-6;

		// We want the scale bar to be at least 1 nm (0.001 µm)
		// So: 10^floor(log10(viewWidth / 4)) >= 0.001
		// This means: viewWidth / 4 >= 0.001
		// So: viewWidth >= 0.004 µm
		const minViewWidthMicrometers = ZoomLimits.MAX_ZOOM_SCALE_BAR_MICROMETERS * 4;

		// Calculate maximum scale: current scale * (current view width / min view width)
		const maxScale = currentScale * (viewWidthMicrometers / minViewWidthMicrometers);

		return maxScale;
	}

	/**
	 * Clamp zoom scale to respect min/max limits
	 */
	clampZoomScale(
		newScale: number,
		viewportBounds: BoundingBox,
		currentScale: number,
		documentUnits: { database: number; user: number },
	): number {
		const minScale = this.getMinZoomScale(viewportBounds, currentScale, documentUnits);
		const maxScale = this.getMaxZoomScale(viewportBounds, currentScale, documentUnits);

		return Math.max(minScale, Math.min(maxScale, newScale));
	}
}
