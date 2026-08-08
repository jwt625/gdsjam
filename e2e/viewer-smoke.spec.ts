import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { GDSJamTestApi } from "../src/lib/testing/e2eTestApi";
import { expect, test } from "./fixtures";

const fixturePath = fileURLToPath(
	new URL("../tests/fixtures/devlog-007/non_default_dbu.gds", import.meta.url),
);
const partialFixturePath = fileURLToPath(
	new URL("../tests/fixtures/devlog-007/deep_hierarchy.gds", import.meta.url),
);
const multipleTopFixturePath = fileURLToPath(
	new URL("../tests/fixtures/devlog-007/multiple_top_cells.gds", import.meta.url),
);

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const lifecycle: string[] = [];
		Object.defineProperty(window, "__GDSJAM_E2E_LIFECYCLE__", { value: lifecycle });
		window.addEventListener("gdsjam:e2e-lifecycle", (event) => {
			lifecycle.push((event as CustomEvent<{ phase: string }>).detail.phase);
		});
	});
	await page.goto("/");
	await page.waitForFunction(() => window.__GDSJAM_TEST__?.version === 1);
});

test("loads a deterministic ArrayBuffer fixture and exposes render state", async ({
	page,
	consoleMessages,
}) => {
	const fixture = Array.from(await readFile(fixturePath));
	const result = await page.evaluate(async (bytes) => {
		const api = window.__GDSJAM_TEST__ as GDSJamTestApi;
		await api.loadFixture(Uint8Array.from(bytes).buffer, "non_default_dbu.gds");
		const diagnostics = await api.waitForRenderIdle();
		return {
			diagnostics,
			overview: api.getCompleteOverviewTelemetry(),
			digest: await api.getSemanticDigest(),
			viewport: api.getWorldViewport(),
		};
	}, fixture);

	expect(result.diagnostics.status).toBe("complete");
	const expectedPhysicalEdge = 256 * (await page.evaluate(() => window.devicePixelRatio));
	expect(result.overview).toMatchObject({
		status: "ready",
		complete: true,
		physicalWidth: expectedPhysicalEdge,
		polygonOccurrences: 2,
		layerCount: 2,
	});
	expect(result.overview?.byteLength).toBeGreaterThan(0);
	expect(result.digest.snapshot).toMatchObject({
		fileName: "non_default_dbu.gds",
		topCells: ["TOP_NON_DEFAULT_DBU"],
		cellCount: 1,
		polygonCount: 2,
		instanceCount: 0,
	});
	expect(result.digest.snapshot.units?.database).toBeCloseTo(5e-9, 20);
	expect(result.digest.sha256).toMatch(/^[a-f0-9]{64}$/);
	expect(result.viewport.maxX).toBeGreaterThan(result.viewport.minX);
	await expect(page.getByTestId("viewer-canvas")).toBeVisible();
	const lifecycle = await page.evaluate(
		() => (window as unknown as { __GDSJAM_E2E_LIFECYCLE__: string[] }).__GDSJAM_E2E_LIFECYCLE__,
	);
	expect(lifecycle).toEqual(
		expect.arrayContaining([
			"api-ready",
			"fixture-load-started",
			"document-loaded",
			"render-started",
			"render-idle",
		]),
	);
	expect(consoleMessages.filter((line) => line.startsWith("[error]"))).toEqual([]);
});

test("sets and reads a world-space viewport deterministically", async ({
	page,
	consoleMessages,
}) => {
	const fixture = Array.from(await readFile(fixturePath));
	const viewport = await page.evaluate(async (bytes) => {
		const api = window.__GDSJAM_TEST__ as GDSJamTestApi;
		await api.loadFixture(Uint8Array.from(bytes).buffer, "viewport.gds");
		await api.waitForRenderIdle();
		return api.setWorldViewport({ minX: 0, minY: 0, maxX: 1_000, maxY: 500 });
	}, fixture);

	const centerX = (viewport.minX + viewport.maxX) / 2;
	const centerY = (viewport.minY + viewport.maxY) / 2;
	expect(centerX).toBeCloseTo(500, 6);
	expect(centerY).toBeCloseTo(250, 6);
	expect(viewport.minX).toBeLessThanOrEqual(0);
	expect(viewport.maxX).toBeGreaterThanOrEqual(1_000);
	expect(consoleMessages.filter((line) => line.startsWith("[error]"))).toEqual([]);
});

test("shows a warning when bounded hierarchy rendering omits geometry", async ({
	page,
	consoleMessages,
}) => {
	const fixture = Array.from(await readFile(partialFixturePath));
	const diagnostics = await page.evaluate(async (bytes) => {
		const api = window.__GDSJAM_TEST__ as GDSJamTestApi;
		await api.loadFixture(Uint8Array.from(bytes).buffer, "deep_hierarchy.gds");
		return api.waitForRenderIdle();
	}, fixture);

	expect(diagnostics.status).toBe("partial-depth");
	expect(diagnostics.issues).toContainEqual(expect.objectContaining({ code: "hierarchy-depth" }));
	await expect(page.getByTestId("render-diagnostics-warning")).toContainText(
		"Layout is partially rendered",
	);
	expect(consoleMessages.filter((line) => line.startsWith("[error]"))).toEqual([]);
});

test("requires a top-cell choice and can explicitly render the aggregate layout", async ({
	page,
	consoleMessages,
}) => {
	const fixture = Array.from(await readFile(multipleTopFixturePath));
	await page.evaluate(async (bytes) => {
		const api = window.__GDSJAM_TEST__ as GDSJamTestApi;
		await api.loadFixture(Uint8Array.from(bytes).buffer, "multiple_top_cells.gds");
	}, fixture);

	const selector = page.getByTestId("top-cell-selector");
	await expect(selector).toBeVisible();
	await expect(selector).toContainText("Select one top-level cell to render");
	const scopeSelect = page.getByLabel("Top cell render scope");
	await expect(scopeSelect).toHaveValue("");

	await scopeSelect.selectOption("TOP_A");
	const selected = await page.evaluate(async () => {
		const api = window.__GDSJAM_TEST__ as GDSJamTestApi;
		await api.waitForRenderIdle();
		return api.getRenderScope();
	});
	expect(selected).toEqual({
		selection: { mode: "single", cellName: "TOP_A" },
		aggregateBounds: { minX: -12000, minY: -2000, maxX: 28000, maxY: 10000 },
		selectedBounds: { minX: -12000, minY: -2000, maxX: -8000, maxY: 2000 },
	});

	await scopeSelect.selectOption("__all__");
	const all = await page.evaluate(async () => {
		const api = window.__GDSJAM_TEST__ as GDSJamTestApi;
		await api.waitForRenderIdle();
		return api.getRenderScope();
	});
	expect(all.selection).toEqual({ mode: "all" });
	expect(all.selectedBounds).toEqual(all.aggregateBounds);
	expect(consoleMessages.filter((line) => line.startsWith("[error]"))).toEqual([]);
});
