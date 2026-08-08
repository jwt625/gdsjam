import { describe, expect, it, vi } from "vitest";
import type { RenderDiagnostics } from "../../src/lib/diagnostics/renderDiagnostics";
import { PixiRenderer } from "../../src/lib/renderer/PixiRenderer";
import type { GDSDocument } from "../../src/types/gds";

const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const document: GDSDocument = {
	name: "diagnostics",
	cells: new Map([
		[
			"TOP",
			{
				name: "TOP",
				polygons: [],
				instances: [],
				boundingBox: bounds,
				skipInMinimap: false,
			},
		],
	]),
	layers: new Map(),
	topCells: ["TOP"],
	boundingBox: bounds,
	units: { database: 1e-9, user: 1e-6 },
};

describe("PixiRenderer diagnostics", () => {
	it("reuses the progress callback for incremental rerenders", async () => {
		const renderer = new PixiRenderer();
		const results = [
			{
				totalPolygons: 0,
				renderedPolygons: 0,
				graphicsItems: [],
				budgetExhausted: false,
				depthLimited: true,
			},
			{
				totalPolygons: 0,
				renderedPolygons: 0,
				graphicsItems: [],
				budgetExhausted: false,
				depthLimited: false,
			},
		];
		const internals = renderer as unknown as {
			isRerendering: boolean;
			lodManager: { getScaledBudget: () => number };
			gdsRenderer: { render: () => Promise<(typeof results)[number]> };
			clear: () => void;
			updateViewport: () => void;
		};
		internals.isRerendering = true;
		internals.lodManager = { getScaledBudget: () => 100 };
		internals.gdsRenderer = {
			render: vi.fn(async () => {
				const result = results.shift();
				if (!result) throw new Error("Missing render result");
				return result;
			}),
		};
		internals.clear = vi.fn();
		internals.updateViewport = vi.fn();

		const finalDiagnostics: RenderDiagnostics[] = [];
		await renderer.renderGDSDocument(
			document,
			(progress, _message, diagnostics) => {
				if (progress === 100 && diagnostics) finalDiagnostics.push(diagnostics);
			},
			true,
		);
		await renderer.renderGDSDocument(document, undefined, true);

		expect(finalDiagnostics.map(({ status }) => status)).toEqual(["partial-depth", "complete"]);
	});
});
