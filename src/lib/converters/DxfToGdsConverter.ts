/**
 * DXF to GDSII Converter
 * Converts DXF (AutoCAD Drawing Exchange Format) files to GDSII format
 */

import type { IDxf, IEntity } from "dxf-parser";
import { DxfParser } from "dxf-parser";
import type { Cell, GDSDocument, Layer, Point, Polygon } from "../../types/gds";
import { generateUUID } from "../utils/uuid";

/**
 * Generate a color for a layer based on layer number and datatype
 * Uses the same algorithm as GDSParser for consistency
 * Returns hex color string (e.g., "#ff5733")
 */
function generateLayerColor(layer: number, datatype: number): string {
	// Use same color mapping as GDSParser for consistency
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
 * Convert DXF entity to GDSII polygon
 * @param entity - DXF entity to convert
 * @param layerNumber - Layer number for the polygon
 * @param scaleFactor - Scale factor to convert DXF units to database units (user/database)
 */
function convertEntityToPolygon(
	entity: IEntity,
	layerNumber: number,
	scaleFactor: number,
): Polygon | null {
	const points: Point[] = [];

	switch (entity.type) {
		case "LINE": {
			const line = entity as any;
			if (line.vertices && line.vertices.length >= 2) {
				points.push({
					x: line.vertices[0].x * scaleFactor,
					y: line.vertices[0].y * scaleFactor,
				});
				points.push({
					x: line.vertices[1].x * scaleFactor,
					y: line.vertices[1].y * scaleFactor,
				});
				// Close the line by adding a small width (convert to rectangle)
				// This is a simplification - real conversion would need more sophisticated handling
			}
			break;
		}

		case "LWPOLYLINE":
		case "POLYLINE": {
			const poly = entity as any;
			if (poly.vertices && poly.vertices.length > 0) {
				for (const vertex of poly.vertices) {
					points.push({ x: vertex.x * scaleFactor, y: vertex.y * scaleFactor });
				}
			}
			break;
		}

		case "CIRCLE": {
			const circle = entity as any;
			// Approximate circle with polygon (32 sides)
			const segments = 32;
			const centerX = (circle.center?.x || 0) * scaleFactor;
			const centerY = (circle.center?.y || 0) * scaleFactor;
			const radius = (circle.radius || 0) * scaleFactor;
			for (let i = 0; i < segments; i++) {
				const angle = (i / segments) * 2 * Math.PI;
				points.push({
					x: centerX + radius * Math.cos(angle),
					y: centerY + radius * Math.sin(angle),
				});
			}
			break;
		}

		case "ARC": {
			const arc = entity as any;
			// Approximate arc with polygon segments
			const segments = 16;
			const centerX = (arc.center?.x || 0) * scaleFactor;
			const centerY = (arc.center?.y || 0) * scaleFactor;
			const radius = (arc.radius || 0) * scaleFactor;
			const startAngle = ((arc.startAngle || 0) * Math.PI) / 180;
			const endAngle = ((arc.endAngle || 0) * Math.PI) / 180;
			for (let i = 0; i <= segments; i++) {
				const angle = startAngle + (i / segments) * (endAngle - startAngle);
				points.push({
					x: centerX + radius * Math.cos(angle),
					y: centerY + radius * Math.sin(angle),
				});
			}
			break;
		}

		case "SOLID":
		case "3DFACE": {
			const solid = entity as any;
			if (solid.corners && solid.corners.length > 0) {
				for (const corner of solid.corners) {
					points.push({ x: corner.x * scaleFactor, y: corner.y * scaleFactor });
				}
			}
			break;
		}

		default:
			// Unsupported entity type
			return null;
	}

	if (points.length < 3) {
		return null; // Need at least 3 points for a polygon
	}

	// Close the polygon if not already closed
	const firstPoint = points[0];
	const lastPoint = points[points.length - 1];
	if (firstPoint && lastPoint && (firstPoint.x !== lastPoint.x || firstPoint.y !== lastPoint.y)) {
		points.push({ x: firstPoint.x, y: firstPoint.y });
	}

	// Calculate bounding box
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}

	return {
		id: generateUUID(),
		points,
		layer: layerNumber,
		datatype: 0,
		boundingBox: { minX, minY, maxX, maxY },
	};
}

/**
 * Convert DXF file to GDSII document
 * @param fileData - DXF file data
 * @param fileName - Name of the file
 * @param onProgress - Progress callback
 * @param unitOverride - Optional unit override in meters (e.g., 0.001 for mm). If not provided, uses $INSUNITS from DXF header or defaults to mm
 * @returns GDS document with metadata about unit detection
 */
