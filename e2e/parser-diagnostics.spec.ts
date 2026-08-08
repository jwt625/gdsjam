import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { GDSJamTestApi } from "../src/lib/testing/e2eTestApi";
import { expect, test } from "./fixtures";

const cases = [
	{ fileName: "missing_units.gds", diagnostic: "missing" },
	{ fileName: "invalid_units.gds", diagnostic: "invalid" },
] as const;

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.waitForFunction(() => window.__GDSJAM_TEST__?.version === 1);
});

for (const fixtureCase of cases) {
	test(`${fixtureCase.diagnostic} UNITS remains visible and preserves semantic elements`, async ({
		page,
		consoleMessages,
	}) => {
		const fixturePath = fileURLToPath(
			new URL(
				`../tests/fixtures/devlog-007/parser-diagnostics/${fixtureCase.fileName}`,
				import.meta.url,
			),
		);
		const fixture = Array.from(await readFile(fixturePath));
		const result = await page.evaluate(
			async ({ bytes, fileName }) => {
				const api = window.__GDSJAM_TEST__ as GDSJamTestApi;
				await api.loadFixture(Uint8Array.from(bytes).buffer, fileName);
				return {
					diagnostics: await api.waitForRenderIdle(),
					digest: await api.getSemanticDigest(),
				};
			},
			{ bytes: fixture, fileName: fixtureCase.fileName },
		);

		expect(result.diagnostics.status).toBe("partial-malformed");
		expect(result.diagnostics.issues).toContainEqual(
			expect.objectContaining({
				code: "malformed",
				message: expect.stringContaining("provisional 1 nm DBU"),
			}),
		);
		expect(result.digest.snapshot.units).toEqual({ database: 1e-9, user: 1e-6 });
		expect(result.digest.snapshot.semanticElements).toEqual({
			boxes: [
				{
					cellName: "TOP",
					layer: 7,
					boxType: 3,
					bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
				},
			],
			textMarkers: [
				{
					cellName: "TOP",
					content: "device-A",
					layer: 12,
					textType: 4,
					origin: { x: 100, y: -50 },
					representation: "origin-marker",
				},
			],
		});
		await expect(page.getByTestId("render-diagnostics-warning")).toContainText(
			"provisional 1 nm DBU",
		);
		expect(consoleMessages.filter((line) => line.startsWith("[error]"))).toEqual([]);
	});
}
