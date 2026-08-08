import { describe, expect, it } from "vitest";
import { generateCompleteOverview } from "../../src/lib/renderer/overview/CompleteOverview";
import type {
	BoundingBox,
	Cell,
	CellInstance,
	GDSDocument,
	GDSParserDiagnostics,
	Polygon,
} from "../../src/types/gds";

const diagnostics = (): GDSParserDiagnostics => ({
	unsupportedElements: {},
	unsupported: { count: 0, details: [] },
	malformed: { count: 0, details: [] },
	unresolvedReferences: { count: 0, details: [] },
	referenceCycles: { count: 0, details: [] },
});

function boundsFor(points: readonly { x: number; y: number }[]): BoundingBox {
	return {
		minX: Math.min(...points.map((point) => point.x)),
		minY: Math.min(...points.map((point) => point.y)),
		maxX: Math.max(...points.map((point) => point.x)),
		maxY: Math.max(...points.map((point) => point.y)),
	};
}

function polygon(id: string, points: Polygon["points"], layer = 1, datatype = 0): Polygon {
	return { id, points, layer, datatype, boundingBox: boundsFor(points) };
}

function rectangle(id: string, bounds: BoundingBox, layer = 1, datatype = 0): Polygon {
	return polygon(
		id,
		[
			{ x: bounds.minX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.maxY },
			{ x: bounds.minX, y: bounds.maxY },
		],
		layer,
		datatype,
	);
}

