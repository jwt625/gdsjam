import type { Point } from "../../types/gds";

/** Compact GDS AREF lattice. Endpoints preserve both components of both vectors. */
export interface ArrayReferenceLattice {
	origin: Point;
	columnEndpoint: Point;
	rowEndpoint: Point;
	columns: number;
	rows: number;
}

export interface ArrayReferencePitch {
	column: Point;
	row: Point;
}

export function getArrayReferencePitch(lattice: ArrayReferenceLattice): ArrayReferencePitch {
	if (!Number.isInteger(lattice.columns) || lattice.columns <= 0) {
		throw new Error(`Invalid AREF column count: ${lattice.columns}`);
	}
	if (!Number.isInteger(lattice.rows) || lattice.rows <= 0) {
		throw new Error(`Invalid AREF row count: ${lattice.rows}`);
	}

	return {
		column: {
			x: (lattice.columnEndpoint.x - lattice.origin.x) / lattice.columns,
			y: (lattice.columnEndpoint.y - lattice.origin.y) / lattice.columns,
		},
		row: {
			x: (lattice.rowEndpoint.x - lattice.origin.x) / lattice.rows,
			y: (lattice.rowEndpoint.y - lattice.origin.y) / lattice.rows,
		},
	};
}

export function getArrayReferencePosition(
	lattice: ArrayReferenceLattice,
	column: number,
	row: number,
): Point {
	if (!Number.isInteger(column) || column < 0 || column >= lattice.columns) {
		throw new Error(`AREF column index ${column} is outside [0, ${lattice.columns})`);
	}
	if (!Number.isInteger(row) || row < 0 || row >= lattice.rows) {
		throw new Error(`AREF row index ${row} is outside [0, ${lattice.rows})`);
	}

	const pitch = getArrayReferencePitch(lattice);
	return {
		x: lattice.origin.x + column * pitch.column.x + row * pitch.row.x,
		y: lattice.origin.y + column * pitch.column.y + row * pitch.row.y,
	};
}
