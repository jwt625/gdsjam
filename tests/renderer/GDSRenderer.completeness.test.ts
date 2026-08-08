import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { GDSRenderer } from "../../src/lib/renderer/rendering/GDSRenderer";
import { SpatialIndex } from "../../src/lib/spatial/RTree";
import type { GDSDocument, Polygon } from "../../src/types/gds";

const boundingBox = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const polygon = (id: string): Polygon => ({
	id,
	layer: 1,
	datatype: 0,
	points: [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	],
	boundingBox,
});

const document: GDSDocument = {
	name: "budget-fixture",
	cells: new Map([
		[
			"TOP",
			{
				name: "TOP",
				polygons: [polygon("one"), polygon("two")],
				texts: [],
				instances: [],
				boundingBox,
				skipInMinimap: false,
			},
		],
	]),
	layers: new Map([["1:0", { layer: 1, datatype: 0, color: "#ffffff", visible: true }]]),
	topCells: ["TOP"],
	boundingBox,
	units: { database: 1e-9, user: 1e-6 },
	diagnostics: {
		unsupportedElements: {},
		unsupported: { count: 0, details: [] },
		malformed: { count: 0, details: [] },
		unresolvedReferences: { count: 0, details: [] },
		referenceCycles: { count: 0, details: [] },
	},
};

describe("GDSRenderer completeness", () => {
	it("distinguishes a budget-truncated render from an exact complete render", async () => {
		const renderer = new GDSRenderer(new SpatialIndex(), new Container());
		const baseOptions = {
			maxDepth: 0,
			fillMode: true,
			layerVisibility: new Map([["1:0", true]]),
		};

		const partial = await renderer.render(document, {
			...baseOptions,
			maxPolygonsPerRender: 1,
		});
		expect(partial.renderedPolygons).toBe(1);
		expect(partial.budgetExhausted).toBe(true);
		expect(partial.depthLimited).toBe(false);

		const complete = await renderer.render(document, {
			...baseOptions,
			maxPolygonsPerRender: 2,
		});
		expect(complete.renderedPolygons).toBe(2);
		expect(complete.budgetExhausted).toBe(false);
		expect(complete.depthLimited).toBe(false);
	});

	it("composes nested reflected and rotated instances with affine matrices", async () => {
		const nestedDocument: GDSDocument = {
			...document,
			cells: new Map([
				[
					"LEAF",
					{
						name: "LEAF",
						polygons: [
							{
								...polygon("nested"),
								points: [
									{ x: 0, y: 0 },
									{ x: 2, y: 0 },
									{ x: 2, y: 1 },
									{ x: 0, y: 1 },
								],
								boundingBox: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
							},
						],
						texts: [],
						instances: [],
						boundingBox: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
						skipInMinimap: false,
					},
				],
				[
					"CHILD",
					{
						name: "CHILD",
						polygons: [],
						texts: [],
						instances: [
							{
								id: "child-leaf",
								cellRef: "LEAF",
								x: 10,
								y: 0,
								rotation: 90,
								mirror: false,
								magnification: 1,
								boundingBox,
							},
						],
						boundingBox,
						skipInMinimap: false,
					},
				],
				[
					"TOP",
					{
						name: "TOP",
						polygons: [],
						texts: [],
						instances: [
							{
								id: "top-child",
								cellRef: "CHILD",
								x: 100,
								y: 50,
								rotation: 0,
								mirror: true,
								magnification: 1,
								boundingBox,
							},
						],
						boundingBox,
						skipInMinimap: false,
					},
				],
			]),
			topCells: ["TOP"],
		};

		const renderer = new GDSRenderer(new SpatialIndex(), new Container());
		const result = await renderer.render(nestedDocument, {
			maxDepth: 2,
			maxPolygonsPerRender: 10,
			fillMode: true,
			layerVisibility: new Map([["1:0", true]]),
		});

		expect(result.graphicsItems).toHaveLength(1);
		expect(result.graphicsItems[0]).toMatchObject({
			minX: 109,
			minY: 48,
			maxX: 110,
			maxY: 50,
		});
	});

	it("marks a hierarchy-depth-limited result as incomplete", async () => {
		const top = document.cells.get("TOP");
		if (!top) throw new Error("Missing test top cell");
		const hierarchicalDocument: GDSDocument = {
			...document,
			cells: new Map([
				["LEAF", { ...top, name: "LEAF" }],
				[
					"TOP",
					{
						...top,
						name: "TOP",
						polygons: [],
						instances: [
							{
								id: "leaf-instance",
								cellRef: "LEAF",
								x: 0,
								y: 0,
								rotation: 0,
								mirror: false,
								magnification: 1,
								boundingBox,
							},
						],
					},
				],
			]),
		};
		const renderer = new GDSRenderer(new SpatialIndex(), new Container());
		const progressValues: number[] = [];
		const result = await renderer.render(
			hierarchicalDocument,
			{
				maxDepth: 0,
				maxPolygonsPerRender: 10,
				fillMode: true,
				layerVisibility: new Map([["1:0", true]]),
			},
			(progress) => progressValues.push(progress),
		);
		expect(result.renderedPolygons).toBe(0);
		expect(result.depthLimited).toBe(true);
		expect(progressValues.length).toBeGreaterThan(0);
		expect(progressValues.every(Number.isFinite)).toBe(true);
	});

	it("renders only explicitly selected roots while retaining the full cell map", async () => {
		const top = document.cells.get("TOP");
		if (!top) throw new Error("Missing test top cell");
		const multiTopDocument: GDSDocument = {
			...document,
			cells: new Map([
				["TOP_A", { ...top, name: "TOP_A", polygons: [polygon("a")] }],
				["TOP_B", { ...top, name: "TOP_B", polygons: [polygon("b")] }],
			]),
			topCells: ["TOP_A", "TOP_B"],
		};
		const renderer = new GDSRenderer(new SpatialIndex(), new Container());
		const result = await renderer.render(multiTopDocument, {
			maxDepth: 0,
			maxPolygonsPerRender: 10,
			fillMode: true,
			layerVisibility: new Map([["1:0", true]]),
			rootCellNames: ["TOP_B"],
		});

		expect(result.renderedPolygons).toBe(1);
		expect(result.graphicsItems).toHaveLength(1);
		expect(result.graphicsItems[0]?.id).toContain("TOP_B");
	});
});
