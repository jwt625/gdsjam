/**
 * GDSII Parser - Parse GDSII files using JavaScript gdsii library
 * Converts GDSII binary format to internal GDSDocument format
 */

import { parseGDS, RecordType } from "gdsii";
import type {
	BoundingBox,
	Cell,
	CellInstance,
	GDSDocument,
	Layer,
	Point,
	Polygon,
} from "../../types/gds";

/**
 * Generate a random color for a layer
 */
function generateLayerColor(layer: number, datatype: number): string {
	// Use layer and datatype to generate consistent colors
	const hue = (layer * 137 + datatype * 53) % 360;
	const saturation = 70;
	const lightness = 60;

	// Convert HSL to hex
	const h = hue / 360;
	const s = saturation / 100;
	const l = lightness / 100;

	const hue2rgb = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};

	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;

	const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
	const g = Math.round(hue2rgb(p, q, h) * 255);
	const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Calculate bounding box from points
 */
function calculateBoundingBox(points: Point[]): BoundingBox {
	if (points.length === 0) {
		console.warn("[calculateBoundingBox] Empty points array");
		return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	}

	if (!points[0]) {
		console.error("[calculateBoundingBox] First point is undefined!");
		return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	}

	let minX = points[0].x;
	let minY = points[0].y;
	let maxX = points[0].x;
	let maxY = points[0].y;

	for (const point of points) {
		if (!point) {
			console.error("[calculateBoundingBox] Undefined point in array");
			continue;
		}
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}

	return { minX, minY, maxX, maxY };
}

/**
 * Parse GDSII file and convert to GDSDocument
 */
export async function parseGDSII(fileBuffer: ArrayBuffer): Promise<GDSDocument> {
	console.log("[GDSParser] Starting GDSII parsing...");
	console.log("[GDSParser] File size:", fileBuffer.byteLength, "bytes");

	// Convert ArrayBuffer to Uint8Array
	const fileData = new Uint8Array(fileBuffer);
	console.log("[GDSParser] Converted to Uint8Array");

	// Parse GDSII using JavaScript library
	console.log("[GDSParser] Calling parseGDS...");
	const records = Array.from(parseGDS(fileData)) as Array<{ tag: number; data: any }>;
	console.log("[GDSParser] Parsed", records.length, "records");

	// Build document structure from records
	console.log("[GDSParser] Building GDS document...");
	const document = buildGDSDocument(records);
	console.log("[GDSParser] Document built successfully");
	console.log("[GDSParser] - Library name:", document.name);
	console.log("[GDSParser] - Cells:", document.cells.size);
	console.log("[GDSParser] - Layers:", document.layers.size);
	console.log("[GDSParser] - Top cells:", document.topCells);
	console.log("[GDSParser] - Bounding box:", document.boundingBox);

	return document;
}

/**
 * Build GDSDocument from parsed GDSII records
 */
