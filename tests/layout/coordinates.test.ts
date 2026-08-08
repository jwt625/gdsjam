import { describe, expect, it } from "vitest";
import {
	databaseUnitsToMicrometers,
	decodeGDSUnits,
	micrometersToDatabaseUnits,
	toLegacyDocumentUnits,
} from "../../src/lib/layout/coordinates";

describe("layout coordinate contract", () => {
	it.each([
		{ databaseMeters: 1e-9, dbuInUserUnits: 0.001, expectedMicrometers: 1 },
		{ databaseMeters: 5e-9, dbuInUserUnits: 0.005, expectedMicrometers: 5 },
		{ databaseMeters: 0.25e-9, dbuInUserUnits: 0.00025, expectedMicrometers: 0.25 },
	])("preserves non-default DBU declarations", (fixture) => {
		const units = decodeGDSUnits({
			userUnit: fixture.dbuInUserUnits,
			metersPerUnit: fixture.databaseMeters,
		});

		expect(units.databaseMeters).toBe(fixture.databaseMeters);
		expect(units.userUnitMeters).toBeCloseTo(1e-6, 15);
		expect(databaseUnitsToMicrometers(1000, units.databaseMeters)).toBeCloseTo(
			fixture.expectedMicrometers,
			12,
		);
		expect(
			micrometersToDatabaseUnits(fixture.expectedMicrometers, units.databaseMeters),
		).toBeCloseTo(1000, 12);
		expect(toLegacyDocumentUnits(units)).toEqual({
			database: fixture.databaseMeters,
			user: units.userUnitMeters,
		});
	});

	it("rejects invalid physical units", () => {
		expect(() => decodeGDSUnits({ userUnit: 0, metersPerUnit: 1e-9 })).toThrow();
		expect(() => decodeGDSUnits({ userUnit: 0.001, metersPerUnit: 0 })).toThrow();
	});
});
