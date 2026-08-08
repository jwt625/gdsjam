import type { BoundingBox, Point } from "../../types/gds";

export interface ReferenceRasterPolygon {
	id: string;
	layer: number;
	datatype: number;
	/** Integer coordinates in canonical GDS database units (DBU). */
	points: readonly Point[];
}

export interface ReferenceRasterRequest {
	/** Explicit crop in canonical DBU coordinates. */
	worldBounds: BoundingBox;
	width: number;
	height: number;
	polygons: readonly ReferenceRasterPolygon[];
}

export interface ReferenceLayerMask {
	layer: number;
	datatype: number;
	mask: Uint8Array;
	coveredPixels: number;
}

export interface ReferencePolygonCoverage {
	id: string;
	layer: number;
	datatype: number;
	coveredSamples: number;
}

export interface ReferenceRaster {
	worldBounds: BoundingBox;
	width: number;
	height: number;
	/** Pixel width/height in canonical DBU. */
	pixelSize: { x: number; y: number };
	/** OR of every layer mask. Values are exactly 0 or 1. */
	combinedMask: Uint8Array;
	combinedCoveredPixels: number;
	/** Number of source polygons covering each pixel center. */
	coverageCount: Uint32Array;
	/** Sum of coverageCount; conserved even where polygons overlap. */
	totalPolygonSamples: number;
	layers: ReferenceLayerMask[];
	polygons: ReferencePolygonCoverage[];
}

interface ExactPoint {
	x: bigint;
	y: bigint;
}

interface SamplePoint {
	xNumerator: bigint;
	xDenominator: bigint;
	yNumerator: bigint;
	yDenominator: bigint;
}

interface PreparedPolygon extends ReferenceRasterPolygon {
	index: number;
	exactPoints: ExactPoint[];
}

function layerKey(layer: number, datatype: number): string {
	return `${layer}:${datatype}`;
}

function validateInteger(name: string, value: number): void {
	if (!Number.isSafeInteger(value)) {
		throw new Error(`${name} must be a safe integer DBU value; received ${value}`);
	}
}

function validateRequest(request: ReferenceRasterRequest): void {
	if (!Number.isInteger(request.width) || request.width <= 0) {
		throw new Error(`Raster width must be a positive integer; received ${request.width}`);
	}
	if (!Number.isInteger(request.height) || request.height <= 0) {
		throw new Error(`Raster height must be a positive integer; received ${request.height}`);
	}

	const { minX, minY, maxX, maxY } = request.worldBounds;
	validateInteger("worldBounds.minX", minX);
	validateInteger("worldBounds.minY", minY);
	validateInteger("worldBounds.maxX", maxX);
	validateInteger("worldBounds.maxY", maxY);
	if (maxX <= minX || maxY <= minY) {
		throw new Error("Raster world bounds must have positive width and height");
	}

	const ids = new Set<string>();
	for (const polygon of request.polygons) {
		if (ids.has(polygon.id)) {
			throw new Error(`Reference polygon IDs must be unique; duplicate ${polygon.id}`);
		}
		ids.add(polygon.id);
		validateInteger(`${polygon.id}.layer`, polygon.layer);
		validateInteger(`${polygon.id}.datatype`, polygon.datatype);
		if (polygon.points.length < 3) {
			throw new Error(`Polygon ${polygon.id} must have at least three points`);
		}
		for (const [pointIndex, point] of polygon.points.entries()) {
			validateInteger(`${polygon.id}.points[${pointIndex}].x`, point.x);
			validateInteger(`${polygon.id}.points[${pointIndex}].y`, point.y);
		}
	}
}

function pointOnSegment(sample: SamplePoint, start: ExactPoint, end: ExactPoint): boolean {
	const xFromStart = sample.xNumerator - start.x * sample.xDenominator;
	const yFromStart = sample.yNumerator - start.y * sample.yDenominator;
	const cross =
		xFromStart * (end.y - start.y) * sample.yDenominator -
		yFromStart * (end.x - start.x) * sample.xDenominator;
	if (cross !== 0n) return false;
	return (
		sample.xNumerator >= (start.x < end.x ? start.x : end.x) * sample.xDenominator &&
		sample.xNumerator <= (start.x > end.x ? start.x : end.x) * sample.xDenominator &&
		sample.yNumerator >= (start.y < end.y ? start.y : end.y) * sample.yDenominator &&
		sample.yNumerator <= (start.y > end.y ? start.y : end.y) * sample.yDenominator
	);
}

/** Even-odd fill. Samples exactly on an edge are included. */
function containsPoint(points: readonly ExactPoint[], sample: SamplePoint): boolean {
	let inside = false;
	for (let currentIndex = 0, previousIndex = points.length - 1; currentIndex < points.length; ) {
		const current = points[currentIndex];
		const previous = points[previousIndex];
		if (!current || !previous) throw new Error("Polygon index invariant failed");
		if (pointOnSegment(sample, previous, current)) return true;

		const currentAbove = current.y * sample.yDenominator > sample.yNumerator;
		const previousAbove = previous.y * sample.yDenominator > sample.yNumerator;
		if (currentAbove !== previousAbove) {
			const deltaY = previous.y - current.y;
			const left =
				(sample.xNumerator - current.x * sample.xDenominator) * deltaY * sample.yDenominator;
			const right =
				(previous.x - current.x) *
				(sample.yNumerator - current.y * sample.yDenominator) *
				sample.xDenominator;
			if (deltaY > 0n ? left < right : left > right) inside = !inside;
		}
		previousIndex = currentIndex;
		currentIndex += 1;
	}
	return inside;
}