function cell(name: string, polygons: Polygon[], instances: CellInstance[] = []): Cell {
	const allBounds = polygons.map((item) => item.boundingBox);
	const boundingBox = allBounds.length
		? {
				minX: Math.min(...allBounds.map((item) => item.minX)),
				minY: Math.min(...allBounds.map((item) => item.minY)),
				maxX: Math.max(...allBounds.map((item) => item.maxX)),
				maxY: Math.max(...allBounds.map((item) => item.maxY)),
			}
		: { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	return {
		name,
		polygons,
		texts: [],
		instances,
		references: instances,
		boundingBox,
		skipInMinimap: false,
	};
}

function instance(id: string, cellRef: string, x: number, y: number): CellInstance {
	return {
		id,
		cellRef,
		x,
		y,
		rotation: 0,
		mirror: false,
		magnification: 1,
		boundingBox: { minX: x, minY: y, maxX: x, maxY: y },
	};
}

function document(cells: Cell[], topCells: string[], bounds: BoundingBox): GDSDocument {
	return {
		name: "OVERVIEW_TEST",
		cells: new Map(cells.map((item) => [item.name, item])),
		layers: new Map([
			["1:0", { layer: 1, datatype: 0, color: "#ff0000", visible: true }],
			["2:0", { layer: 2, datatype: 0, color: "#00ff00", visible: true }],
		]),
		topCells,
		boundingBox: bounds,
		units: { database: 1e-9, user: 1e-6 },
		diagnostics: diagnostics(),
	};
}

function maskSignature(result: ReturnType<typeof generateCompleteOverview>): string {
	return result.layers.map((layer) => `${layer.key}:${[...layer.coverage].join("")}`).join("|");
}

describe("complete overview coverage", () => {
	it("anchors physical dimensions and coverage to the requested world bounds", () => {
		const bounds = { minX: -10, minY: 20, maxX: 10, maxY: 30 };
		const result = generateCompleteOverview(
			document([cell("TOP", [rectangle("full", bounds)])], ["TOP"], bounds),
			{ topCellNames: ["TOP"], bounds },
			{ cssSizePx: 8, devicePixelRatio: 2 },
		);

		expect(result.bounds).toEqual(bounds);
		expect(result.telemetry).toMatchObject({
			status: "ready",
			complete: true,
			physicalWidth: 16,
			physicalHeight: 8,
			byteLength: 128,
			polygonOccurrences: 1,
		});
		expect(result.layers[0]?.coverage.every((value) => value === 1)).toBe(true);
	});

	it("is invariant to cell, polygon, and selected-root ordering", () => {
		const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
		const left = rectangle("left", { minX: 0, minY: 0, maxX: 4, maxY: 10 });
		const right = rectangle("right", { minX: 6, minY: 0, maxX: 10, maxY: 10 });
		const first = document([cell("A", [left]), cell("B", [right])], ["A", "B"], bounds);
		const second = document([cell("B", [right]), cell("A", [left])], ["B", "A"], bounds);

		const firstResult = generateCompleteOverview(
			first,
			{ topCellNames: ["A", "B"], bounds },
			{ cssSizePx: 10 },
		);
		const secondResult = generateCompleteOverview(
			second,
			{ topCellNames: ["B", "A"], bounds },
			{ cssSizePx: 10 },
		);
		expect(maskSignature(firstResult)).toBe(maskSignature(secondResult));
	});

	it("keeps layers separate, deterministically ordered, and visibility scoped", () => {
		const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
		const top = cell("TOP", [
			rectangle("upper-layer", { minX: 0, minY: 0, maxX: 4, maxY: 10 }, 2),
			rectangle("lower-layer", { minX: 6, minY: 0, maxX: 10, maxY: 10 }, 1),
		]);
		const layout = document([top], ["TOP"], bounds);
		const all = generateCompleteOverview(
			layout,
			{ topCellNames: ["TOP"], bounds },
			{ cssSizePx: 10 },
		);
		expect(all.layers.map((layer) => layer.key)).toEqual(["1:0", "2:0"]);
		expect(all.layers[0]?.coverage).not.toEqual(all.layers[1]?.coverage);

		const visibleOnly = generateCompleteOverview(
			layout,
			{ topCellNames: ["TOP"], bounds },
			{ cssSizePx: 10, layerVisibility: new Map([["2:0", false]]) },
		);
		expect(visibleOnly.layers.map((layer) => layer.key)).toEqual(["1:0"]);
		expect(visibleOnly.telemetry.complete).toBe(true);
	});

	it("conservatively retains sub-pixel narrow polygons and two-point paths", () => {
		const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
		const top = cell("TOP", [
			rectangle("narrow", { minX: 49.9, minY: 5, maxX: 50.1, maxY: 95 }),
			polygon("line", [
				{ x: 5, y: 5 },
				{ x: 95, y: 95 },
			]),
		]);
		const result = generateCompleteOverview(
			document([top], ["TOP"], bounds),
			{ topCellNames: ["TOP"], bounds },
			{ cssSizePx: 10 },
		);
		const occupied = result.layers[0]?.coverage.reduce((sum, value) => sum + value, 0) ?? 0;
		expect(occupied).toBeGreaterThanOrEqual(10);
		expect(result.telemetry).toMatchObject({ complete: true, polygonOccurrences: 2 });
	});

	it("traverses transformed hierarchy and treats selected/all top-cell scope explicitly", () => {
		const aggregate = { minX: 0, minY: 0, maxX: 30, maxY: 10 };
		const leaf = cell("LEAF", [rectangle("leaf", { minX: 0, minY: 0, maxX: 10, maxY: 10 })]);
		const topA = cell("TOP_A", [], [instance("a-leaf", "LEAF", 0, 0)]);
		const topB = cell("TOP_B", [], [instance("b-leaf", "LEAF", 20, 0)]);
		const layout = document([topB, leaf, topA], ["TOP_A", "TOP_B"], aggregate);

		const selectedBounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
		const selected = generateCompleteOverview(
			layout,
			{ topCellNames: ["TOP_A"], bounds: selectedBounds },
			{ cssSizePx: 10 },
		);
		const all = generateCompleteOverview(
			layout,
			{ topCellNames: ["TOP_A", "TOP_B"], bounds: aggregate },
			{ cssSizePx: 30 },
		);

		expect(selected.telemetry).toMatchObject({ complete: true, polygonOccurrences: 1 });
		expect(all.telemetry).toMatchObject({ complete: true, polygonOccurrences: 2 });
		const allMask = all.layers[0]?.coverage;
		expect(allMask?.[5]).toBe(1);
		expect(allMask?.[15]).toBe(0);
		expect(allMask?.[25]).toBe(1);
	});

	it("covers rotated references and every compact AREF placement inside exact scope bounds", () => {
		const leaf = cell("LEAF", [rectangle("leaf", { minX: 0, minY: 0, maxX: 1, maxY: 1 })]);
		const rotated = {
			...instance("rotated", "LEAF", 1, 0),
			rotation: 90,
		};
		const array = {
			...instance("array", "LEAF", 2, 0),
			arrayCols: 2,
			arrayRows: 1,
			arrayColumnVector: { x: 4, y: 0 },
			arrayRowVector: { x: 0, y: 1 },
		};
		const top = cell("TOP", [], [rotated, array]);
		const bounds = { minX: 0, minY: 0, maxX: 5, maxY: 1 };
		const result = generateCompleteOverview(
			document([top, leaf], ["TOP"], bounds),
			{ topCellNames: ["TOP"], bounds },
			{ cssSizePx: 10 },
		);

		expect(result.telemetry).toMatchObject({
			status: "ready",
			complete: true,
			polygonOccurrences: 3,
			clippedPolygonOccurrences: 0,
		});
		const coverage = result.layers[0]?.coverage;
		expect(coverage?.[0]).toBe(1);
		expect(coverage?.[5]).toBe(1);
		expect(coverage?.[9]).toBe(1);
	});

	it("refuses to call clipped or unresolved output complete", () => {
		const fullBounds = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
		const top = cell(
			"TOP",
			[rectangle("outside-scope", { minX: 0, minY: 0, maxX: 20, maxY: 10 })],
			[instance("missing", "MISSING", 0, 0)],
		);
		const result = generateCompleteOverview(
			document([top], ["TOP"], fullBounds),
			{ topCellNames: ["TOP"], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
			{ cssSizePx: 10 },
		);

		expect(result.telemetry.status).toBe("incomplete");
		expect(result.telemetry.complete).toBe(false);
		expect(result.telemetry.clippedPolygonOccurrences).toBe(1);
		expect(result.telemetry.diagnostics.some((item) => item.includes("unresolved"))).toBe(true);
	});

	it("does not let an unreachable broken top cell poison a valid selected scope", () => {
		const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
		const selected = cell("SELECTED", [rectangle("valid", bounds)]);
		const broken = cell("BROKEN", [], [instance("missing", "MISSING", 100, 100)]);
		const result = generateCompleteOverview(
			document([broken, selected], ["SELECTED", "BROKEN"], bounds),
			{ topCellNames: ["SELECTED"], bounds },
			{ cssSizePx: 10 },
		);

		expect(result.telemetry).toMatchObject({ status: "ready", complete: true });
		expect(result.telemetry.diagnostics).toEqual([]);
	});
});
