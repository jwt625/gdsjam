/**
 * GDSII Parser - Parse GDSII files using JavaScript gdsii library
 * Converts GDSII binary format to internal GDSDocument format
 */

import { parseGDS, RecordType } from "gdsii";
import type {
	BoundingBox,
	Cell,
	CellInstance,
	FileStatistics,
	GDSDocument,
	Layer,
	Point,
	Polygon,
} from "../../types/gds";
import { DEBUG } from "../config";

/**
 * Generate UUID v4 compatible with Safari on iOS
 * Fallback for crypto.randomUUID() which is not supported in older Safari versions
 */
function generateUUID(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}

	// Fallback implementation for Safari iOS
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

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
 * Progress callback for parsing
 */
export type ParseProgressCallback = (progress: number, message: string) => void;

/**
 * Parse GDSII file and convert to GDSDocument
 */
export async function parseGDSII(
	fileBuffer: ArrayBuffer,
	fileName: string,
	onProgress?: ParseProgressCallback,
): Promise<{ document: GDSDocument; statistics: FileStatistics }> {
	const startTime = performance.now();
	const fileSizeMB = fileBuffer.byteLength / 1024 / 1024;

	if (DEBUG) {
		console.log(`[GDSParser] Parsing GDSII file (${fileSizeMB.toFixed(1)} MB)...`);
	}

	try {
		if (fileBuffer.byteLength > 1024 * 1024 * 1024) {
			throw new Error(`File too large (${fileSizeMB.toFixed(0)} MB). Maximum: 1GB.`);
		}

		onProgress?.(10, "Converting file data...");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const fileData = new Uint8Array(fileBuffer);

		onProgress?.(20, "Parsing GDSII records...");
		await new Promise((resolve) => setTimeout(resolve, 0));
		// biome-ignore lint/suspicious/noExplicitAny: External library returns unknown data types
		const records = Array.from(parseGDS(fileData)) as Array<{ tag: number; data: any }>;

		if (DEBUG) {
			console.log(`[GDSParser] Parsed ${records.length} records`);
		}

		if (records.length === 0) {
			throw new Error("No valid GDSII records found. File may be corrupted.");
		}

		onProgress?.(40, "Building document structure...");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const document = await buildGDSDocument(records, onProgress);

		const parseTime = performance.now() - startTime;
		if (DEBUG) {
			console.log(
				`[GDSParser] Complete in ${parseTime.toFixed(0)}ms - ${document.cells.size} cells, ${document.layers.size} layers`,
			);
		}

		// Collect statistics
		onProgress?.(95, "Collecting statistics...");
		let totalPolygons = 0;
		let totalInstances = 0;
		const layerStats = new Map<
			string,
			{
				layer: number;
				datatype: number;
				polygonCount: number;
			}
		>();

		for (const cell of document.cells.values()) {
			totalPolygons += cell.polygons.length;
			totalInstances += cell.instances.length;

			for (const polygon of cell.polygons) {
				const layerKey = `${polygon.layer}:${polygon.datatype}`;
				const existing = layerStats.get(layerKey);
				if (existing) {
					existing.polygonCount++;
				} else {
					layerStats.set(layerKey, {
						layer: polygon.layer,
						datatype: polygon.datatype,
						polygonCount: 1,
					});
				}
			}
		}

		// Convert layout dimensions to micrometers
		// Bounding box is in database units, database unit is in meters
		// So: (database units) * (database meters) / 1e-6 = micrometers
		const layoutWidth =
			((document.boundingBox.maxX - document.boundingBox.minX) * document.units.database) / 1e-6;
		const layoutHeight =
			((document.boundingBox.maxY - document.boundingBox.minY) * document.units.database) / 1e-6;

		const statistics: FileStatistics = {
			fileName,
			fileSizeBytes: fileBuffer.byteLength,
			parseTimeMs: parseTime,
			totalCells: document.cells.size,
			topCellCount: document.topCells.length,
			topCellNames: document.topCells,
			totalPolygons,
			totalInstances,
			layerStats,
			boundingBox: document.boundingBox,
			layoutWidth,
			layoutHeight,
		};

		if (DEBUG) {
			console.log("[GDSParser] Statistics:", {
				totalCells: statistics.totalCells,
				totalPolygons: statistics.totalPolygons,
				totalInstances: statistics.totalInstances,
				layers: statistics.layerStats.size,
				parseTimeMs: statistics.parseTimeMs.toFixed(1),
			});
		}

		onProgress?.(100, "Parsing complete!");
		return { document, statistics };
	} catch (error) {
		console.error("[GDSParser] Parsing failed:", error);
		if (error instanceof Error && error.message.includes("memory")) {
			throw new Error("Out of memory. Try closing other tabs or use a smaller file.");
		}
		throw error instanceof Error ? error : new Error(`Parse failed: ${String(error)}`);
	}
}

/**
 * Build GDSDocument from parsed GDSII records
 */
async function buildGDSDocument(
	// biome-ignore lint/suspicious/noExplicitAny: GDSII records have dynamic data types
	records: Array<{ tag: number; data: any }>,
	onProgress?: ParseProgressCallback,
): Promise<GDSDocument> {
	if (DEBUG) {
		console.log(`[buildGDSDocument] Processing ${records.length} records`);
	}

	const cells = new Map<string, Cell>();
	const layers = new Map<string, Layer>();
	let libraryName = "Untitled";
	let units = { database: 1e-9, user: 1e-6 };

	let currentCell: Cell | null = null;
	let currentPolygon: Partial<Polygon> | null = null;
	let currentInstance: Partial<CellInstance> | null = null;
	let currentLayer = 0;
	let currentDatatype = 0;

	let polygonCount = 0;
	let instanceCount = 0;

	// Process records sequentially with progress updates
	const totalRecords = records.length;
	let lastProgressUpdate = 0;

	for (let i = 0; i < totalRecords; i++) {
		const record = records[i];
		if (!record) continue;

		const { tag, data } = record;

		// Update progress every 10% of records
		if (onProgress && i - lastProgressUpdate > totalRecords / 10) {
			const progress = 40 + Math.floor((i / totalRecords) * 50);
			onProgress(progress, `Processing records... ${Math.floor((i / totalRecords) * 100)}%`);
			await new Promise((resolve) => setTimeout(resolve, 0));
			lastProgressUpdate = i;
		}
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
					id: generateUUID(),
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

					currentPolygon.points = points;
					currentPolygon.boundingBox = calculateBoundingBox(points);
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
							// biome-ignore lint/style/noNonNullAssertion: Layer/datatype checked by parser
							layer: currentPolygon.layer!,
							// biome-ignore lint/style/noNonNullAssertion: Layer/datatype checked by parser
							datatype: currentPolygon.datatype!,
							name: `Layer ${currentPolygon.layer}/${currentPolygon.datatype}`,
							// biome-ignore lint/style/noNonNullAssertion: Layer/datatype checked by parser
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
					id: generateUUID(),
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

	if (DEBUG) {
		console.log(
			`[buildGDSDocument] Parsed ${polygonCount} polygons and ${instanceCount} instances in ${cells.size} cells`,
		);
	}

	// Calculate bounding boxes for cells
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
	const allCellNames = new Set(cells.keys());
	const referencedCells = new Set<string>();
	for (const cell of cells.values()) {
		for (const instance of cell.instances) {
			referencedCells.add(instance.cellRef);
		}
	}
	const topCells = Array.from(allCellNames).filter((name) => !referencedCells.has(name));

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
