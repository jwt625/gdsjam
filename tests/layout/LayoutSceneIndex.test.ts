import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGDSII } from "../../src/lib/gds/GDSParser";
import { createLayoutSceneIndex } from "../../src/lib/layout/LayoutSceneIndex";
import type {
	Cell,
	CellInstance,
	GDSDocument,
	GDSParserDiagnostics,
	Polygon,
} from "../../src/types/gds";

const fixtureDirectory = resolve(process.cwd(), "tests/fixtures/devlog-007");

async function parseFixture(name: string): Promise<GDSDocument> {
	const bytes = await readFile(resolve(fixtureDirectory, `${name}.gds`));
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	return (await parseGDSII(buffer, `${name}.gds`)).document;
}

function polygon(id: string): Polygon {
	return {
		id,
		layer: 1,
		datatype: 0,
		points: [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		],
		boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
	};
}

function reference(id: string, cellRef: string): CellInstance {
	return {
		id,
		cellRef,
		x: 0,
		y: 0,
		rotation: 0,
		mirror: false,
		magnification: 1,
		boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
	};
}

function cell(name: string, instances: CellInstance[] = []): Cell {
	return {
		name,
		polygons: [polygon(`${name}-random-source-id`)],
		texts: [],
		instances,
		boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
		skipInMinimap: false,
	};
}

function document(cells: Cell[], topCells: string[]): GDSDocument {
	const emptyDiagnostics = (): GDSParserDiagnostics => ({
		unsupportedElements: {},
		unsupported: { count: 0, details: [] },
		malformed: { count: 0, details: [] },
		unresolvedReferences: { count: 0, details: [] },
		referenceCycles: { count: 0, details: [] },
	});
	return {
		name: "TEST",
		cells: new Map(cells.map((item) => [item.name, item])),
		layers: new Map(),
		topCells,
		boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
		units: { database: 1e-9, user: 1e-6 },
		diagnostics: emptyDiagnostics(),
	};
}

