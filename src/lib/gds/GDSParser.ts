/**
 * GDSII Parser - Parse GDSII files using JavaScript gdsii library
 * Converts GDSII binary format to internal GDSDocument format
 */

import { GDSParseError, parseGDS, RecordType } from "gdsii";
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
import { DEBUG_PARSER } from "../debug";
import { generateUUID } from "../utils/uuid";
import { pathToPolygon } from "./pathToPolygon";

/**
 * Custom parseGDS wrapper that handles deprecated BGNEXTN and ENDEXTN records
 * These records are used in PATH elements with custom extensions (pathtype 4)
 * but are deprecated and not supported by the gdsii library.
 *
 * This wrapper manually parses the entire file record-by-record, handling
 * deprecated records that the library doesn't support.
 */
function* parseGDSWithDeprecatedRecords(
	fileData: Uint8Array,
): Generator<{ tag: number; data: unknown }, void, unknown> {
	const dataView = new DataView(fileData.buffer);
	let offset = 0;

	// Deprecated record types that need manual parsing
	const BGNEXTN = 12291;
	const ENDEXTN = 12547;

	while (offset < fileData.length) {
		// Read record header (4 bytes: 2 for length, 2 for tag)
		if (offset + 4 > fileData.length) {
			break;
		}

		const recordLength = dataView.getUint16(offset, false); // Big-endian
		const tag = dataView.getUint16(offset + 2, false); // Big-endian

		if (recordLength < 4) {
			throw new GDSParseError(`Invalid record length: ${recordLength}`);
		}

		const dataLength = recordLength - 4;

		// Handle deprecated records manually
		if (tag === BGNEXTN || tag === ENDEXTN) {
			// Parse as int32 (4 bytes of data)
			if (dataLength === 4) {
				const value = dataView.getInt32(offset + 4, false);
				yield { tag, data: value };
			} else if (dataLength === 0) {
				// Empty record
				yield { tag, data: null };
			} else {
				// Unexpected length, skip the record
				if (DEBUG_PARSER) {
					console.warn(
						`[GDSParser] Unexpected length ${dataLength} for ${RecordType[tag] || tag}, skipping`,
					);
				}
				yield { tag, data: null };
			}
			offset += recordLength;
			continue;
		}

		// For all other records, parse using standard logic
		// We replicate the basic parsing logic here to avoid circular dependency

		let data: unknown = null;

		// Parse based on record type (simplified version of what the library does)
		switch (tag) {
			case RecordType.HEADER:
				if (dataLength === 2) {
					data = { version: dataView.getInt16(offset + 4, false) };
				}
				break;

			case RecordType.LIBNAME:
			case RecordType.STRNAME:
			case RecordType.SNAME:
			case RecordType.STRING:
				// String parser
				{
					let len = dataLength;
					if (dataView.getUint8(offset + 4 + len - 1) === 0) {
						len--;
					}
					const textDecoder = new TextDecoder();
					data = textDecoder.decode(new Uint8Array(fileData.buffer, offset + 4, len));
				}
				break;

			case RecordType.LAYER:
			case RecordType.DATATYPE:
			case RecordType.TEXTTYPE:
			case RecordType.PATHTYPE:
			case RecordType.STRANS:
			case RecordType.PRESENTATION:
			case RecordType.NODETYPE:
			case RecordType.PROPATTR:
			case RecordType.BOXTYPE:
			case RecordType.GENERATIONS:
			case RecordType.ELFLAGS:
				// int16 parser
				if (dataLength === 2) {
					data = dataView.getInt16(offset + 4, false);
				}
				break;

			case RecordType.WIDTH:
			case RecordType.PLEX:
				// int32 parser
				if (dataLength === 4) {
					data = dataView.getInt32(offset + 4, false);
				}
				break;

			case RecordType.XY:
				// XY array parser
				if (dataLength % 8 === 0) {
					const xy = new Array(dataLength / 8);
					for (let i = 0; i < dataLength; i += 8) {
						xy[i / 8] = [
							dataView.getInt32(offset + 4 + i, false),
							dataView.getInt32(offset + 4 + i + 4, false),
						];
					}
					data = xy;
				}
				break;

			case RecordType.COLROW:
				// COLROW parser
				if (dataLength === 4) {
					data = {
						columns: dataView.getUint16(offset + 4, false),
						rows: dataView.getUint16(offset + 6, false),
					};
				}
				break;

			case RecordType.MAG:
			case RecordType.ANGLE:
				// Real8 parser
				if (dataLength === 8) {
					data = parseReal8(dataView, offset + 4);
				}
				break;

			case RecordType.UNITS:
				// Units parser
				if (dataLength === 16) {
					data = {
						userUnit: parseReal8(dataView, offset + 4),
						metersPerUnit: parseReal8(dataView, offset + 12),
					};
				}
				break;

			case RecordType.BGNLIB:
			case RecordType.BGNSTR:
				// Date parser
				if (dataLength === 24) {
					data = {
						modTime: parseDate(dataView, offset + 4),
						accessTime: parseDate(dataView, offset + 16),
					};
				}
				break;

			case RecordType.ENDLIB:
			case RecordType.ENDSTR:
			case RecordType.BOUNDARY:
			case RecordType.PATH:
			case RecordType.SREF:
			case RecordType.AREF:
			case RecordType.TEXT:
			case RecordType.ENDEL:
			case RecordType.TEXTNODE:
			case RecordType.NODE:
			case RecordType.BOX:
				// Empty records
				if (dataLength !== 0) {
					throw new GDSParseError(`Invalid record length for ${RecordType[tag] || tag}`);
				}
				data = null;
				break;

			default:
				// Unknown record type - skip it
				if (DEBUG_PARSER) {
					console.warn(`[GDSParser] Skipping unknown record type: ${RecordType[tag] || tag}`);
				}
				data = null;
		}

		yield { tag, data };
		offset += recordLength;
	}
}

