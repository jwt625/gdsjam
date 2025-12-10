/**
 * GDS Loader - Shared utility for loading GDSII files from various sources
 */

import { gdsStore } from "../../stores/gdsStore";
import { convertDxfToGds } from "../converters/DxfToGdsConverter";
import { parseGDSII } from "../gds/GDSParser";

/**
 * Load a GDSII file from an ArrayBuffer
 * This is the shared loading logic used by both file upload and URL loading
 *
 * @param arrayBuffer - The file data as ArrayBuffer
 * @param fileName - The name of the file
 */
/**
 * Detect if file is DXF by content
 */
function isDxfFile(arrayBuffer: ArrayBuffer): boolean {
	try {
		const decoder = new TextDecoder("utf-8");
		const header = decoder.decode(
			new Uint8Array(arrayBuffer.slice(0, Math.min(200, arrayBuffer.byteLength))),
		);
		return header.includes("SECTION") && (header.includes("HEADER") || header.includes("ENTITIES"));
	} catch {
		return false;
	}
}

export async function loadGDSIIFromBuffer(
	arrayBuffer: ArrayBuffer,
	fileName: string,
): Promise<void> {
	const lowerFileName = fileName.toLowerCase();
	const isDxfByExtension = lowerFileName.endsWith(".dxf");
	const isDxfByContent = isDxfFile(arrayBuffer);
	const isDxf = isDxfByExtension || isDxfByContent;
	const isGds = lowerFileName.endsWith(".gds") || lowerFileName.endsWith(".gdsii");

	// Validate file extension
	if (!isGds && !isDxf) {
		gdsStore.setError("Please select a valid GDSII file (.gds, .gdsii) or DXF file (.dxf)");
		return;
	}

	try {
		if (isDxf) {
			// Convert DXF to GDSII
			gdsStore.setLoading(true, "Converting DXF to GDSII...", 5);

			const result = await convertDxfToGds(
				new Uint8Array(arrayBuffer),
				fileName,
				(progress, message) => {
					gdsStore.updateProgress(progress, message);
				},
			);

			const document = result;

			// Log warning if units were assumed
			if (result.unitWasAssumed) {
				console.warn(
					`[gdsLoader] DXF file units were assumed to be: ${result.detectedUnit}. ` +
						"If this is incorrect, the layout size and scale will be wrong. " +
						"Please ensure your DXF file has $INSUNITS header set correctly.",
				);
			}

			// Create statistics for DXF conversion
			const layerStats = new Map<
				string,
				{
					layer: number;
					datatype: number;
					polygonCount: number;
				}
			>();

			// Count polygons per layer
			for (const cell of document.cells.values()) {
				for (const polygon of cell.polygons) {
					const key = `${polygon.layer}:${polygon.datatype}`;
					const existing = layerStats.get(key);
					if (existing) {
						existing.polygonCount++;
					} else {
						layerStats.set(key, {
							layer: polygon.layer,
							datatype: polygon.datatype,
							polygonCount: 1,
						});
					}
				}
			}

			// Convert layout dimensions to micrometers
			// Bounding box is in database units (coordinates were scaled during conversion)
			// So: (database units) * (database meters) / 1e-6 = micrometers
			const layoutWidth =
				((document.boundingBox.maxX - document.boundingBox.minX) * document.units.database) / 1e-6;
			const layoutHeight =
				((document.boundingBox.maxY - document.boundingBox.minY) * document.units.database) / 1e-6;

			const statistics = {
				fileName,
				fileSizeBytes: arrayBuffer.byteLength,
				parseTimeMs: 0,
				totalCells: document.cells.size,
				topCellCount: document.topCells.length,
				topCellNames: document.topCells,
				totalPolygons: Array.from(document.cells.values()).reduce(
					(sum, cell) => sum + cell.polygons.length,
					0,
				),
				totalInstances: 0,
				layerStats,
				boundingBox: document.boundingBox,
				layoutWidth,
				layoutHeight,
			};

			gdsStore.setDocument(document, fileName, statistics);
		} else {
			// Parse GDSII file
			gdsStore.setLoading(true, "Parsing GDSII file...", 5);

			const { document, statistics } = await parseGDSII(
				arrayBuffer,
				fileName,
				(progress, message) => {
					gdsStore.updateProgress(progress, message);
				},
			);

			gdsStore.setDocument(document, fileName, statistics);
		}
	} catch (error) {
		console.error("[gdsLoader] Failed to load file:", error);
		gdsStore.setError(
			`Failed to load file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