describe("LayoutSceneIndex", () => {
	it("retains one compact skewed AREF while the legacy document remains expanded", async () => {
		const parsed = await parseFixture("skewed_aref");
		const legacyTop = parsed.cells.get("TOP_SKEWED_AREF");
		expect(legacyTop?.instances).toHaveLength(6);
		expect(legacyTop?.references).toHaveLength(1);

		const index = createLayoutSceneIndex(parsed);
		const top = index.cells.get("TOP_SKEWED_AREF");
		expect(top?.references).toHaveLength(1);
		expect([...index.cells.values()].reduce((sum, cell) => sum + cell.polygons.length, 0)).toBe(1);
		expect(top?.references[0]).toMatchObject({
			kind: "aref",
			cellRef: "ARRAY_LEAF",
			lattice: {
				origin: { x: 10000, y: 20000 },
				columnEndpoint: { x: 31000, y: 29000 },
				rowEndpoint: { x: 4000, y: 34000 },
				columns: 3,
				rows: 2,
			},
		});
		expect(top?.bounds).toEqual(parsed.boundingBox);
	});

	it("requires an explicit selection for multiple tops and retains aggregate bounds", async () => {
		const parsed = await parseFixture("multiple_top_cells");
		const index = createLayoutSceneIndex(parsed);

		expect(index.topCells).toEqual(["TOP_A", "TOP_B"]);
		expect(index.initialSelection).toEqual({ mode: "required" });
		expect(index.getSelectedBounds(index.initialSelection)).toBeNull();
		expect(index.aggregateBounds).toEqual(parsed.boundingBox);
		expect(index.getSelectedBounds(index.selectTopCell("TOP_A"))).toEqual({
			minX: -12000,
			minY: -2000,
			maxX: -8000,
			maxY: 2000,
		});
		expect(index.getSelectedBounds(index.showAllTopCells())).toEqual(parsed.boundingBox);
		expect(() => index.selectTopCell("SHARED_CHILD")).toThrow("Unknown top cell");
	});

	it("auto-selects a single top and creates stable semantic IDs and paths", async () => {
		const parsed = await parseFixture("transformed_sref");
		const first = createLayoutSceneIndex(parsed);
		const second = createLayoutSceneIndex(parsed);

		expect(first.initialSelection).toEqual({
			mode: "single",
			cellName: "TOP_TRANSFORMED_SREF",
		});
		expect(first.id).toBe(second.id);
		expect([...first.cells.values()].map((item) => item.id)).toEqual(
			[...second.cells.values()].map((item) => item.id),
		);
		const paths = first.getHierarchyPaths();
		expect(paths.map((item) => item.path)).toContain("top:TOP_TRANSFORMED_SREF/ref:0");
		expect(paths).toHaveLength(5);
	});

	it("reports unresolved references while preserving valid local bounds", () => {
		const top = cell("TOP", [reference("random", "MISSING")]);
		const index = createLayoutSceneIndex(document([top], ["TOP"]));

		expect(index.cells.get("TOP")?.bounds).toEqual({
			minX: 0,
			minY: 0,
			maxX: 10,
			maxY: 10,
		});
		expect(index.diagnostics).toEqual([
			expect.objectContaining({
				kind: "unresolved-reference",
				cellName: "TOP",
				referencedCellName: "MISSING",
			}),
		]);
	});

	it("bounds cyclic traversal and emits deterministic cycle paths", () => {
		const a = cell("A", [reference("random-a", "B")]);
		const b = cell("B", [reference("random-b", "A")]);
		const index = createLayoutSceneIndex(document([a, b], ["A"]));

		expect(index.cells.get("A")?.bounds).toEqual({
			minX: 0,
			minY: 0,
			maxX: 10,
			maxY: 10,
		});
		expect(index.diagnostics.some((item) => item.kind === "cyclic-reference")).toBe(true);
		expect(index.getHierarchyPaths()).toHaveLength(4);
		expect(index.buildStatistics.boundsComputations).toBe(4);
	});

	it("memoizes hierarchical bounds for shared subtrees", () => {
		const topA = cell("TOP_A", [reference("top-a", "SHARED")]);
		const topB = cell("TOP_B", [reference("top-b", "SHARED")]);
		const shared = cell("SHARED", [reference("shared", "LEAF")]);
		const leaf = cell("LEAF");
		const index = createLayoutSceneIndex(document([topA, topB, shared, leaf], ["TOP_A", "TOP_B"]));

		// Each cell is evaluated once; subsequent shared/root lookups use cache.
		expect(index.buildStatistics).toEqual({
			boundsComputations: 4,
			boundsCacheHits: 3,
		});
	});

	it("does not use random legacy polygon and instance IDs for semantic identity", () => {
		const first = createLayoutSceneIndex(document([cell("TOP")], ["TOP"]));
		const changedSourceIds = createLayoutSceneIndex(
			document(
				[
					{
						...cell("TOP"),
						polygons: [polygon("another-random-id")],
					},
				],
				["TOP"],
			),
		);

		expect(first.cells.get("TOP")?.polygons[0]?.id).toBe(
			changedSourceIds.cells.get("TOP")?.polygons[0]?.id,
		);
	});

	it("streams deterministic identity independent of cell-map insertion order", () => {
		const alpha = cell("ALPHA");
		const beta = cell("BETA");
		const first = createLayoutSceneIndex(document([alpha, beta], ["ALPHA", "BETA"]));
		const reordered = createLayoutSceneIndex(document([beta, alpha], ["ALPHA", "BETA"]));

		expect(first.id).toBe(reordered.id);
		beta.polygons[0]?.points.push({ x: 5, y: 5 });
		expect(createLayoutSceneIndex(document([beta, alpha], ["ALPHA", "BETA"])).id).not.toBe(
			first.id,
		);
	});

	it("includes semantic text markers in the versioned document identity", () => {
		const top = cell("TOP");
		const withoutText = createLayoutSceneIndex(document([top], ["TOP"]));
		top.texts.push({
			id: "source-id-does-not-define-identity",
			content: "device-A",
			layer: 12,
			textType: 4,
			origin: { x: 5, y: 6 },
			rotation: 0,
			mirror: false,
			magnification: 1,
			boundingBox: { minX: 5, minY: 6, maxX: 5, maxY: 6 },
			boundsKind: "origin-marker",
		});

		expect(createLayoutSceneIndex(document([top], ["TOP"])).id).not.toBe(withoutText.id);
	});

	it("uses legacy instances only when compact source references are absent", () => {
		const top = cell("TOP", [
			{
				...reference("legacy-random-id", "CHILD"),
				absoluteRotation: true,
				absoluteMagnification: true,
			},
		]);
		const index = createLayoutSceneIndex(document([top, cell("CHILD")], ["TOP"]));

		expect(index.cells.get("TOP")?.references).toEqual([
			expect.objectContaining({
				kind: "sref",
				absoluteRotation: true,
				absoluteMagnification: true,
			}),
		]);

		// Presence of an explicitly empty compact list suppresses the fallback.
		top.references = [];
		expect(
			createLayoutSceneIndex(document([top, cell("CHILD")], ["TOP"])).cells.get("TOP")?.references,
		).toHaveLength(0);
	});
});
