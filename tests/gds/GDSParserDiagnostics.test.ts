import { RecordType } from "gdsii";
import { describe, expect, it } from "vitest";
import { buildGDSDocument } from "../../src/lib/gds/GDSParser";

type TestRecord = { tag: number; data: unknown };
const record = (tag: number, data: unknown = null): TestRecord => ({ tag, data });
const beginCell = (name: string): TestRecord[] => [
	record(RecordType.UNITS, { userUnit: 0.001, metersPerUnit: 1e-9 }),
	record(RecordType.BGNSTR),
	record(RecordType.STRNAME, name),
];

describe("GDS parser semantic elements and diagnostics", () => {
	it("represents BOX as renderable polygon geometry with semantic provenance", async () => {
		const document = await buildGDSDocument([
			...beginCell("TOP"),
			record(RecordType.BOX),
			record(RecordType.LAYER, 7),
			record(RecordType.BOXTYPE, 3),
			record(RecordType.XY, [
				[0, 0],
				[20, 0],
				[20, 10],
				[0, 10],
				[0, 0],
			]),
			record(RecordType.ENDEL),
			record(RecordType.ENDSTR),
		]);

		const polygon = document.cells.get("TOP")?.polygons[0];
		expect(polygon).toMatchObject({
			layer: 7,
			datatype: 3,
			boxType: 3,
			sourceType: "box",
			boundingBox: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
		});
		expect(document.layers.has("7:3")).toBe(true);
		expect(document.diagnostics.malformed.count).toBe(0);
	});

	it("preserves TEXT content, origin, layer, texttype, and transform as a semantic marker", async () => {
		const document = await buildGDSDocument([
			...beginCell("TOP"),
			record(RecordType.TEXT),
			record(RecordType.LAYER, 12),
			record(RecordType.TEXTTYPE, 4),
			record(RecordType.PRESENTATION, 5),
			record(RecordType.STRANS, 0x8006),
			record(RecordType.MAG, 2),
			record(RecordType.ANGLE, 90),
			record(RecordType.XY, [[100, -50]]),
			record(RecordType.STRING, "device-A"),
			record(RecordType.ENDEL),
			record(RecordType.ENDSTR),
		]);

		expect(document.cells.get("TOP")?.texts[0]).toMatchObject({
			content: "device-A",
			layer: 12,
			textType: 4,
			origin: { x: 100, y: -50 },
			rotation: 90,
			mirror: true,
			magnification: 2,
			absoluteRotation: true,
			absoluteMagnification: true,
			presentation: 5,
			boundsKind: "origin-marker",
			boundingBox: { minX: 100, minY: -50, maxX: 100, maxY: -50 },
		});
	});

	it("keeps valid content and reports unsupported and malformed elements", async () => {
		const document = await buildGDSDocument([
			...beginCell("TOP"),
			record(RecordType.BOUNDARY),
			record(RecordType.LAYER, 1),
			record(RecordType.DATATYPE, 0),
			record(RecordType.XY, [
				[0, 0],
				[1, 0],
			]),
			record(RecordType.ENDEL),
			record(RecordType.NODE),
			record(RecordType.ENDEL),
			record(RecordType.TEXTNODE),
			record(RecordType.ENDEL),
			record(RecordType.ENDSTR),
		]);

		expect(document.cells.has("TOP")).toBe(true);
		expect(document.diagnostics.malformed).toMatchObject({ count: 1 });
		expect(document.diagnostics.malformed.details[0]).toMatchObject({
			cellName: "TOP",
			elementType: "BOUNDARY",
			recordIndex: 3,
		});
		expect(document.diagnostics.unsupportedElements).toEqual({ NODE: 1, TEXTNODE: 1 });
		expect(document.diagnostics.unsupported.count).toBe(2);
	});

	it("attaches unresolved-reference and bounded cycle paths", async () => {
		const reference = (target: string): TestRecord[] => [
			record(RecordType.SREF),
			record(RecordType.SNAME, target),
			record(RecordType.XY, [[0, 0]]),
			record(RecordType.ENDEL),
		];
		const document = await buildGDSDocument([
			...beginCell("A"),
			...reference("B"),
			...reference("MISSING"),
			record(RecordType.ENDSTR),
			...beginCell("B"),
			...reference("A"),
			record(RecordType.ENDSTR),
		]);

		expect(document.diagnostics.unresolvedReferences).toMatchObject({ count: 1 });
		expect(document.diagnostics.unresolvedReferences.details[0]?.path).toEqual(["A", "MISSING"]);
		expect(document.diagnostics.referenceCycles).toMatchObject({ count: 1 });
		expect(document.diagnostics.referenceCycles.details[0]?.path).toEqual(["A", "B", "A"]);
	});

	it("reports missing UNITS instead of silently accepting the provisional scale", async () => {
		const document = await buildGDSDocument([
			record(RecordType.BGNSTR),
			record(RecordType.STRNAME, "TOP"),
			record(RecordType.ENDSTR),
		]);
		expect(document.units).toEqual({ database: 1e-9, user: 1e-6 });
		expect(document.diagnostics.malformed.details).toContainEqual(
			expect.objectContaining({
				elementType: "UNITS",
				code: "missing-units",
				message: expect.stringContaining("provisional 1 nm DBU"),
			}),
		);

		const invalid = await buildGDSDocument([
			record(RecordType.UNITS, { userUnit: 0, metersPerUnit: Number.NaN }),
			record(RecordType.BGNSTR),
			record(RecordType.STRNAME, "TOP"),
			record(RecordType.ENDSTR),
		]);
		expect(invalid.diagnostics.malformed.details).toContainEqual(
			expect.objectContaining({
				elementType: "UNITS",
				code: "invalid-units",
				message: expect.stringContaining("Invalid GDS"),
			}),
		);
	});
});
