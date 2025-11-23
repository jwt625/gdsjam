import { describe, expect, it } from "vitest";
import { ZoomLimits } from "../../src/lib/renderer/lod/ZoomLimits";
import type { BoundingBox } from "../../src/types/gds";

describe("ZoomLimits", () => {
	const zoomLimits = new ZoomLimits();
	const documentUnits = { database: 1e-9, user: 1e-6 }; // 1 db unit = 1nm, 1 user unit = 1µm

	// Helper to create viewport bounds
	const createViewportBounds = (width: number, height: number): BoundingBox => ({
		minX: 0,
		minY: 0,
		maxX: width,
		maxY: height,
	});

	describe("getMaxZoomScale", () => {
		it("should enforce 1nm (0.001µm) max zoom (closest)", () => {
			const viewportBounds = createViewportBounds(1000, 1000);
			const currentScale = 1.0;

			const maxScale = zoomLimits.getMaxZoomScale(viewportBounds, currentScale, documentUnits);

			// At max zoom, scale bar should show 1nm = 0.001µm
			// viewWidthDB = 1000 (in database units, which are 1nm each)
			// viewWidthMicrometers = 1000 * 1e-9 / 1e-6 = 0.001 µm
			// minViewWidthMicrometers = 0.001 * 4 = 0.004 µm
			// maxScale = currentScale * (viewWidthMicrometers / minViewWidthMicrometers)
			// maxScale = 1.0 * (0.001 / 0.004) = 250
			expect(maxScale).toBeCloseTo(250, 2);
		});

		it("should scale with viewport width", () => {
			const viewportBounds1 = createViewportBounds(800, 600);
			const viewportBounds2 = createViewportBounds(1600, 1200);
			const currentScale = 1.0;

			const maxScale1 = zoomLimits.getMaxZoomScale(viewportBounds1, currentScale, documentUnits);
			const maxScale2 = zoomLimits.getMaxZoomScale(viewportBounds2, currentScale, documentUnits);

			// Wider viewport should allow higher max zoom
			expect(maxScale2).toBeGreaterThan(maxScale1);
		});
	});

	describe("getMinZoomScale", () => {
		it("should enforce 1m (1,000,000µm) min zoom (farthest)", () => {
			const viewportBounds = createViewportBounds(1000, 1000);
			const currentScale = 1.0;

			const minScale = zoomLimits.getMinZoomScale(viewportBounds, currentScale, documentUnits);

			// At min zoom, scale bar should show 1m = 1,000,000µm
			// viewWidthDB = 1000 (in database units, which are 1nm each)
			// viewWidthMicrometers = 1000 * 1e-9 / 1e-6 = 1 µm
			// maxViewWidthMicrometers = 1000000 * 4 = 4,000,000 µm
			// minScale = currentScale * (viewWidthMicrometers / maxViewWidthMicrometers)
			// minScale = 1.0 * (1 / 4000000) = 2.5e-7
			expect(minScale).toBeCloseTo(2.5e-7, 10);
		});

		it("should scale with viewport width", () => {
			const viewportBounds1 = createViewportBounds(800, 600);
			const viewportBounds2 = createViewportBounds(1600, 1200);
			const currentScale = 1.0;

			const minScale1 = zoomLimits.getMinZoomScale(viewportBounds1, currentScale, documentUnits);
			const minScale2 = zoomLimits.getMinZoomScale(viewportBounds2, currentScale, documentUnits);

			// Wider viewport means you can see more, so you need HIGHER min zoom (can't zoom out as far)
			expect(minScale2).toBeGreaterThan(minScale1);
		});
	});

	describe("clampZoomScale", () => {
		it("should clamp zoom above max zoom", () => {
			const viewportBounds = createViewportBounds(1000, 1000);
			const currentScale = 1.0;
			const tooHighScale = 1000.0; // Above max (max is ~250)

			const clamped = zoomLimits.clampZoomScale(
				tooHighScale,
				viewportBounds,
				currentScale,
				documentUnits,
			);

			const maxScale = zoomLimits.getMaxZoomScale(viewportBounds, currentScale, documentUnits);
			expect(clamped).toBe(maxScale);
		});

		it("should clamp zoom below min zoom", () => {
			const viewportBounds = createViewportBounds(1000, 1000);
			const currentScale = 1.0;
			const tooLowScale = 1e-15; // Below min (min is ~2.5e-10)

			const clamped = zoomLimits.clampZoomScale(
				tooLowScale,
				viewportBounds,
				currentScale,
				documentUnits,
			);

			const minScale = zoomLimits.getMinZoomScale(viewportBounds, currentScale, documentUnits);
			expect(clamped).toBe(minScale);
		});

		it("should not clamp zoom within limits", () => {
			const viewportBounds = createViewportBounds(1000, 1000);
			const currentScale = 1.0;
			const validScale = 0.1; // Within limits (between ~2.5e-10 and ~0.25)

			const clamped = zoomLimits.clampZoomScale(
				validScale,
				viewportBounds,
				currentScale,
				documentUnits,
			);

			expect(clamped).toBe(validScale);
		});

		it("should handle different document units", () => {
			const viewportBounds = createViewportBounds(1000, 1000);
			const currentScale = 1.0;
			const customUnits = { database: 1e-6, user: 1e-3 }; // Different scale

			const maxScale = zoomLimits.getMaxZoomScale(viewportBounds, currentScale, customUnits);
			const minScale = zoomLimits.getMinZoomScale(viewportBounds, currentScale, customUnits);

			expect(maxScale).toBeGreaterThan(0);
			expect(minScale).toBeGreaterThan(0);
			expect(maxScale).toBeGreaterThan(minScale);
		});
	});
});
