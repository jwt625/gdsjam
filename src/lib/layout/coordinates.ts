/**
 * Canonical layout-coordinate contract.
 *
 * Parsed GDS coordinates stay as integer database-unit (DBU) counts. Physical
 * conversions happen only at API and UI boundaries; geometry must never be
 * round-tripped through micrometers.
 */
export interface LayoutUnits {
	/** Physical size of one integer database unit, in meters. */
	databaseMeters: number;
	/** Size of one database unit expressed in GDS user units. */
	databaseInUserUnits: number;
	/** Physical size of one GDS user unit, in meters. */
	userUnitMeters: number;
}

export interface RawGDSUnits {
	userUnit: number;
	metersPerUnit: number;
}

export interface LegacyDocumentUnits {
	/** Physical size of one database unit, in meters. */
	database: number;
	/** Physical size of one user unit, in meters. */
	user: number;
}

export function decodeGDSUnits(raw: RawGDSUnits): LayoutUnits {
	if (!Number.isFinite(raw.userUnit) || raw.userUnit <= 0) {
		throw new Error(`Invalid GDS database-unit/user-unit ratio: ${raw.userUnit}`);
	}
	if (!Number.isFinite(raw.metersPerUnit) || raw.metersPerUnit <= 0) {
		throw new Error(`Invalid GDS meters per database unit: ${raw.metersPerUnit}`);
	}

	return {
		databaseMeters: raw.metersPerUnit,
		databaseInUserUnits: raw.userUnit,
		userUnitMeters: raw.metersPerUnit / raw.userUnit,
	};
}

export function toLegacyDocumentUnits(units: LayoutUnits): LegacyDocumentUnits {
	return {
		database: units.databaseMeters,
		user: units.userUnitMeters,
	};
}

export function databaseUnitsToMicrometers(valueDBU: number, databaseMeters: number): number {
	return valueDBU * databaseMeters * 1e6;
}

export function micrometersToDatabaseUnits(
	valueMicrometers: number,
	databaseMeters: number,
): number {
	if (!Number.isFinite(databaseMeters) || databaseMeters <= 0) {
		throw new Error(`Invalid database unit in meters: ${databaseMeters}`);
	}
	return (valueMicrometers * 1e-6) / databaseMeters;
}
