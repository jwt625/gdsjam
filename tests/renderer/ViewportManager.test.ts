import type { Graphics } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViewportManager } from "../../src/lib/renderer/viewport/ViewportManager";
import type { RTreeItem } from "../../src/lib/spatial/RTree";

describe("ViewportManager", () => {
	let viewportManager: ViewportManager;
	let spatialIndex: any; // Mock spatial index
	let getLayerVisibility: ReturnType<typeof vi.fn>;
	let mockGraphicsItems: RTreeItem[];

	beforeEach(() => {
		// Create mock layer visibility function
		getLayerVisibility = vi.fn(() => {
			const map = new Map<string, boolean>();
			map.set("1:0", true);
			map.set("2:0", true);
			map.set("3:0", true);
			return map;
		});

		// Create mock graphics items
		mockGraphicsItems = [
			{
				id: "item1",
				minX: 0,
				minY: 0,
				maxX: 100,
				maxY: 100,
				type: "tile" as const,
				layer: 1,
				datatype: 0,
				polygonCount: 5,
				data: { visible: false } as Graphics,
			},
			{
				id: "item2",
				minX: 200,
				minY: 200,
				maxX: 300,
				maxY: 300,
				type: "tile" as const,
				layer: 2,
				datatype: 0,
				polygonCount: 3,
				data: { visible: false } as Graphics,
			},
			{
				id: "item3",
				minX: 500,
				minY: 500,
				maxX: 600,
				maxY: 600,
				type: "tile" as const,
				layer: 3,
				datatype: 0,
				polygonCount: 2,
				data: { visible: false } as Graphics,
			},
		];

		// Create mock spatial index with query method
		spatialIndex = {
			query: vi.fn((bbox: any) => {
				// Simple mock: return items that intersect the bounding box
				return mockGraphicsItems.filter(
					(item) =>
						item.minX <= bbox.maxX &&
						item.maxX >= bbox.minX &&
						item.minY <= bbox.maxY &&
						item.maxY >= bbox.minY,
				);
			}),
		};

		viewportManager = new ViewportManager(spatialIndex, getLayerVisibility);
	});

	describe("getViewportBounds", () => {
		it("should calculate viewport bounds correctly at scale 1 with Y-flip", () => {
			const bounds = viewportManager.getViewportBounds(
				1000, // screenWidth
				800, // screenHeight
				0, // containerX
				0, // containerY
				1, // scale
				-1, // scaleY (flipped)
			);

			expect(Math.abs(bounds.minX)).toBe(0); // Handle -0 vs +0
			expect(bounds.minY).toBe(-800); // Y-axis flipped
			expect(bounds.maxX).toBe(1000);
			expect(Math.abs(bounds.maxY)).toBe(0); // Handle -0 vs +0
		});

		it("should calculate viewport bounds correctly when zoomed in", () => {
			const bounds = viewportManager.getViewportBounds(
				1000,
				800,
				0,
				0,
				2, // 2x zoom
				-2, // 2x zoom with flip
			);

			expect(Math.abs(bounds.minX)).toBe(0); // Handle -0 vs +0
			expect(bounds.minY).toBe(-400); // Half height due to 2x zoom
			expect(bounds.maxX).toBe(500); // Half width due to 2x zoom
			expect(Math.abs(bounds.maxY)).toBe(0); // Handle -0 vs +0
		});

		it("should calculate viewport bounds correctly when panned", () => {
			const bounds = viewportManager.getViewportBounds(
				1000,
				800,
				100, // panned right
				50, // panned down
				1,
				-1,
			);

			expect(bounds.minX).toBe(-100); // Shifted by -container.x
			expect(bounds.minY).toBe(-750); // Shifted by -container.y - height (flipped)
			expect(bounds.maxX).toBe(900);
			expect(bounds.maxY).toBe(50); // Shifted by -container.y (flipped)
		});

		it("should handle combined zoom and pan", () => {
			const bounds = viewportManager.getViewportBounds(1000, 800, 200, 100, 2, -2);

			expect(bounds.minX).toBe(-100); // (-200 / 2)
			expect(bounds.minY).toBe(-350); // (-100 / 2) - (800 / 2)
			expect(bounds.maxX).toBe(400); // (1000 - 200) / 2
			expect(bounds.maxY).toBe(50); // -100 / 2
		});

		it("should handle positive scaleY (no flip)", () => {
			const bounds = viewportManager.getViewportBounds(
				1000,
				800,
				0,
				0,
				1,
				1, // No flip
			);

			expect(Math.abs(bounds.minX)).toBe(0); // Handle -0 vs +0
			expect(Math.abs(bounds.minY)).toBe(0); // Handle -0 vs +0
			expect(bounds.maxX).toBe(1000);
			expect(bounds.maxY).toBe(800); // No flip
		});
	});

	describe("updateVisibility", () => {
		it("should make items visible when in viewport and layer is visible", () => {
			const viewportBounds = { minX: 0, minY: 0, maxX: 250, maxY: 250 };

			const result = viewportManager.updateVisibility(viewportBounds, mockGraphicsItems);

			// item1 and item2 are in viewport
			expect((mockGraphicsItems[0].data as Graphics).visible).toBe(true);
			expect((mockGraphicsItems[1].data as Graphics).visible).toBe(true);
			// item3 is outside viewport
			expect((mockGraphicsItems[2].data as Graphics).visible).toBe(false);

			// Check polygon counts
			expect(result.visiblePolygonCount).toBe(8); // 5 + 3
			expect(result.visibleByLayerCount).toBe(2);
			expect(result.hiddenByLayerCount).toBe(0);
		});

		it("should hide items when layer visibility is false", () => {
			getLayerVisibility.mockReturnValue(
				new Map([
					["1:0", false], // Hide layer 1
					["2:0", true],
					["3:0", true],
				]),
			);

			const viewportBounds = { minX: 0, minY: 0, maxX: 250, maxY: 250 };
			const result = viewportManager.updateVisibility(viewportBounds, mockGraphicsItems);

			// item1 is in viewport but layer is hidden
			expect((mockGraphicsItems[0].data as Graphics).visible).toBe(false);
			// item2 is in viewport and layer is visible
			expect((mockGraphicsItems[1].data as Graphics).visible).toBe(true);

			expect(result.visiblePolygonCount).toBe(3); // Only item2
			expect(result.visibleByLayerCount).toBe(1);
			expect(result.hiddenByLayerCount).toBe(1); // item1 hidden by layer
		});

		it("should handle empty graphics items", () => {
			const viewportBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
			const result = viewportManager.updateVisibility(viewportBounds, []);

			expect(result.visiblePolygonCount).toBe(0);
			expect(result.visibleByLayerCount).toBe(0);
			expect(result.hiddenByLayerCount).toBe(0);
		});

		it("should default to visible for layers not in visibility map", () => {
			getLayerVisibility.mockReturnValue(new Map()); // Empty map

			const viewportBounds = { minX: 0, minY: 0, maxX: 250, maxY: 250 };
			const result = viewportManager.updateVisibility(viewportBounds, mockGraphicsItems);

			// All items in viewport should be visible (default to true)
			expect((mockGraphicsItems[0].data as Graphics).visible).toBe(true);
			expect((mockGraphicsItems[1].data as Graphics).visible).toBe(true);
			expect(result.visibleByLayerCount).toBe(2);
		});
	});

	describe("detectNewlyVisibleLayers", () => {
		it("should detect layers that became visible and have no graphics", () => {
			const newVisibility = {
				"1:0": true,
				"4:0": true, // New layer, not in graphics items
			};
			const currentVisibility = new Map([
				["1:0", true],
				["4:0", false], // Was hidden
			]);

			const newLayers = viewportManager.detectNewlyVisibleLayers(
				newVisibility,
				currentVisibility,
				mockGraphicsItems,
			);

			// Layer 4:0 became visible and has no graphics
			expect(newLayers).toContain("4:0");
			// Layer 1:0 was already visible
			expect(newLayers).not.toContain("1:0");
		});

		it("should not detect layers that already have graphics", () => {
			const newVisibility = {
				"1:0": true,
			};
			const currentVisibility = new Map([["1:0", false]]);

			const newLayers = viewportManager.detectNewlyVisibleLayers(
				newVisibility,
				currentVisibility,
				mockGraphicsItems,
			);

			// Layer 1:0 has graphics, so not newly visible
			expect(newLayers).not.toContain("1:0");
		});

		it("should not detect layers that are still hidden", () => {
			const newVisibility = {
				"4:0": false, // Still hidden
			};
			const currentVisibility = new Map([["4:0", false]]);

			const newLayers = viewportManager.detectNewlyVisibleLayers(
				newVisibility,
				currentVisibility,
				mockGraphicsItems,
			);

			expect(newLayers).toHaveLength(0);
		});

		it("should handle layers that were not in current visibility", () => {
			const newVisibility = {
				"5:0": true, // New layer
			};
			const currentVisibility = new Map(); // Empty

			const newLayers = viewportManager.detectNewlyVisibleLayers(
				newVisibility,
				currentVisibility,
				mockGraphicsItems,
			);

			// Layer 5:0 defaults to visible (true) when not in map, so it's not "newly" visible
			// It would only be newly visible if it was explicitly false before
			expect(newLayers).toHaveLength(0);
		});
	});
});