function buildGDSDocument(records: Array<{ tag: number; data: any }>): GDSDocument {
	console.log("[buildGDSDocument] Processing", records.length, "records");

	const cells = new Map<string, Cell>();
	const layers = new Map<string, Layer>();
	let libraryName = "Untitled";
	let units = { database: 1e-9, user: 1e-6 }; // Default: 1nm database unit, 1µm user unit

	let currentCell: Cell | null = null;
	let currentPolygon: Partial<Polygon> | null = null;
	let currentInstance: Partial<CellInstance> | null = null;
	let currentLayer = 0;
	let currentDatatype = 0;

	let polygonCount = 0;
	let instanceCount = 0;

	// Process records sequentially
	for (const { tag, data } of records) {
		switch (tag) {
			case RecordType.LIBNAME:
				libraryName = data as string;
				break;

			case RecordType.UNITS:
				if (Array.isArray(data) && data.length === 2) {
					units = { database: data[0], user: data[1] };
				}
				break;

			case RecordType.BGNSTR: // Begin structure (cell)
				currentCell = {
					name: "",
					polygons: [],
					instances: [],
					boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
				};
				break;

			case RecordType.STRNAME: // Structure name
				if (currentCell) {
					currentCell.name = data as string;
				}
				break;

			case RecordType.ENDSTR: // End structure
				if (currentCell?.name) {
					cells.set(currentCell.name, currentCell);
				}
				currentCell = null;
				break;

			case RecordType.BOUNDARY: // Begin polygon
				currentPolygon = {
					id: crypto.randomUUID(),
					points: [],
				};
				break;

			case RecordType.LAYER:
				currentLayer = data as number;
				if (currentPolygon) {
					currentPolygon.layer = currentLayer;
				}
				break;

			case RecordType.DATATYPE:
				currentDatatype = data as number;
				if (currentPolygon) {
					currentPolygon.datatype = currentDatatype;
				}
				break;

			case RecordType.XY:
				if (currentPolygon && Array.isArray(data)) {
					// XY data is array of [x, y] pairs: [[x1, y1], [x2, y2], ...]
					const points: Point[] = [];
					for (const coord of data) {
						if (Array.isArray(coord) && coord.length >= 2) {
							points.push({ x: coord[0], y: coord[1] });
						}
					}

					// Debug: Log first polygon's data
					if (polygonCount === 0) {
						console.log("[buildGDSDocument] First polygon XY data:", data);
						console.log("[buildGDSDocument] First polygon points:", points);
					}

					currentPolygon.points = points;
					currentPolygon.boundingBox = calculateBoundingBox(points);

					// Debug: Log first polygon's bounding box
					if (polygonCount === 0) {
						console.log(
							"[buildGDSDocument] First polygon bounding box:",
							currentPolygon.boundingBox,
						);
					}
				} else if (currentInstance && Array.isArray(data) && data.length >= 2) {
					// For instances, XY contains the position
					// Check if it's nested array format
					if (Array.isArray(data[0])) {
						currentInstance.x = data[0][0];
						currentInstance.y = data[0][1];
					} else {
						currentInstance.x = data[0];
						currentInstance.y = data[1];
					}
				}
				break;

			case RecordType.ENDEL: // End element
				if (currentPolygon && currentCell) {
					// Add polygon to current cell
					currentCell.polygons.push(currentPolygon as Polygon);
					polygonCount++;

					// Track layer
					const layerKey = `${currentPolygon.layer}:${currentPolygon.datatype}`;
					if (!layers.has(layerKey)) {
						layers.set(layerKey, {
							layer: currentPolygon.layer!,
							datatype: currentPolygon.datatype!,
							name: `Layer ${currentPolygon.layer}/${currentPolygon.datatype}`,
							color: generateLayerColor(currentPolygon.layer!, currentPolygon.datatype!),
							visible: true,
						});
					}

					currentPolygon = null;
				} else if (currentInstance && currentCell) {
					currentCell.instances.push(currentInstance as CellInstance);
					instanceCount++;
					currentInstance = null;
				}
				break;

			case RecordType.SREF: // Structure reference (instance)
				currentInstance = {
					id: crypto.randomUUID(),
					cellRef: "",
					x: 0,
					y: 0,
					rotation: 0,
					mirror: false,
					magnification: 1.0,
					boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
				};
				break;

			case RecordType.SNAME: // Structure reference name
				if (currentInstance) {
					currentInstance.cellRef = data as string;
				}
				break;

			case RecordType.STRANS: // Transformation flags
				// STRANS contains transformation flags (mirror, etc.)
				if (currentInstance && typeof data === "number") {
					currentInstance.mirror = (data & 0x8000) !== 0; // Bit 15 = mirror
				}
				break;

			case RecordType.MAG: // Magnification
				if (currentInstance) {
					currentInstance.magnification = data as number;
				}
				break;

			case RecordType.ANGLE: // Rotation angle
				if (currentInstance) {
					currentInstance.rotation = data as number;
				}
				break;
		}
	}

	console.log(
		"[buildGDSDocument] Parsed",
		polygonCount,
		"polygons and",
		instanceCount,
		"instances",
	);
	console.log("[buildGDSDocument] Found", cells.size, "cells");

	// Calculate bounding boxes for cells
	console.log("[buildGDSDocument] Calculating cell bounding boxes...");
	for (const cell of cells.values()) {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const polygon of cell.polygons) {
			minX = Math.min(minX, polygon.boundingBox.minX);
			minY = Math.min(minY, polygon.boundingBox.minY);
			maxX = Math.max(maxX, polygon.boundingBox.maxX);
			maxY = Math.max(maxY, polygon.boundingBox.maxY);
		}

		cell.boundingBox = {
			minX: minX === Number.POSITIVE_INFINITY ? 0 : minX,
			minY: minY === Number.POSITIVE_INFINITY ? 0 : minY,
			maxX: maxX === Number.NEGATIVE_INFINITY ? 0 : maxX,
			maxY: maxY === Number.NEGATIVE_INFINITY ? 0 : maxY,
		};
	}

	// Find top cells (cells not referenced by others)
	console.log("[buildGDSDocument] Finding top cells...");
	const allCellNames = new Set(cells.keys());
	const referencedCells = new Set<string>();
	for (const cell of cells.values()) {
		for (const instance of cell.instances) {
			referencedCells.add(instance.cellRef);
		}
	}
	const topCells = Array.from(allCellNames).filter((name) => !referencedCells.has(name));
	console.log("[buildGDSDocument] Top cells:", topCells);

	// Calculate global bounding box
	let globalMinX = Number.POSITIVE_INFINITY;
	let globalMinY = Number.POSITIVE_INFINITY;
	let globalMaxX = Number.NEGATIVE_INFINITY;
	let globalMaxY = Number.NEGATIVE_INFINITY;

	for (const cellName of topCells) {
		const cell = cells.get(cellName);
		if (cell) {
			globalMinX = Math.min(globalMinX, cell.boundingBox.minX);
			globalMinY = Math.min(globalMinY, cell.boundingBox.minY);
			globalMaxX = Math.max(globalMaxX, cell.boundingBox.maxX);
			globalMaxY = Math.max(globalMaxY, cell.boundingBox.maxY);
		}
	}

	return {
		name: libraryName,
		cells,
		layers,
		topCells,
		boundingBox: {
			minX: globalMinX === Number.POSITIVE_INFINITY ? 0 : globalMinX,
			minY: globalMinY === Number.POSITIVE_INFINITY ? 0 : globalMinY,
			maxX: globalMaxX === Number.NEGATIVE_INFINITY ? 0 : globalMaxX,
			maxY: globalMaxY === Number.NEGATIVE_INFINITY ? 0 : globalMaxY,
		},
		units,
	};
}