export async function convertDxfToGds(
	fileData: Uint8Array,
	fileName: string,
	onProgress?: (progress: number, message: string) => void,
	unitOverride?: number,
): Promise<GDSDocument & { unitWasAssumed: boolean; detectedUnit: string }> {
	onProgress?.(10, "Parsing DXF file...");

	// Convert Uint8Array to string
	const decoder = new TextDecoder("utf-8");
	const dxfText = decoder.decode(fileData);

	// Parse DXF
	const parser = new DxfParser();
	let dxf: IDxf;
	try {
		const parsed = parser.parseSync(dxfText);
		if (!parsed) {
			throw new Error("DXF parser returned null");
		}
		dxf = parsed;
	} catch (error) {
		throw new Error(
			`Failed to parse DXF file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// Check DXF units from header
	// $INSUNITS: 1=inches, 2=feet, 4=mm, 5=cm, 6=m, 14=micrometers
	const insunits = dxf.header?.$INSUNITS as number | undefined;
	let dxfUnitInMeters: number;
	let unitName: string;
	let unitWasAssumed = false;

	// Use override if provided
	if (unitOverride !== undefined) {
		dxfUnitInMeters = unitOverride;
		unitName = `${unitOverride} meters (user-specified)`;
		unitWasAssumed = false;
	} else if (insunits !== undefined) {
		// Use units from DXF header
		switch (insunits) {
			case 1:
				dxfUnitInMeters = 0.0254;
				unitName = "inches";
				break;
			case 2:
				dxfUnitInMeters = 0.3048;
				unitName = "feet";
				break;
			case 4:
				dxfUnitInMeters = 0.001;
				unitName = "millimeters";
				break;
			case 5:
				dxfUnitInMeters = 0.01;
				unitName = "centimeters";
				break;
			case 6:
				dxfUnitInMeters = 1.0;
				unitName = "meters";
				break;
			case 14:
				dxfUnitInMeters = 1e-6;
				unitName = "micrometers";
				break;
			default:
				console.warn(
					`[DxfToGdsConverter] Unknown INSUNITS value: ${insunits}, assuming millimeters`,
				);
				dxfUnitInMeters = 0.001;
				unitName = "millimeters (assumed)";
				unitWasAssumed = true;
		}
	} else {
		// No units specified - assume micrometers (common for IC layouts)
		dxfUnitInMeters = 1e-6;
		unitName = "micrometers (assumed)";
		unitWasAssumed = true;
		console.warn(
			"[DxfToGdsConverter] No $INSUNITS in DXF header, assuming micrometers (common for IC layouts). " +
				"If incorrect, reload the file and specify units manually.",
		);
	}

	onProgress?.(30, "Converting entities to GDSII...");

	// Create layer map
	const layerMap = new Map<string, Layer>();
	const dxfLayers = dxf.tables?.layer?.layers || {};
	let layerNumber = 0;

	// Create layers from DXF layer table
	for (const [layerName] of Object.entries(dxfLayers)) {
		const layer: Layer = {
			layer: layerNumber,
			datatype: 0,
			name: layerName,
			color: generateLayerColor(layerNumber, 0),
			visible: true,
		};
		layerMap.set(`${layerNumber}:0`, layer);
		layerNumber++;
	}

	// If no layers defined, create a default layer
	if (layerMap.size === 0) {
		const defaultLayer: Layer = {
			layer: 0,
			datatype: 0,
			name: "0",
			color: "#4a9eff",
			visible: true,
		};
		layerMap.set("0:0", defaultLayer);
	}

	onProgress?.(50, "Converting entities...");

	// Convert entities to polygons
	const polygons: Polygon[] = [];
	const entities = dxf.entities || [];
	const layerNameToNumber = new Map<string, number>();

	// Build layer name to number mapping
	let currentLayerNum = 0;
	for (const [layerName] of Object.entries(dxfLayers)) {
		layerNameToNumber.set(layerName, currentLayerNum++);
	}

	// Calculate scale factor to convert DXF units to database units
	// DXF coordinates are in user units (e.g., mm), but GDS coordinates must be in database units (nm)
	// Scale factor = user / database (e.g., 0.001 / 1e-9 = 1,000,000 for mm to nm)
	const database = 1e-9; // 1 database unit = 1 nanometer (standard for GDSII)
	const scaleFactor = dxfUnitInMeters / database;

	for (let i = 0; i < entities.length; i++) {
		const entity = entities[i];
		if (!entity) continue;

		const entityLayerName = (entity as any).layer || "0";
		let entityLayerNumber = layerNameToNumber.get(entityLayerName);

		// If layer not found, create it
		if (entityLayerNumber === undefined) {
			entityLayerNumber = layerNumber++;
			layerNameToNumber.set(entityLayerName, entityLayerNumber);

			const newLayer: Layer = {
				layer: entityLayerNumber,
				datatype: 0,
				name: entityLayerName,
				color: generateLayerColor(entityLayerNumber, 0),
				visible: true,
			};
			layerMap.set(`${entityLayerNumber}:0`, newLayer);
		}

		const polygon = convertEntityToPolygon(entity, entityLayerNumber, scaleFactor);
		if (polygon) {
			polygons.push(polygon);
		}

		if (i % 100 === 0) {
			onProgress?.(
				50 + (i / entities.length) * 40,
				`Converting entities (${i}/${entities.length})...`,
			);
		}
	}

	onProgress?.(90, "Creating GDSII document...");

	// Calculate bounding box for the entire document
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const polygon of polygons) {
		minX = Math.min(minX, polygon.boundingBox.minX);
		minY = Math.min(minY, polygon.boundingBox.minY);
		maxX = Math.max(maxX, polygon.boundingBox.maxX);
		maxY = Math.max(maxY, polygon.boundingBox.maxY);
	}

	// Create top cell
	const topCell: Cell = {
		name: fileName.replace(/\.(dxf|DXF)$/, ""),
		polygons,
		instances: [],
		boundingBox: { minX, minY, maxX, maxY },
		skipInMinimap: false, // DXF files typically have single top cell, don't skip
	};

	// Create GDS document
	// GDSII units:
	// - database: size of database unit in meters (1e-9 = 1 nm)
	// - user: size of user unit in meters (what the original DXF units were)
	// Coordinates are now in database units (scaled during conversion)
	const document: GDSDocument = {
		name: fileName,
		units: {
			database, // 1 database unit = 1 nanometer (standard for GDSII)
			user: dxfUnitInMeters, // Original DXF units (for reference/display)
		},
		cells: new Map([[topCell.name, topCell]]),
		layers: layerMap,
		topCells: [topCell.name],
		boundingBox: topCell.boundingBox,
	};

	onProgress?.(100, "Conversion complete!");

	return {
		...document,
		unitWasAssumed,
		detectedUnit: unitName,
	};
}
