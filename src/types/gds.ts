/**
 * GDSII Type Definitions
 * Coordinate system: integer database-unit (DBU) counts in a Y-up world.
 * Convert to physical units only at UI/API boundaries using GDSDocument.units.
 */

export interface Point {
	x: number;
	y: number;
}

export interface BoundingBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface Polygon {
	id: string;
	layer: number;
	datatype: number;
	points: Point[];
	boundingBox: BoundingBox;
}

export interface CellInstance {
	id: string;
	cellRef: string; // Reference to cell name
	x: number;
	y: number;
	rotation: number; // Degrees
	mirror: boolean; // Mirror across X-axis
	magnification: number;
	absoluteRotation?: boolean; // GDS STRANS absolute-angle flag
	absoluteMagnification?: boolean; // GDS STRANS absolute-magnification flag
	arrayRows?: number;
	arrayCols?: number;
	arrayColumnVector?: Point; // Complete origin-to-column-end displacement
	arrayRowVector?: Point; // Complete origin-to-row-end displacement
	boundingBox: BoundingBox;
}

/**
 * Source-level structure reference retained by the parser. Unlike `CellInstance`,
 * an AREF remains one compact record instead of being eagerly expanded.
 */
export interface CellReference extends CellInstance {}

export interface Cell {
	name: string;
	polygons: Polygon[];
	instances: CellInstance[];
	/** Compact source references. `instances` remains the legacy rendering adapter. */
	references?: CellReference[];
	boundingBox: BoundingBox;
	skipInMinimap: boolean; // True if cell is < 1% of layout extent (for LOD culling)
}

export interface Layer {
	layer: number;
	datatype: number;
	name?: string;
	color: string; // Hex color
	visible: boolean;
}

export interface GDSDocument {
	name: string;
	cells: Map<string, Cell>;
	layers: Map<string, Layer>; // Key: "layer:datatype"
	topCells: string[]; // Names of top-level cells
	boundingBox: BoundingBox;
	units: {
		database: number; // Physical size of one database unit, in meters
		user: number; // Physical size of one user unit, in meters
	};
}

export interface FileStatistics {
	fileName: string;
	fileSizeBytes: number;
	parseTimeMs: number;
	totalCells: number;
	topCellCount: number;
	topCellNames: string[];
	totalPolygons: number;
	totalInstances: number;
	layerStats: Map<
		string,
		{
			layer: number;
			datatype: number;
			polygonCount: number;
		}
	>;
	boundingBox: BoundingBox;
	layoutWidth: number; // in micrometers
	layoutHeight: number; // in micrometers
}