function comparePolygons(a: PreparedPolygon, b: PreparedPolygon): number {
	return (
		a.layer - b.layer ||
		a.datatype - b.datatype ||
		(a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
		a.index - b.index
	);
}

/**
 * Slow, deterministic reference rasterizer for small crops.
 *
 * It deliberately performs one exact binary sample at each pixel center. This
 * is a semantic oracle for discrete masks, not a model of browser/GPU
 * antialiasing. Row zero maps to maxY so serialized masks have conventional
 * top-to-bottom image ordering while the source world remains Y-up.
 */
export function rasterizeReference(request: ReferenceRasterRequest): ReferenceRaster {
	validateRequest(request);
	const pixelCount = request.width * request.height;
	if (!Number.isSafeInteger(pixelCount)) throw new Error("Raster pixel count exceeds safe limits");

	const polygons: PreparedPolygon[] = request.polygons
		.map((polygon, index) => ({
			...polygon,
			index,
			exactPoints: polygon.points.map((point) => ({ x: BigInt(point.x), y: BigInt(point.y) })),
		}))
		.sort(comparePolygons);
	const layerMasks = new Map<string, ReferenceLayerMask>();
	for (const polygon of polygons) {
		const key = layerKey(polygon.layer, polygon.datatype);
		if (!layerMasks.has(key)) {
			layerMasks.set(key, {
				layer: polygon.layer,
				datatype: polygon.datatype,
				mask: new Uint8Array(pixelCount),
				coveredPixels: 0,
			});
		}
	}

	const combinedMask = new Uint8Array(pixelCount);
	const coverageCount = new Uint32Array(pixelCount);
	const polygonCoverage: ReferencePolygonCoverage[] = [];
	const worldWidth = request.worldBounds.maxX - request.worldBounds.minX;
	const worldHeight = request.worldBounds.maxY - request.worldBounds.minY;
	const xDenominator = BigInt(2 * request.width);
	const yDenominator = BigInt(2 * request.height);
	const worldWidthExact = BigInt(worldWidth);
	const worldHeightExact = BigInt(worldHeight);
	const minXExact = BigInt(request.worldBounds.minX);
	const maxYExact = BigInt(request.worldBounds.maxY);
	const sampleXNumerators = Array.from(
		{ length: request.width },
		(_, column) => minXExact * xDenominator + BigInt(2 * column + 1) * worldWidthExact,
	);
	const sampleYNumerators = Array.from(
		{ length: request.height },
		(_, row) => maxYExact * yDenominator - BigInt(2 * row + 1) * worldHeightExact,
	);

	for (const polygon of polygons) {
		const mask = layerMasks.get(layerKey(polygon.layer, polygon.datatype));
		if (!mask) throw new Error("Layer mask invariant failed");
		let coveredSamples = 0;
		for (let row = 0; row < request.height; row += 1) {
			const yNumerator = sampleYNumerators[row];
			if (yNumerator === undefined) throw new Error("Raster row invariant failed");
			for (let column = 0; column < request.width; column += 1) {
				const xNumerator = sampleXNumerators[column];
				if (xNumerator === undefined) throw new Error("Raster column invariant failed");
				if (
					!containsPoint(polygon.exactPoints, {
						xNumerator,
						xDenominator,
						yNumerator,
						yDenominator,
					})
				) {
					continue;
				}
				const pixelIndex = row * request.width + column;
				mask.mask[pixelIndex] = 1;
				combinedMask[pixelIndex] = 1;
				coverageCount[pixelIndex] = (coverageCount[pixelIndex] ?? 0) + 1;
				coveredSamples += 1;
			}
		}
		polygonCoverage.push({
			id: polygon.id,
			layer: polygon.layer,
			datatype: polygon.datatype,
			coveredSamples,
		});
	}

	let combinedCoveredPixels = 0;
	let totalPolygonSamples = 0;
	for (let index = 0; index < pixelCount; index += 1) {
		combinedCoveredPixels += combinedMask[index] ?? 0;
		totalPolygonSamples += coverageCount[index] ?? 0;
	}
	const layers = [...layerMasks.values()];
	for (const layer of layers) {
		for (const value of layer.mask) layer.coveredPixels += value;
	}

	return {
		worldBounds: { ...request.worldBounds },
		width: request.width,
		height: request.height,
		pixelSize: { x: worldWidth / request.width, y: worldHeight / request.height },
		combinedMask,
		combinedCoveredPixels,
		coverageCount,
		totalPolygonSamples,
		layers,
		polygons: polygonCoverage,
	};
}

function maskToHex(mask: Uint8Array): string {
	let result = "";
	for (const value of mask) result += value.toString(16).padStart(2, "0");
	return result;
}

/** Stable, inspectable raw-mask form for JSON evidence and exact comparisons. */
export function serializeReferenceRaster(raster: ReferenceRaster): object {
	return {
		schema: "gdsjam-reference-raster-v1",
		sampling: "pixel-center-even-odd-boundary-inclusive-no-antialiasing",
		rowOrder: "top-to-bottom (row 0 samples maxY)",
		worldBounds: raster.worldBounds,
		width: raster.width,
		height: raster.height,
		pixelSizeDBU: raster.pixelSize,
		combined: {
			coveredPixels: raster.combinedCoveredPixels,
			maskHex: maskToHex(raster.combinedMask),
		},
		totalPolygonSamples: raster.totalPolygonSamples,
		coverageCount: [...raster.coverageCount],
		layers: raster.layers.map((layer) => ({
			layer: layer.layer,
			datatype: layer.datatype,
			coveredPixels: layer.coveredPixels,
			maskHex: maskToHex(layer.mask),
		})),
		polygons: raster.polygons,
	};
}