/**
 * Parse GDSII Real8 format (8-byte floating point)
 */
function parseReal8(dataView: DataView, offset: number): number {
	if (dataView.getUint32(offset) === 0) {
		return 0;
	}
	const sign = dataView.getUint8(offset) & 0x80 ? -1 : 1;
	const exponent = (dataView.getUint8(offset) & 0x7f) - 64;
	let base = 0;
	for (let i = 1; i < 7; i++) {
		const byte = dataView.getUint8(offset + i);
		for (let bit = 0; bit < 8; bit++) {
			if (byte & (1 << (7 - bit))) {
				base += 2 ** (7 - bit - i * 8);
			}
		}
	}
	return base * sign * 16 ** exponent;
}

/**
 * Parse GDSII date format
 */
function parseDate(dataView: DataView, offset: number): Date {
	const year = dataView.getUint16(offset, false);
	return new Date(
		Date.UTC(
			year < 1900 ? year + 1900 : year,
			dataView.getUint16(offset + 2, false) - 1,
			dataView.getUint16(offset + 4, false),
			dataView.getUint16(offset + 6, false),
			dataView.getUint16(offset + 8, false),
			dataView.getUint16(offset + 10, false),
		),
	);
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
 * Detect file format and provide helpful error messages
 */
/**
 * Detect file format and provide helpful error messages
 */
function detectFileFormat(fileData: Uint8Array): string {
	if (fileData.length < 4) {
		return "File too small";
	}

	// Check for common compression/archive formats
	const magic = new Uint8Array(fileData.buffer, 0, Math.min(fileData.length, 8));

	// GZIP: 1f 8b
	if (magic[0] === 0x1f && magic[1] === 0x8b) {
		return "GZIP compressed file (.gz)";
	}

	// ZIP: 50 4b (PK)
	if (magic[0] === 0x50 && magic[1] === 0x4b) {
		return "ZIP archive";
	}

	// BZ2: 42 5a (BZ)
	if (magic[0] === 0x42 && magic[1] === 0x5a) {
		return "BZIP2 compressed file (.bz2)";
	}

	// Check if it looks like ASCII text (common for ASCII GDSII or other text formats)
	let asciiCount = 0;
	const sampleSize = Math.min(100, fileData.length);
	for (let i = 0; i < sampleSize; i++) {
		const byte = i < magic.length ? magic[i] : fileData[i];
		if (byte === undefined) continue;
		// Printable ASCII or whitespace
		if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
			asciiCount++;
		}
	}

	if (asciiCount > sampleSize * 0.9) {
		// Try to detect specific text formats
		const textDecoder = new TextDecoder();
		const header = textDecoder.decode(
			new Uint8Array(fileData.buffer, 0, Math.min(200, fileData.length)),
		);

		// Check for DXF format (AutoCAD Drawing Exchange Format)
		if (header.includes("SECTION") && (header.includes("HEADER") || header.includes("ENTITIES"))) {
			return "DXF (AutoCAD Drawing Exchange Format)";
		}

		if (header.includes("HEADER") || header.includes("BGNLIB") || header.includes("STRNAME")) {
			return "ASCII GDSII format";
		}

		return "Text file (GDSII must be in binary format)";
	}

	return "Unknown binary format";
}

