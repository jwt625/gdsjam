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
	sourceType?: "boundary" | "path" | "box";
	boxType?: number;
}

export interface TextLabel {
	id: string;
	content: string;
	layer: number;
	textType: number;
	origin: Point;
	rotation: number;
	mirror: boolean;
	magnification: number;
	absoluteRotation?: boolean;
	absoluteMagnification?: boolean;
	presentation?: number;
	/** A semantic point marker until font-independent glyph bounds are available. */
	boundingBox: BoundingBox;
	boundsKind: "origin-marker";
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

export interface Cell {
	name: string;
	polygons: Polygon[];
	texts: TextLabel[];
	instances: CellInstance[];
	boundingBox: BoundingBox;
	skipInMinimap: boolean; // True if cell is < 1% of layout extent (for LOD culling)
}

export interface ParserDiagnosticDetail {
	code:
		| "unsupported-element"
		| "malformed-element"
		| "missing-units"
		| "invalid-units"
		| "unresolved-reference"
		| "reference-cycle";
	cellName?: string;
	elementType?: string;
	recordIndex?: number;
	path?: string[];
	message: string;
}

export interface ParserDiagnosticGroup {
	count: number;
	details: ParserDiagnosticDetail[];
}

export interface GDSParserDiagnostics {
	unsupportedElements: Record<string, number>;
	unsupported: ParserDiagnosticGroup;
	malformed: ParserDiagnosticGroup;
	unresolvedReferences: ParserDiagnosticGroup;
	referenceCycles: ParserDiagnosticGroup;
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
	diagnostics: GDSParserDiagnostics;
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
