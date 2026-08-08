import type { BoundingBox, GDSDocument, Point } from "../../../types/gds";
import {
	type AffineTransform,
	composeAffine,
	fromGDSReferenceTransform,
	IDENTITY_TRANSFORM,
	transformBoundingBox,
	transformPoint,
} from "../../layout/AffineTransform";
import { getArrayReferencePitch } from "../../layout/ArrayReference";
import { createLayoutSceneIndex, type SceneReference } from "../../layout/LayoutSceneIndex";

export interface CompleteOverviewScope {
	topCellNames: readonly string[];
	bounds: BoundingBox;
}

export interface CompleteOverviewOptions {
	/** Logical maximum overview edge. Physical resolution is cssSizePx * devicePixelRatio. */
	cssSizePx?: number;
	devicePixelRatio?: number;
	layerVisibility?: ReadonlyMap<string, boolean>;
}

export interface CompleteOverviewLayer {
	key: string;
	layer: number;
	datatype: number;
	color: string;
	/** Row-major, one byte per physical pixel. Row zero is the minimum world Y edge. */
	coverage: Uint8Array;
}

export interface CompleteOverviewTelemetry {
	status: "ready" | "incomplete" | "failed";
	complete: boolean;
	generationTimeMs: number;
	byteLength: number;
	physicalWidth: number;
	physicalHeight: number;
	devicePixelRatio: number;
	polygonOccurrences: number;
	occupiedLayerPixels: number;
	layerCount: number;
	clippedPolygonOccurrences: number;
	diagnostics: readonly string[];
}

export interface CompleteOverviewArtifact {
	bounds: BoundingBox;
	layers: readonly CompleteOverviewLayer[];
	telemetry: CompleteOverviewTelemetry;
}

const DEFAULT_CSS_SIZE_PX = 256;
const EPSILON = 1e-9;

