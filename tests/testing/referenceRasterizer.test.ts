import { describe, expect, it } from "vitest";
import {
	type ReferenceRasterPolygon,
	rasterizeReference,
	serializeReferenceRaster,
} from "../../src/lib/testing/referenceRasterizer";

function rectangle(
	id: string,
	layer: number,
	datatype: number,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): ReferenceRasterPolygon {
	return {
		id,
		layer,
		datatype,
		points: [
			{ x: minX, y: minY },
			{ x: maxX, y: minY },
			{ x: maxX, y: maxY },
			{ x: minX, y: maxY },
		],
	};
}

describe("referenceRasterizer", () => {
	it("maps a Y-up DBU crop into top-to-bottom mask rows", () => {
		const raster = rasterizeReference({
			worldBounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
			width: 4,
			height: 4,
			polygons: [rectangle("upper-left", 1, 0, 0, 2, 2, 4)],
		});

		expect([...raster.combinedMask]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(raster.pixelSize).toEqual({ x: 1, y: 1 });
	});

	it("retains per-layer masks and conserves polygon coverage through overlap", () => {
		const raster = rasterizeReference({
			worldBounds: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
			width: 6,
			height: 4,
			polygons: [rectangle("left", 1, 0, 0, 0, 4, 4), rectangle("right", 2, 7, 2, 0, 6, 4)],
		});

		expect(
			raster.layers.map(({ layer, datatype, coveredPixels }) => ({
				layer,
				datatype,
				coveredPixels,
			})),
		).toEqual([
			{ layer: 1, datatype: 0, coveredPixels: 16 },
			{ layer: 2, datatype: 7, coveredPixels: 16 },
		]);
		expect(raster.combinedCoveredPixels).toBe(24);
		expect(raster.totalPolygonSamples).toBe(32);
		expect(raster.polygons.reduce((sum, polygon) => sum + polygon.coveredSamples, 0)).toBe(32);
		expect([...raster.coverageCount].filter((count) => count === 2)).toHaveLength(8);
	});

	it("is invariant to polygon order, start vertex, and winding", () => {
		const first = rectangle("a", 1, 0, 1, 1, 5, 5);
		const second = rectangle("b", 2, 0, 3, 0, 7, 3);
		const rotatedAndReversed = {
			...first,
			points: [first.points[2], first.points[1], first.points[0], first.points[3]].filter(
				(point): point is { x: number; y: number } => point !== undefined,
			),
		};
		const request = {
			worldBounds: { minX: 0, minY: 0, maxX: 8, maxY: 6 },
			width: 8,
			height: 6,
		};

		const forward = serializeReferenceRaster(
			rasterizeReference({ ...request, polygons: [first, second] }),
		);
		const reordered = serializeReferenceRaster(
			rasterizeReference({ ...request, polygons: [second, rotatedAndReversed] }),
		);
		expect(reordered).toEqual(forward);
	});

	it("preserves a one-DBU line and a one-DBU gap at one DBU per pixel", () => {
		const raster = rasterizeReference({
			worldBounds: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
			width: 8,
			height: 4,
			polygons: [rectangle("line-a", 10, 0, 2, 0, 3, 4), rectangle("line-b", 10, 0, 4, 0, 5, 4)],
		});

		for (let row = 0; row < 4; row += 1) {
			expect([...raster.combinedMask.slice(row * 8, row * 8 + 8)]).toEqual([
				0, 0, 1, 0, 1, 0, 0, 0,
			]);
		}
		expect(raster.combinedCoveredPixels).toBe(8);
	});

	it("includes fractional-DBU pixel centers on polygon boundaries exactly", () => {
		const raster = rasterizeReference({
			worldBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
			width: 3,
			height: 3,
			polygons: [
				{
					id: "triangle",
					layer: 1,
					datatype: 0,
					points: [
						{ x: 0, y: 0 },
						{ x: 10, y: 10 },
						{ x: 0, y: 10 },
					],
				},
			],
		});

		// Diagonal samples lie at 5/3, 5, and 25/3 DBU on y=x.
		expect([...raster.combinedMask]).toEqual([1, 1, 1, 1, 1, 0, 1, 0, 0]);
	});

	it("rejects non-integer DBU geometry and ambiguous duplicate IDs", () => {
		expect(() =>
			rasterizeReference({
				worldBounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
				width: 2,
				height: 2,
				polygons: [rectangle("fractional", 1, 0, 0, 0, 1.5, 1)],
			}),
		).toThrow(/safe integer DBU/);

		const duplicate = rectangle("duplicate", 1, 0, 0, 0, 1, 1);
		expect(() =>
			rasterizeReference({
				worldBounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
				width: 2,
				height: 2,
				polygons: [duplicate, duplicate],
			}),
		).toThrow(/must be unique/);
	});
});
