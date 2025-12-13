import { describe, expect, it } from "vitest";
import { pathToPolygon } from "../../src/lib/gds/pathToPolygon";
import type { Point } from "../../src/types/gds";

describe("pathToPolygon", () => {
	describe("edge cases", () => {
		it("should return empty array for empty centerPoints", () => {
			const result = pathToPolygon([], 10, 0);
			expect(result).toEqual([]);
		});

		it("should return centerline for zero-width path (polyline)", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			];
			const result = pathToPolygon(centerPoints, 0, 0);
			// Zero-width paths return the centerline for line rendering
			expect(result).toEqual(centerPoints);
			expect(result.length).toBe(2); // Polyline
		});

		it("should return centerline for negative-width path (polyline)", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			];
			const result = pathToPolygon(centerPoints, -5, 0);
			// Negative width treated as zero-width
			expect(result).toEqual(centerPoints);
			expect(result.length).toBe(2); // Polyline
		});
	});

	describe("pathtype 0 (flush caps)", () => {
		it("should create rectangle for horizontal single-segment path", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			];
			const width = 20;
			const result = pathToPolygon(centerPoints, width, 0);

			// Should create a rectangle: left edge (2) + right edge (2) + start point + closing point = 6
			expect(result.length).toBe(6);

			// Verify polygon is closed
			expect(result[result.length - 1]).toEqual(result[0]);

			// Verify all points have y-coordinates at ±10 (halfWidth)
			const yCoords = result.slice(0, -1).map((p) => Math.abs(p.y));
			expect(yCoords.every((y) => Math.abs(y - 10) < 0.01)).toBe(true);
		});

		it("should create rectangle for vertical single-segment path", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 0, y: 100 },
			];
			const width = 20;
			const result = pathToPolygon(centerPoints, width, 0);

			expect(result.length).toBe(6);

			// Verify polygon is closed
			expect(result[result.length - 1]).toEqual(result[0]);

			// Verify all points have x-coordinates at ±10 (halfWidth)
			const xCoords = result.slice(0, -1).map((p) => Math.abs(p.x));
			expect(xCoords.every((x) => Math.abs(x - 10) < 0.01)).toBe(true);
		});

		it("should handle L-shaped path with miter join", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 100 },
			];
			const width = 20;
			const result = pathToPolygon(centerPoints, width, 0);

			// Should have start point + 3 left edge + 3 right edge + closing = 8
			expect(result.length).toBe(8);

			// Verify polygon is closed
			expect(result[result.length - 1]).toEqual(result[0]);
		});
	});

	describe("pathtype 1 (round caps)", () => {
		it("should add semicircle caps to horizontal path", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			];
			const width = 20;
			const result = pathToPolygon(centerPoints, width, 1);

			// Should have: start cap (9 points) + 2 edge points + end cap (9 points) + 2 edge points + closing
			// = 9 + 2 + 9 + 2 + 1 = 23 points
			expect(result.length).toBeGreaterThan(10); // At least more than flush caps

			// Verify polygon is closed
			expect(result[result.length - 1]).toEqual(result[0]);
		});
	});

	describe("pathtype 2 (extended caps)", () => {
		it("should extend caps by halfWidth for horizontal path", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			];
			const width = 20;
			const result = pathToPolygon(centerPoints, width, 2);

			// Should have: start cap (2 points) + 2 edge points + end cap (2 points) + 2 edge points + closing
			// = 2 + 2 + 2 + 2 + 1 = 9 points
			expect(result.length).toBe(9);

			// Start cap should extend left by halfWidth (10)
			const startCapPoint = result[0];
			expect(startCapPoint?.x).toBeCloseTo(-10);

			// End cap should extend right by halfWidth (10)
			const endCapPoint = result[4];
			expect(endCapPoint?.x).toBeCloseTo(110);

			// Verify polygon is closed
			expect(result[result.length - 1]).toEqual(result[0]);
		});
	});

	describe("pathtype 4 (custom - fallback to flush)", () => {
		it("should fall back to flush caps for pathtype 4", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			];
			const width = 20;
			const result = pathToPolygon(centerPoints, width, 4);

			// Should behave like pathtype 0 (flush)
			expect(result.length).toBe(6);
		});
	});

	describe("complex paths", () => {
		it("should handle multi-segment zigzag path", () => {
			const centerPoints: Point[] = [
				{ x: 0, y: 0 },
				{ x: 50, y: 50 },
				{ x: 100, y: 0 },
				{ x: 150, y: 50 },
			];
			const width = 10;
			const result = pathToPolygon(centerPoints, width, 0);

			// Should have start point + 4 left edge + 4 right edge + closing = 10 points
			expect(result.length).toBe(10);

			// Verify polygon is closed
			expect(result[result.length - 1]).toEqual(result[0]);
		});
	});
});
