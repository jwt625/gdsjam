import { describe, expect, it, vi } from "vitest";
import { type DocumentRenderScope, PixiRenderer } from "../../src/lib/renderer/PixiRenderer";
import type { GDSDocument } from "../../src/types/gds";

const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const document: GDSDocument = {
	name: "previous-layout",
	cells: new Map(),
	layers: new Map(),
	topCells: ["OLD_TOP"],
	boundingBox: bounds,
	units: { database: 1e-9, user: 1e-6 },
	diagnostics: {
		unsupportedElements: {},
		unsupported: { count: 0, details: [] },
		malformed: { count: 0, details: [] },
		unresolvedReferences: { count: 0, details: [] },
		referenceCycles: { count: 0, details: [] },
	},
};

interface RendererInternals {
	currentDocument: GDSDocument | null;
	currentRenderScope: DocumentRenderScope | null;
	performIncrementalRerender(): Promise<void>;
}

describe("PixiRenderer document lifecycle", () => {
	it("cannot resurrect a previous document after explicit unload", () => {
		const renderer = new PixiRenderer();
		const internals = renderer as unknown as RendererInternals;
		internals.currentDocument = document;
		internals.currentRenderScope = { topCellNames: ["OLD_TOP"], bounds };
		const rerender = vi.spyOn(internals, "performIncrementalRerender").mockResolvedValue(undefined);

		renderer.unloadDocument();

		expect(renderer.getCurrentDocument()).toBeNull();
		expect(renderer.getDocumentBoundingBox()).toBeNull();
		renderer.toggleFill();
		expect(rerender).not.toHaveBeenCalled();
	});
});
