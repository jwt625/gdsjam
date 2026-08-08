import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGDSII } from "../../src/lib/gds/GDSParser";

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

interface Oracle {
	fixture: string;
	topCells: string[];
	units: {
		userUnitMeters: number;
		databaseUnitMeters: number;
		databaseUnitsPerUserUnit: number;
	};
	documentBoundsDbu: Bounds;
	cells: Array<{
		name: string;
		references: Array<{
			cell: string;
			rotationDegrees: number;
			xReflection: boolean;
			magnification: number;
			array?: {
				columns: number;
				rows: number;
				v1Dbu: [number, number];
				v2Dbu: [number, number];
			};
		}>;
	}>;
	flattenedTopCells: Array<{ name: string; polygonCount: number }>;
}

interface Manifest {
	schemaVersion: number;
	gdstkVersion: string;
	fixtures: Array<{
		name: string;
		gds: { file: string; bytes: number; sha256: string };
		oracle: { file: string; bytes: number; sha256: string };
	}>;
}

const fixtureDirectory = resolve(process.cwd(), "tests/fixtures/devlog-007");

async function readJson<T>(file: string): Promise<T> {
	return JSON.parse(await readFile(resolve(fixtureDirectory, file), "utf8")) as T;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function expectBoundsClose(actual: Bounds, expected: Bounds): void {
	for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
		expect(actual[key], key).toBeCloseTo(expected[key], 6);
	}
}

describe("DevLog-007 synthetic GDS fixtures", () => {
	it("tracks deterministic fixture and oracle bytes", async () => {
		const manifest = await readJson<Manifest>("manifest.json");
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.gdstkVersion).toBe("1.0.1");
		expect(manifest.fixtures.map((fixture) => fixture.name)).toEqual([
			"deep_hierarchy",
			"multiple_top_cells",
			"non_default_dbu",
			"skewed_aref",
			"transformed_sref",
		]);

		for (const fixture of manifest.fixtures) {
			for (const artifact of [fixture.gds, fixture.oracle]) {
				const bytes = await readFile(resolve(fixtureDirectory, artifact.file));
				expect(bytes.byteLength, artifact.file).toBe(artifact.bytes);
				expect(sha256(bytes), artifact.file).toBe(artifact.sha256);
			}
		}
	});

	it("encodes the intended units, transform, array, and multi-top edge cases", async () => {
		const units = await readJson<Oracle>("non_default_dbu.semantic.json");
		expect(units.units).toEqual({
			userUnitMeters: 1e-6,
			databaseUnitMeters: 5e-9,
			databaseUnitsPerUserUnit: 200,
			displayUnit: "um",
		});

		const transformed = await readJson<Oracle>("transformed_sref.semantic.json");
		const transformedReferences = transformed.cells.find(
			(cell) => cell.name === "TOP_TRANSFORMED_SREF",
		)?.references;
		expect(transformedReferences).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rotationDegrees: 90,
					xReflection: true,
					magnification: 2,
				}),
				expect.objectContaining({
					rotationDegrees: 180,
					xReflection: false,
					magnification: 0.5,
				}),
			]),
		);

		const array = await readJson<Oracle>("skewed_aref.semantic.json");
		const arrayReferences = array.cells.find((cell) => cell.name === "TOP_SKEWED_AREF")?.references;
		expect(arrayReferences).toHaveLength(1);
		expect(arrayReferences?.[0]?.array).toMatchObject({
			columns: 3,
			rows: 2,
			v1Dbu: [7000, 3000],
			v2Dbu: [-3000, 7000],
		});

		const multipleTop = await readJson<Oracle>("multiple_top_cells.semantic.json");
		expect(multipleTop.topCells).toEqual(["TOP_A", "TOP_B"]);
		expect(multipleTop.documentBoundsDbu).toEqual({
			minX: -12000,
			minY: -2000,
			maxX: 28000,
			maxY: 10000,
		});
	});

	it.each([
		"deep_hierarchy",
		"multiple_top_cells",
		"non_default_dbu",
		"skewed_aref",
		"transformed_sref",
	])("parses %s with oracle top cells, units, and bounds", async (fixtureName) => {
		const oracle = await readJson<Oracle>(`${fixtureName}.semantic.json`);
		const bytes = await readFile(resolve(fixtureDirectory, `${fixtureName}.gds`));
		const fileBuffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		const { document } = await parseGDSII(fileBuffer, `${fixtureName}.gds`);

		expect([...document.topCells].sort()).toEqual(oracle.topCells);
		expect(document.units.database).toBeCloseTo(oracle.units.databaseUnitMeters, 15);
		expect(document.units.user).toBeCloseTo(oracle.units.userUnitMeters, 15);
		expectBoundsClose(document.boundingBox, oracle.documentBoundsDbu);
	});
});