/**
 * Validate GDSII file format
 */
function validateGDSIIFormat(fileData: Uint8Array): void {
	if (fileData.length < 4) {
		throw new Error("File too small to be a valid GDSII file (minimum 4 bytes required).");
	}

	// Check for HEADER record (should be first record)
	const dataView = new DataView(fileData.buffer);
	const firstRecordLength = dataView.getUint16(0, false); // Big-endian
	const firstRecordTag = dataView.getUint16(2, false); // Big-endian

	if (firstRecordLength < 4 || firstRecordLength % 2 !== 0) {
		const detectedFormat = detectFileFormat(fileData);
		throw new Error(
			`Invalid GDSII format: First record has invalid length ${firstRecordLength}. ` +
				`Detected format: ${detectedFormat}. ` +
				`Please ensure you're loading a binary GDSII file (.gds or .gdsii).`,
		);
	}

	if (firstRecordTag !== RecordType.HEADER) {
		const detectedFormat = detectFileFormat(fileData);

		// Provide helpful error message based on detected format
		let errorMsg = `Invalid GDSII format: Expected HEADER record (tag ${RecordType.HEADER}), got tag ${firstRecordTag} (0x${firstRecordTag.toString(16)}). `;
		errorMsg += `Detected format: ${detectedFormat}.\n\n`;

		if (detectedFormat.includes("compressed") || detectedFormat.includes("ZIP")) {
			errorMsg += "Please decompress the file first before loading.";
		} else if (detectedFormat.includes("DXF")) {
			errorMsg +=
				"This is a DXF file! DXF conversion is supported, but the file needs a .dxf extension.\n\n" +
				"Please rename your file to have a .dxf extension and try again.\n\n" +
				"Alternatively, you can convert DXF to GDSII using:\n" +
				"• KLayout: File → Import → DXF, then File → Save As → GDS\n" +
				"• Online converters or CAD tools that support both formats";
		} else if (detectedFormat.includes("ASCII")) {
			errorMsg +=
				"This viewer only supports binary GDSII format.\n\n" +
				"To convert ASCII GDSII to binary format, you can use:\n" +
				"• KLayout: File → Import → ASCII GDSII, then File → Save As → GDS\n" +
				"• gdstk (Python): gdstk.read_gds() with ascii=True, then write binary\n" +
				"• Online converters or CAD tools that support both formats\n\n" +
				"Alternatively, if you have the original source, export it as binary GDSII (.gds) instead of ASCII.";
		} else {
			errorMsg += "File may be corrupted or not a valid binary GDSII file.";
		}

		throw new Error(errorMsg);
	}
}

/**
 * Get record type name for debugging
 */
function getRecordTypeName(tag: number): string {
	// RecordType is an enum, so we can look up the name
	const name = RecordType[tag];
	return name ? `${name} (${tag})` : `Unknown (${tag})`;
}

/**
 * Parse GDSII with enhanced error reporting
 * This wrapper catches parse errors and provides better diagnostic information
 * Falls back to custom parser if deprecated BGNEXTN/ENDEXTN records are encountered
 */
