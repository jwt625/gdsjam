import { describe, expect, it } from "vitest";
import {
	buildRenderDiagnostics,
	failedRenderDiagnostics,
	renderStatusMessage,
} from "../../src/lib/diagnostics/renderDiagnostics";
import type { Cell, GDSDocument } from "../../src/types/gds";

const box = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const cell = (name: string, refs: string[] = []): Cell => ({
	name,
	polygons: [],
	instances: refs.map((cellRef, index) => ({
		id: String(index),
		cellRef,
		x: 0,
		y: 0,
		rotation: 0,
		mirror: false,
		magnification: 1,
		boundingBox: box,
	})),
	boundingBox: box,
	skipInMinimap: false,
});

const documentWith = (cells: Cell[]): GDSDocument => ({
	name: "fixture",
	cells: new Map(cells.map((value) => [value.name, value])),
	layers: new Map(),
	topCells: [cells[0]?.name ?? ""],
	boundingBox: box,
	units: { database: 1e-9, user: 1e-6 },
});

describe("render diagnostics", () => {
	it("reports complete for a fully represented document", () => {
		const result = buildRenderDiagnostics(documentWith([cell("TOP")]), {
			budgetExhausted: false,
			depthLimited: false,
			renderedPolygons: 4,
			polygonBudget: 100,
		});
		expect(result.status).toBe("complete");
		expect(renderStatusMessage(result)).toBe("Render complete");
	});

	it("prioritizes polygon budget exhaustion and never calls it complete", () => {
		const result = buildRenderDiagnostics(documentWith([cell("TOP", ["MISSING"])]), {
			budgetExhausted: true,
			depthLimited: false,
			renderedPolygons: 100,
			polygonBudget: 100,
		});
		expect(result.status).toBe("partial-budget");
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"unresolved-reference",
			"polygon-budget",
		]);
		expect(renderStatusMessage(result)).toContain("incomplete");
	});

	it("reports unresolved references and bounded cycles", () => {
		const unresolved = buildRenderDiagnostics(documentWith([cell("TOP", ["MISSING"])]), {
			budgetExhausted: false,
			depthLimited: false,
			renderedPolygons: 0,
			polygonBudget: 100,
		});
		expect(unresolved.status).toBe("partial-unresolved");

		const cyclic = buildRenderDiagnostics(documentWith([cell("A", ["B"]), cell("B", ["A"])]), {
			budgetExhausted: false,
			depthLimited: false,
			renderedPolygons: 0,
			polygonBudget: 100,
		});
		expect(cyclic.status).toBe("partial-cycle");
		expect(cyclic.issues).toHaveLength(1);
	});

	it("reports hierarchy depth truncation", () => {
		const result = buildRenderDiagnostics(documentWith([cell("TOP")]), {
			budgetExhausted: false,
			depthLimited: true,
			renderedPolygons: 0,
			polygonBudget: 100,
		});
		expect(result.status).toBe("partial-depth");
		expect(renderStatusMessage(result)).toContain("incomplete");
	});

	it("represents failures explicitly", () => {
		const result = failedRenderDiagnostics(new Error("GPU allocation failed"));
		expect(result.status).toBe("failed");
		expect(result.issues[0]?.message).toBe("GPU allocation failed");
	});
});