function finitePositive(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

function intersects(left: BoundingBox, right: BoundingBox): boolean {
	return !(
		left.maxX < right.minX ||
		left.minX > right.maxX ||
		left.maxY < right.minY ||
		left.minY > right.maxY
	);
}

function containsPoint(bounds: BoundingBox, point: Point): boolean {
	return (
		point.x >= bounds.minX - EPSILON &&
		point.x <= bounds.maxX + EPSILON &&
		point.y >= bounds.minY - EPSILON &&
		point.y <= bounds.maxY + EPSILON
	);
}

function orientation(a: Point, b: Point, c: Point): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, point: Point): boolean {
	return (
		Math.abs(orientation(a, b, point)) <= EPSILON &&
		point.x >= Math.min(a.x, b.x) - EPSILON &&
		point.x <= Math.max(a.x, b.x) + EPSILON &&
		point.y >= Math.min(a.y, b.y) - EPSILON &&
		point.y <= Math.max(a.y, b.y) + EPSILON
	);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
	const abC = orientation(a, b, c);
	const abD = orientation(a, b, d);
	const cdA = orientation(c, d, a);
	const cdB = orientation(c, d, b);
	if (
		((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
		((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
	) {
		return true;
	}
	return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
	let inside = false;
	for (
		let current = 0, previous = polygon.length - 1;
		current < polygon.length;
		previous = current++
	) {
		const a = polygon[current];
		const b = polygon[previous];
		if (!a || !b) continue;
		if (onSegment(a, b, point)) return true;
		const crosses =
			a.y > point.y !== b.y > point.y &&
			point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
		if (crosses) inside = !inside;
	}
	return inside;
}

/** Conservative polygon/rectangle overlap. Boundary contact intentionally counts as coverage. */
function polygonIntersectsPixel(polygon: readonly Point[], pixel: BoundingBox): boolean {
	if (polygon.some((point) => containsPoint(pixel, point))) return true;
	const corners: Point[] = [
		{ x: pixel.minX, y: pixel.minY },
		{ x: pixel.maxX, y: pixel.minY },
		{ x: pixel.maxX, y: pixel.maxY },
		{ x: pixel.minX, y: pixel.maxY },
	];
	if (polygon.length >= 3 && corners.some((corner) => pointInPolygon(corner, polygon))) return true;
	const polygonEdgeCount = polygon.length === 2 ? 1 : polygon.length;
	for (let index = 0; index < polygonEdgeCount; index++) {
		const start = polygon[index];
		const end = polygon[(index + 1) % polygon.length];
		if (!start || !end) continue;
		for (let edge = 0; edge < corners.length; edge++) {
			const edgeStart = corners[edge];
			const edgeEnd = corners[(edge + 1) % corners.length];
			if (edgeStart && edgeEnd && segmentsIntersect(start, end, edgeStart, edgeEnd)) return true;
		}
	}
	return false;
}

function referenceTransforms(reference: SceneReference): readonly AffineTransform[] {
	const transforms: AffineTransform[] = [];
	const offsets = [{ x: 0, y: 0 }];
	if (reference.kind === "aref") {
		const pitch = getArrayReferencePitch(reference.lattice);
		offsets.length = 0;
		for (let row = 0; row < reference.lattice.rows; row++) {
			for (let column = 0; column < reference.lattice.columns; column++) {
				offsets.push({
					x: pitch.column.x * column + pitch.row.x * row,
					y: pitch.column.y * column + pitch.row.y * row,
				});
			}
		}
	}
	for (const offset of offsets) {
		transforms.push(
			fromGDSReferenceTransform({
				x: reference.origin.x + offset.x,
				y: reference.origin.y + offset.y,
				rotationDegrees: reference.rotation,
				reflectAcrossX: reference.mirror,
				magnification: reference.magnification,
			}),
		);
	}
	return transforms;
}

function artifactDimensions(bounds: BoundingBox, cssSizePx: number, dpr: number) {
	const worldWidth = bounds.maxX - bounds.minX;
	const worldHeight = bounds.maxY - bounds.minY;
	const longestPhysicalEdge = Math.max(1, Math.round(cssSizePx * dpr));
	if (worldWidth >= worldHeight) {
		return {
			width: longestPhysicalEdge,
			height: Math.max(1, Math.round((longestPhysicalEdge * worldHeight) / worldWidth)),
		};
	}
	return {
		width: Math.max(1, Math.round((longestPhysicalEdge * worldWidth) / worldHeight)),
		height: longestPhysicalEdge,
	};
}

/**
 * Build a deterministic, world-anchored, conservative coverage overview.
 * No traversal budget is applied: an artifact is committable only when every
 * selected, resolvable polygon occurrence has been considered.
 */
export function generateCompleteOverview(
	document: GDSDocument,
	scope: CompleteOverviewScope,
	options: CompleteOverviewOptions = {},
): CompleteOverviewArtifact {
	const startedAt = performance.now();
	const cssSizePx = options.cssSizePx ?? DEFAULT_CSS_SIZE_PX;
	const dpr = options.devicePixelRatio ?? 1;
	const worldWidth = scope.bounds.maxX - scope.bounds.minX;
	const worldHeight = scope.bounds.maxY - scope.bounds.minY;
	if (!finitePositive(cssSizePx) || !finitePositive(dpr)) {
		throw new Error("Overview CSS size and device pixel ratio must be finite and positive");
	}
	if (!finitePositive(worldWidth) || !finitePositive(worldHeight)) {
		throw new Error("Overview scope must have finite, non-zero world bounds");
	}

	const { width, height } = artifactDimensions(scope.bounds, cssSizePx, dpr);
	const pixelWidth = worldWidth / width;
	const pixelHeight = worldHeight / height;
	const scene = createLayoutSceneIndex(document);
	const layerCoverage = new Map<string, Uint8Array>();
	const diagnosticSet = new Set<string>();
	let polygonOccurrences = 0;
	let clippedPolygonOccurrences = 0;

	const rasterize = (layerKey: string, points: readonly Point[], bounds: BoundingBox) => {
		if (!intersects(bounds, scope.bounds)) {
			clippedPolygonOccurrences++;
			return;
		}
		if (
			bounds.minX < scope.bounds.minX - EPSILON ||
			bounds.maxX > scope.bounds.maxX + EPSILON ||
			bounds.minY < scope.bounds.minY - EPSILON ||
			bounds.maxY > scope.bounds.maxY + EPSILON
		) {
			clippedPolygonOccurrences++;
		}
		let coverage = layerCoverage.get(layerKey);
		if (!coverage) {
			coverage = new Uint8Array(width * height);
			layerCoverage.set(layerKey, coverage);
		}
		const minColumn = Math.max(
			0,
			Math.min(width - 1, Math.floor((bounds.minX - scope.bounds.minX) / pixelWidth)),
		);
		const maxColumn = Math.max(
			0,
			Math.min(width - 1, Math.floor((bounds.maxX - scope.bounds.minX) / pixelWidth)),
		);
		const minRow = Math.max(
			0,
			Math.min(height - 1, Math.floor((bounds.minY - scope.bounds.minY) / pixelHeight)),
		);
		const maxRow = Math.max(
			0,
			Math.min(height - 1, Math.floor((bounds.maxY - scope.bounds.minY) / pixelHeight)),
		);
		for (let row = minRow; row <= maxRow; row++) {
			for (let column = minColumn; column <= maxColumn; column++) {
				const pixel = {
					minX: scope.bounds.minX + column * pixelWidth,
					minY: scope.bounds.minY + row * pixelHeight,
					maxX: scope.bounds.minX + (column + 1) * pixelWidth,
					maxY: scope.bounds.minY + (row + 1) * pixelHeight,
				};
				if (polygonIntersectsPixel(points, pixel)) coverage[row * width + column] = 1;
			}
		}
	};

	const visit = (cellName: string, transform: AffineTransform, active: ReadonlySet<string>) => {
		const cell = scene.cells.get(cellName);
		if (!cell) {
			diagnosticSet.add(`unresolved-reference: ${cellName}`);
			return;
		}
		for (const scenePolygon of cell.polygons) {
			const polygon = scenePolygon.polygon;
			const layerKey = `${polygon.layer}:${polygon.datatype}`;
			if (options.layerVisibility?.get(layerKey) === false) continue;
			const points = polygon.points.map((point) => transformPoint(transform, point));
			polygonOccurrences++;
			rasterize(layerKey, points, transformBoundingBox(transform, polygon.boundingBox));
		}
		for (const reference of cell.references) {
			if (reference.absoluteRotation || reference.absoluteMagnification) {
				diagnosticSet.add(`unsupported-absolute-transform: ${reference.id}`);
			}
			if (active.has(reference.cellRef)) {
				diagnosticSet.add(`cyclic-reference: ${cellName}->${reference.cellRef}`);
				continue;
			}
			for (const referenceTransform of referenceTransforms(reference)) {
				visit(
					reference.cellRef,
					composeAffine(transform, referenceTransform),
					new Set([...active, reference.cellRef]),
				);
			}
		}
	};

	for (const root of [...new Set(scope.topCellNames)].sort()) {
		visit(root, { ...IDENTITY_TRANSFORM }, new Set([root]));
	}

	const layers: CompleteOverviewLayer[] = [...layerCoverage.entries()]
		.map(([key, coverage]) => {
			const [layerText, datatypeText] = key.split(":");
			const layer = Number.parseInt(layerText ?? "0", 10);
			const datatype = Number.parseInt(datatypeText ?? "0", 10);
			return {
				key,
				layer,
				datatype,
				color: document.layers.get(key)?.color ?? "#4a9eff",
				coverage,
			};
		})
		.sort((left, right) => left.layer - right.layer || left.datatype - right.datatype);
	const diagnostics = [...diagnosticSet].sort();
	const complete = diagnostics.length === 0 && clippedPolygonOccurrences === 0;
	const occupiedLayerPixels = layers.reduce(
		(sum, layer) => sum + layer.coverage.reduce((layerSum, value) => layerSum + value, 0),
		0,
	);
	return {
		bounds: { ...scope.bounds },
		layers,
		telemetry: {
			status: complete ? "ready" : "incomplete",
			complete,
			generationTimeMs: performance.now() - startedAt,
			byteLength: layers.reduce((sum, layer) => sum + layer.coverage.byteLength, 0),
			physicalWidth: width,
			physicalHeight: height,
			devicePixelRatio: dpr,
			polygonOccurrences,
			occupiedLayerPixels,
			layerCount: layers.length,
			clippedPolygonOccurrences,
			diagnostics,
		},
	};
}