function parseGDSWithDiagnostics(fileData: Uint8Array): Array<{ tag: number; data: any }> {
	const records: Array<{ tag: number; data: any }> = [];
	let recordCount = 0;
	let lastSuccessfulTag: number | null = null;
	let endLibEncountered = false;

	try {
		// Try the fast library parser first
		for (const record of parseGDS(fileData)) {
			records.push(record);
			lastSuccessfulTag = record.tag;
			recordCount++;

			// Track if we've seen ENDLIB (end of library)
			if (record.tag === RecordType.ENDLIB) {
				endLibEncountered = true;
			}
		}
	} catch (error) {
		// If we've already seen ENDLIB, treat subsequent errors as warnings
		// This handles files with padding bytes or garbage data after the valid GDSII stream
		if (endLibEncountered) {
			console.warn(
				`[GDSParser] Encountered error after ENDLIB record. Ignoring trailing data. Error: ${error instanceof Error ? error.message : String(error)}`,
			);
			return records;
		}

		if (error instanceof GDSParseError) {
			const errorMsg = error.message;
			const lastRecordInfo =
				lastSuccessfulTag !== null ? getRecordTypeName(lastSuccessfulTag) : "none";

			// Check if this is a BGNEXTN/ENDEXTN error - if so, retry with custom parser
			if (
				errorMsg.includes("Unknown record type") &&
				(errorMsg.includes("BGNEXTN") || errorMsg.includes("ENDEXTN"))
			) {
				if (DEBUG_PARSER) {
					console.log(
						`[GDSParser] Detected deprecated BGNEXTN/ENDEXTN records, retrying with custom parser...`,
					);
				}

				// Retry with custom parser that handles deprecated records
				records.length = 0; // Clear partial results
				recordCount = 0;
				lastSuccessfulTag = null;

				try {
					for (const record of parseGDSWithDeprecatedRecords(fileData)) {
						records.push(record);
						lastSuccessfulTag = record.tag;
						recordCount++;
					}

					if (DEBUG_PARSER) {
						console.log(
							`[GDSParser] Successfully parsed ${recordCount} records with custom parser`,
						);
					}

					return records;
				} catch (retryError) {
					// Custom parser also failed
					throw new Error(
						`GDSII parsing failed even with custom parser: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
					);
				}
			}

			console.error("[GDSParser] Parse error details:", {
				error: errorMsg,
				recordsParsed: recordCount,
				lastSuccessfulRecord: lastRecordInfo,
			});

			// Check for "Invalid record length: 0" specifically
			if (errorMsg.includes("Invalid record length: 0")) {
				throw new Error(
					`GDSII parsing failed at record ${recordCount + 1} (after ${lastRecordInfo}): ${errorMsg}. ` +
						"This usually indicates corrupted data or unexpected padding bytes.",
				);
			}

			// Provide more helpful error message
			if (errorMsg.includes("Unknown record type")) {
				throw new Error(
					`GDSII parsing failed at record ${recordCount + 1} (after ${lastRecordInfo}): ${errorMsg}. ` +
						`This file may contain unsupported record types or be corrupted. ` +
						`Successfully parsed ${recordCount} records before failure.`,
				);
			}

			throw new Error(
				`GDSII parsing failed at record ${recordCount + 1} (after ${lastRecordInfo}): ${errorMsg}. ` +
					`Successfully parsed ${recordCount} records before failure.`,
			);
		}
		throw error;
	}

	return records;
}

/**
 * Trim trailing zeros/padding from GDSII file buffer
 * Some files have zero-padding after the ENDLIB record which can cause parser errors
 */
export function trimTrailingPadding(buffer: ArrayBuffer): ArrayBuffer {
	// GDSII End of Library record is 4 bytes: 0x00 0x04 0x04 0x00
	// const ENDLIB_HEX = "00040400"; // This is the hex value of the ENDLIB record

	const uint8Array = new Uint8Array(buffer);

	// If file is small, just return it
	if (uint8Array.length < 4) return buffer;

	// Quick check: if the last 4 bytes are ENDLIB, no trimming needed
	if (
		uint8Array[uint8Array.length - 4] === 0x00 &&
		uint8Array[uint8Array.length - 3] === 0x04 &&
		uint8Array[uint8Array.length - 2] === 0x04 &&
		uint8Array[uint8Array.length - 1] === 0x00
	) {
		return buffer;
	}

	// Find the last occurrence of ENDLIB
	// We scan from the end backwards
	let endLibIndex = -1;

	for (let i = uint8Array.length - 4; i >= 0; i--) {
		if (
			uint8Array[i] === 0x00 &&
			uint8Array[i + 1] === 0x04 &&
			uint8Array[i + 2] === 0x04 &&
			uint8Array[i + 3] === 0x00
		) {
			endLibIndex = i;
			break;
		}
	}

	// If ENDLIB found and there is data after it
	if (endLibIndex !== -1 && endLibIndex + 4 < uint8Array.length) {
		console.warn(
			`[GDSParser] Found data after ENDLIB at offset ${endLibIndex}. Trimming ${uint8Array.length - (endLibIndex + 4)} bytes.`,
		);
		return buffer.slice(0, endLibIndex + 4);
	}

	return buffer;
}

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

	try {
		if (fileBuffer.byteLength > 1024 * 1024 * 1024) {
			throw new Error(`File too large (${fileSizeMB.toFixed(0)} MB). Maximum: 1GB.`);
		}

		onProgress?.(10, "Converting file data...");
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Validate file format before parsing
		onProgress?.(15, "Validating file format...");
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Trim any padding after ENDLIB to prevent parser errors
		const trimmedBuffer = trimTrailingPadding(fileBuffer);
		const fileData = new Uint8Array(trimmedBuffer);

		validateGDSIIFormat(fileData);

		onProgress?.(20, "Parsing GDSII records...");
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Parse records with enhanced diagnostics
		// biome-ignore lint/suspicious/noExplicitAny: External library returns unknown data types
		const records: Array<{ tag: number; data: any }> = parseGDSWithDiagnostics(fileData);

		if (records.length === 0) {
			throw new Error("No valid GDSII records found. File may be corrupted.");
		}

		onProgress?.(40, "Building document structure...");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const document = await buildGDSDocument(records, onProgress);

		const parseTime = performance.now() - startTime;

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
	const cells = new Map<string, Cell>();
	const layers = new Map<string, Layer>();
	let libraryName = "Untitled";
	let units = { database: 1e-9, user: 1e-6 };

	let currentCell: Cell | null = null;
	let currentPolygon: Partial<Polygon> | null = null;
	let currentInstance: Partial<CellInstance> | null = null;
	let currentLayer = 0;
	let currentDatatype = 0;

	// PATH support: track current path being parsed
	let currentPath: Partial<{
		id: string;
		points: Point[];
		layer: number;
		datatype: number;
		width: number;
		pathtype: number;
	}> | null = null;
	let currentPathWidth = 0;
	let currentPathType = 0;

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
					skipInMinimap: false, // Will be calculated after global bbox is known
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

			case RecordType.PATH: // Begin path
				currentPath = {
					id: generateUUID(),
					points: [],
				};
				break;

			case RecordType.LAYER:
				currentLayer = data as number;
				if (currentPolygon) {
					currentPolygon.layer = currentLayer;
				}
				if (currentPath) {
					currentPath.layer = currentLayer;
				}
				break;

			case RecordType.DATATYPE:
				currentDatatype = data as number;
				if (currentPolygon) {
					currentPolygon.datatype = currentDatatype;
				}
				if (currentPath) {
					currentPath.datatype = currentDatatype;
				}
				break;

			case RecordType.WIDTH:
				currentPathWidth = data as number;
				if (currentPath) {
					currentPath.width = currentPathWidth;
				}
				break;

			case RecordType.PATHTYPE:
				currentPathType = data as number;
				if (currentPath) {
					currentPath.pathtype = currentPathType;
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
				} else if (currentPath && Array.isArray(data)) {
					// PATH XY data: centerline/spine points
					const points: Point[] = [];
					for (const coord of data) {
						if (Array.isArray(coord) && coord.length >= 2) {
							points.push({ x: coord[0], y: coord[1] });
						}
					}
					currentPath.points = points;
					// Note: Don't calculate bbox yet - will do after path-to-polygon conversion
				} else if (currentInstance && Array.isArray(data) && data.length >= 1) {
					// For instances, XY contains the position
					// Check if it's nested array format [[x, y]] or flat format [x, y]
					if (Array.isArray(data[0]) && data[0].length >= 2) {
						// Nested array format: [[x, y]]
						currentInstance.x = data[0][0];
						currentInstance.y = data[0][1];
					} else if (data.length >= 2) {
						// Flat array format: [x, y]
						currentInstance.x = data[0];
						currentInstance.y = data[1];
					}
				}
				break;

			case RecordType.ENDEL: // End element
				if (currentPolygon && currentCell && currentPolygon.points) {
					// Validate polygon has required fields
					if (currentPolygon.layer === undefined) {
						// Use last known layer or default to 0
						currentPolygon.layer = currentLayer || 0;
					}

					if (currentPolygon.datatype === undefined) {
						currentPolygon.datatype = currentDatatype || 0;
					}

					// Filter degenerate polygons (< 3 unique points)
					const uniquePoints = new Set(currentPolygon.points.map((p) => `${p.x},${p.y}`));

					if (uniquePoints.size >= 3) {
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
					} else if (DEBUG_PARSER) {
						console.log(
							`[GDSParser] Skipping degenerate polygon with ${uniquePoints.size} unique points in cell ${currentCell.name}`,
						);
					}

					currentPolygon = null;
				} else if (currentPath && currentCell && currentPath.points) {
					// PATH handling: convert to polygon
					// Validate path has required fields
					if (currentPath.layer === undefined) {
						currentPath.layer = currentLayer || 0;
					}
					if (currentPath.datatype === undefined) {
						currentPath.datatype = currentDatatype || 0;
					}
					if (currentPath.width === undefined) {
						currentPath.width = currentPathWidth || 0;
					}
					if (currentPath.pathtype === undefined) {
						currentPath.pathtype = currentPathType || 0;
					}

					// Convert path to polygon (or polyline for zero-width paths)
					const polygonPoints = pathToPolygon(
						currentPath.points,
						currentPath.width,
						currentPath.pathtype,
					);

					// Accept both polygons (3+ points) and polylines (2 points for zero-width paths)
					if (polygonPoints.length >= 2) {
						// Create polygon from converted path
						// Note: For zero-width paths, this will be a polyline (2 points)
						const polygon: Polygon = {
							id: currentPath.id!,
							points: polygonPoints,
							layer: currentPath.layer,
							datatype: currentPath.datatype,
							boundingBox: calculateBoundingBox(polygonPoints),
						};

						// Add to cell (same as BOUNDARY polygons)
						currentCell.polygons.push(polygon);
						polygonCount++;

						// Track layer (same as BOUNDARY)
						const layerKey = `${polygon.layer}:${polygon.datatype}`;
						if (!layers.has(layerKey)) {
							layers.set(layerKey, {
								layer: polygon.layer,
								datatype: polygon.datatype,
								name: `Layer ${polygon.layer}/${polygon.datatype}`,
								color: generateLayerColor(polygon.layer, polygon.datatype),
								visible: true,
							});
						}

						if (DEBUG_PARSER) {
							const type = polygonPoints.length === 2 ? "polyline" : "polygon";
							console.log(
								`[GDSParser] Converted PATH to ${type}: ${currentPath.points.length} spine points → ${polygonPoints.length} outline points, width=${currentPath.width}, pathtype=${currentPath.pathtype}`,
							);
						}
					} else if (DEBUG_PARSER) {
						console.log(
							`[GDSParser] Skipping degenerate path with ${polygonPoints.length} outline points in cell ${currentCell.name}`,
						);
					}

					currentPath = null;
				} else if (currentInstance && currentCell) {
					// Validate instance has required fields
					if (!currentInstance.cellRef) {
						console.warn("[GDSParser] Instance missing cell reference, skipping");
						currentInstance = null;
						break;
					}

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

	// Calculate bounding boxes for cells recursively (bottom-up)
	// We need to process cells in dependency order: leaf cells first, then parents
	const cellBBoxCalculated = new Set<string>();
	const cellBBoxInProgress = new Set<string>(); // Guard against circular references

	function calculateCellBoundingBox(cellName: string): BoundingBox {
		// Return cached result if already calculated
		const cell = cells.get(cellName);
		if (!cell) {
			return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
		}

		if (cellBBoxCalculated.has(cellName)) {
			return cell.boundingBox;
		}

		// Detect circular references
		if (cellBBoxInProgress.has(cellName)) {
			console.warn(`[GDSParser] Circular cell reference detected: ${cellName}`);
			return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
		}

		cellBBoxInProgress.add(cellName);

		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		// Include polygons in this cell
		for (const polygon of cell.polygons) {
			minX = Math.min(minX, polygon.boundingBox.minX);
			minY = Math.min(minY, polygon.boundingBox.minY);
			maxX = Math.max(maxX, polygon.boundingBox.maxX);
			maxY = Math.max(maxY, polygon.boundingBox.maxY);
		}

		// Include transformed bounding boxes of referenced cells
		for (const instance of cell.instances) {
			// Recursively calculate referenced cell's bbox first
			const refBBox = calculateCellBoundingBox(instance.cellRef);

			// Transform the 4 corners of the referenced cell's bounding box
			const corners = [
				{ x: refBBox.minX, y: refBBox.minY },
				{ x: refBBox.maxX, y: refBBox.minY },
				{ x: refBBox.minX, y: refBBox.maxY },
				{ x: refBBox.maxX, y: refBBox.maxY },
			];

			// Pre-calculate rotation values outside loop
			const rad = (instance.rotation * Math.PI) / 180;
			const cos = Math.cos(rad);
			const sin = Math.sin(rad);

			for (const corner of corners) {
				// Apply transformation in correct order: mirror → rotate → magnify → translate
				// Step 1: Mirror (flip Y-axis if mirror=true)
				const mx = instance.mirror ? corner.x : corner.x;
				const my = instance.mirror ? -corner.y : corner.y;

				// Step 2: Rotate
				const rx = mx * cos - my * sin;
				const ry = mx * sin + my * cos;

				// Step 3: Magnify
				const sx = rx * instance.magnification;
				const sy = ry * instance.magnification;

				// Step 4: Translate
				const transformedX = sx + instance.x;
				const transformedY = sy + instance.y;

				minX = Math.min(minX, transformedX);
				minY = Math.min(minY, transformedY);
				maxX = Math.max(maxX, transformedX);
				maxY = Math.max(maxY, transformedY);
			}
		}

		cell.boundingBox = {
			minX: minX === Number.POSITIVE_INFINITY ? 0 : minX,
			minY: minY === Number.POSITIVE_INFINITY ? 0 : minY,
			maxX: maxX === Number.NEGATIVE_INFINITY ? 0 : maxX,
			maxY: maxY === Number.NEGATIVE_INFINITY ? 0 : maxY,
		};

		cellBBoxInProgress.delete(cellName);
		cellBBoxCalculated.add(cellName);
		return cell.boundingBox;
	}

	// Calculate bounding boxes for all cells
	for (const cellName of cells.keys()) {
		calculateCellBoundingBox(cellName);
	}

	// Find top cells (cells not referenced by others)
	// Exclude references from context cells (e.g., $$$CONTEXT_INFO$$$) as they're just library metadata
	const allCellNames = new Set(cells.keys());
	const referencedCells = new Set<string>();
	for (const cell of cells.values()) {
		// Skip context cells when building referenced cells set
		const isContextCell = cell.name.includes("CONTEXT_INFO") || cell.name.startsWith("$$$");
		if (!isContextCell) {
			for (const instance of cell.instances) {
				referencedCells.add(instance.cellRef);
			}
		}
	}
	const topCells = Array.from(allCellNames).filter((name) => !referencedCells.has(name));

	if (DEBUG_PARSER) {
		console.log(`[GDSParser] Total cells: ${cells.size}, Top cells: ${topCells.length}`);
		console.log(`[GDSParser] Top cells:`, topCells);
		for (const topCellName of topCells) {
			const cell = cells.get(topCellName);
			if (cell) {
				console.log(
					`[GDSParser]   ${topCellName}: ${cell.polygons.length} polygons, ${cell.instances.length} instances`,
				);
			}
		}
	}

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

	// Calculate skipInMinimap for each cell (1% threshold of layout extent)
	// Cells smaller than 1% of the layout in BOTH dimensions are skipped in minimap
	const layoutExtentX = globalMaxX - globalMinX;
	const layoutExtentY = globalMaxY - globalMinY;
	const MINIMAP_SKIP_THRESHOLD = 0.01; // 1% of layout extent

	if (layoutExtentX > 0 && layoutExtentY > 0) {
		for (const cell of cells.values()) {
			const cellWidth = cell.boundingBox.maxX - cell.boundingBox.minX;
			const cellHeight = cell.boundingBox.maxY - cell.boundingBox.minY;
			cell.skipInMinimap =
				cellWidth < MINIMAP_SKIP_THRESHOLD * layoutExtentX &&
				cellHeight < MINIMAP_SKIP_THRESHOLD * layoutExtentY;
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
