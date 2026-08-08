import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { get } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";
import { parseGDSII } from "../../src/lib/gds/GDSParser";
import { gdsStore } from "../../src/stores/gdsStore";

async function parseFixture(name: string) {
	const bytes = await readFile(resolve(process.cwd(), "tests/fixtures/devlog-007", `${name}.gds`));
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
	return (await parseGDSII(buffer, `${name}.gds`)).document;
}

afterEach(() => gdsStore.reset());

describe("gdsStore top-cell render scope", () => {
	it("requires an explicit choice for the deterministic multiple-top fixture", async () => {
		const document = await parseFixture("multiple_top_cells");
		gdsStore.setDocument(document, "multiple_top_cells.gds");

		const initial = get(gdsStore);
		expect(initial.sceneIndex?.topCells).toEqual(["TOP_A", "TOP_B"]);
		expect(initial.topCellSelection).toEqual({ mode: "required" });
		expect(initial.renderDocument).toBeNull();
		expect(initial.selectedBounds).toBeNull();
		expect(initial.aggregateBounds).toEqual(document.boundingBox);

		gdsStore.selectTopCell("TOP_A");
		const selected = get(gdsStore);
		expect(selected.document).toBe(document);
		expect(selected.renderDocument?.cells).toBe(document.cells);
		expect(selected.renderDocument?.topCells).toEqual(["TOP_A"]);
		expect(selected.selectedBounds).toEqual(selected.sceneIndex?.cells.get("TOP_A")?.bounds);
		expect(selected.renderDocument?.boundingBox).toEqual(selected.selectedBounds);
		expect(selected.aggregateBounds).toEqual(document.boundingBox);

		gdsStore.showAllTopCells();
		const all = get(gdsStore);
		expect(all.topCellSelection).toEqual({ mode: "all" });
		expect(all.renderDocument?.topCells).toEqual(document.topCells);
		expect(all.selectedBounds).toEqual(document.boundingBox);
	});

	it("keeps the existing automatic render path for a single top cell", async () => {
		const document = await parseFixture("non_default_dbu");
		gdsStore.setDocument(document, "non_default_dbu.gds");

		const state = get(gdsStore);
		expect(state.topCellSelection).toEqual({
			mode: "single",
			cellName: "TOP_NON_DEFAULT_DBU",
		});
		expect(state.renderDocument?.topCells).toEqual(["TOP_NON_DEFAULT_DBU"]);
		expect(state.selectedBounds).toEqual(document.boundingBox);
	});
});
