/**
 * GDSRenderer - Handles rendering of GDS documents with LOD support
 *
 * Responsibilities:
 * - Render GDS cells recursively with transformations (position, rotation, mirror, magnification)
 * - Batch polygons by layer and spatial tile for efficient rendering
 * - Respect polygon budget limits to prevent out-of-memory errors
 * - Track rendering progress for UI feedback
 * - Apply layer visibility filtering during render
 *
 * Architecture:
 * - Uses spatial tiling (SPATIAL_TILE_SIZE) to batch polygons for viewport culling
 * - Supports both fill and outline rendering modes
 * - Calculates stroke width dynamically based on zoom level for outline mode
 * - Inserts rendered tiles into spatial index for efficient viewport queries
 */

import { Container, Graphics } from "pixi.js";
import type { BoundingBox, Cell, GDSDocument, Polygon } from "../../../types/gds";
import { SPATIAL_TILE_SIZE } from "../../config";
import type { RTreeItem, SpatialIndex } from "../../spatial/RTree";

export type RenderProgressCallback = (progress: number, message: string) => void;

export interface RenderOptions {
	maxDepth: number;
	maxPolygonsPerRender: number;
	fillMode: boolean;
	overrideScale?: number;
	layerVisibility: Map<string, boolean>;
}

export interface RenderResult {
	totalPolygons: number;
	renderedPolygons: number;
	graphicsItems: RTreeItem[];
}

export class GDSRenderer {
	private cellRenderCounts = new Map<string, number>();

	constructor(
		private spatialIndex: SpatialIndex,
		private mainContainer: Container,
	) {}

	/**
	 * Update the main container reference (used when container is recreated during re-renders)
	 */
	updateMainContainer(container: Container): void {
		this.mainContainer = container;
	}

	/**
	 * Render GDS document with LOD
	 */
	async render(
		document: GDSDocument,
		options: RenderOptions,
		onProgress?: RenderProgressCallback,
	): Promise<RenderResult> {
		this.cellRenderCounts.clear();
		const allGraphicsItems: RTreeItem[] = [];

		// Find top-level cells (cells that are not referenced by any other cell)
		const referencedCells = new Set<string>();
		for (const cell of document.cells.values()) {
			for (const instance of cell.instances) {
				referencedCells.add(instance.cellRef);
			}
		}

		const topCells = Array.from(document.cells.values()).filter(
			(cell) => !referencedCells.has(cell.name),
		);

		// Calculate total polygon count for progress tracking
		let totalPolygonCount = 0;
		for (const cell of topCells) {
			totalPolygonCount += cell.polygons.length;
		}

		let totalPolygons = 0;
		let polygonBudget = options.maxPolygonsPerRender;
		let processedPolygons = 0;

		// Render each top cell
		for (const cell of topCells) {
			if (polygonBudget <= 0) break;

			const topCellName = cell.name;

			const baseProgress = Math.floor((processedPolygons / totalPolygonCount) * 80);
			const message = `Rendering ${topCellName} (${cell.polygons.length} polygons)...`;
			onProgress?.(baseProgress, message);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const result = await this.renderCell(
				cell,
				document,
				0,
				0,
				0,
				false,
				1,
				options.maxDepth,
				polygonBudget,
				options.fillMode,
				options.overrideScale,
				options.layerVisibility,
				(cellProgress, cellMessage) => {
					const cellContribution = (cell.polygons.length / totalPolygonCount) * 80;
					const overallProgress =
						baseProgress + Math.floor((cellProgress / 100) * cellContribution);
					onProgress?.(overallProgress, cellMessage);
				},
			);

			allGraphicsItems.push(...result.graphicsItems);
			totalPolygons += result.renderedPolygons;
			polygonBudget -= result.renderedPolygons;
			processedPolygons += cell.polygons.length;

			const afterProgress = Math.floor((processedPolygons / totalPolygonCount) * 80);
			const afterMessage = `Rendered ${topCellName}`;
			onProgress?.(afterProgress, afterMessage);
			await new Promise((resolve) => setTimeout(resolve, 0));

			if (polygonBudget <= 0) {
				console.warn(
					`[GDSRenderer] Budget exhausted (${options.maxPolygonsPerRender.toLocaleString()}), stopping render`,
				);
				break;
			}
		}

		return {
			totalPolygons,
			renderedPolygons: totalPolygons,
			graphicsItems: allGraphicsItems,
		};
	}

	/**
	 * Render cell geometry with transformations (batched by layer and tile)
	 */
	private async renderCell(
		cell: Cell,
		document: GDSDocument,
		x: number,
		y: number,
		rotation: number,
		mirror: boolean,
		magnification: number,
		maxDepth: number,
		polygonBudget: number,
		fillMode: boolean,
		overrideScale: number | undefined,
		layerVisibility: Map<string, boolean>,
		onProgress?: RenderProgressCallback,
	): Promise<RenderResult> {
		// Track cell render counts
		const currentCount = this.cellRenderCounts.get(cell.name) || 0;
		this.cellRenderCounts.set(cell.name, currentCount + 1);

		if (polygonBudget <= 0) {
			return { totalPolygons: 0, renderedPolygons: 0, graphicsItems: [] };
		}

		// Create container for this cell
		// Note: We don't apply position/rotation/scale/mirror to the container because we're
		// flattening the hierarchy and transforming each polygon directly to world coordinates.
		const cellContainer = new Container();

		// Calculate stroke width for outline mode
		const currentScale = overrideScale ?? this.mainContainer.scale.x;
		const desiredScreenPixels = 2.0;
		let strokeWidthDB = desiredScreenPixels / currentScale;
		const minStrokeWidthDB = 0.1;
		if (strokeWidthDB < minStrokeWidthDB) {
			strokeWidthDB = minStrokeWidthDB;
		}

		// Removed excessive per-cell logging

		// Batch polygons by layer and spatial tile
		const tileGraphics = new Map<string, Graphics>();
		const tileBounds = new Map<string, BoundingBox>();
		const tilePolygonCounts = new Map<string, number>();

		const totalPolygonsInCell = cell.polygons.length;
		const directPolygonBudget = Math.min(totalPolygonsInCell, polygonBudget);
		let renderedPolygons = 0;

		// Render direct polygons
		for (let i = 0; i < totalPolygonsInCell; i++) {
			if (renderedPolygons >= directPolygonBudget) {
				break;
			}

			const polygon = cell.polygons[i];
			if (!polygon) continue;

			const layerKey = `${polygon.layer}:${polygon.datatype}`;
			const layer = document.layers.get(layerKey);
			if (!layer) continue;

			// Check layer visibility from the passed-in map
			const isVisible = layerVisibility.get(layerKey) ?? true;
			if (!isVisible) continue;

			// Transform the polygon's bounding box to get the actual position
			const transformedBBox = this.transformBoundingBox(
				polygon.boundingBox,
				x,
				y,
				rotation,
				mirror,
				magnification,
			);

			// Calculate tile coordinates from transformed bounding box
			const centerX = (transformedBBox.minX + transformedBBox.maxX) / 2;
			const centerY = (transformedBBox.minY + transformedBBox.maxY) / 2;
			const tileX = Math.floor(centerX / SPATIAL_TILE_SIZE);
			const tileY = Math.floor(centerY / SPATIAL_TILE_SIZE);
			const tileKey = `${layerKey}:${tileX}:${tileY}`;

			// Get or create Graphics for this tile
			let graphics = tileGraphics.get(tileKey);
			if (!graphics) {
				graphics = new Graphics();
				tileGraphics.set(tileKey, graphics);
				cellContainer.addChild(graphics);

				tileBounds.set(tileKey, {
					minX: Number.POSITIVE_INFINITY,
					minY: Number.POSITIVE_INFINITY,
					maxX: Number.NEGATIVE_INFINITY,
					maxY: Number.NEGATIVE_INFINITY,
				});
				tilePolygonCounts.set(tileKey, 0);
			}

			// Add polygon to graphics with transformation
			this.addPolygonToGraphics(
				graphics,
				polygon,
				layer.color,
				strokeWidthDB,
				fillMode,
				x,
				y,
				rotation,
				mirror,
				magnification,
			);
			renderedPolygons++;

			// Update tile stats
			const currentCount = tilePolygonCounts.get(tileKey) || 0;
			tilePolygonCounts.set(tileKey, currentCount + 1);

			// Update bounds with transformed bounding box
			const bounds = tileBounds.get(tileKey)!;
			bounds.minX = Math.min(bounds.minX, transformedBBox.minX);
			bounds.minY = Math.min(bounds.minY, transformedBBox.minY);
			bounds.maxX = Math.max(bounds.maxX, transformedBBox.maxX);
			bounds.maxY = Math.max(bounds.maxY, transformedBBox.maxY);
		}

		this.mainContainer.addChild(cellContainer);

		// Add tiles to spatial index
		const graphicsItems: RTreeItem[] = [];
		for (const [tileKey, graphics] of tileGraphics) {
			const bounds = tileBounds.get(tileKey)!;
			const [layerStr, datatypeStr] = tileKey.split(":");
			const layer = Number.parseInt(layerStr || "0", 10);
			const datatype = Number.parseInt(datatypeStr || "0", 10);
			const polygonCount = tilePolygonCounts.get(tileKey) || 0;

			// Bounds are already in world coordinates (transformation is baked in)
			const item: RTreeItem = {
				minX: bounds.minX,
				minY: bounds.minY,
				maxX: bounds.maxX,
				maxY: bounds.maxY,
				id: `${cell.name}_${tileKey}_${x}_${y}`,
				type: "tile",
				data: graphics,
				layer,
				datatype,
				polygonCount,
			};
			this.spatialIndex.insert(item);
			graphicsItems.push(item);
		}

		// Render instances recursively
		let totalPolygons = renderedPolygons;
		let remainingBudget = polygonBudget - renderedPolygons;

		// Skip rendering instances for context info cells (they're just library references)
		const isContextCell = cell.name.includes("CONTEXT_INFO");

		if (maxDepth > 0 && remainingBudget > 0 && !isContextCell) {
			for (const instance of cell.instances) {
				if (remainingBudget <= 0) break;

				const refCell = document.cells.get(instance.cellRef);
				if (refCell) {
					// Calculate transformed position
					// Apply parent's rotation, mirror, and magnification to instance position
					const rad = (rotation * Math.PI) / 180;
					const cos = Math.cos(rad);
					const sin = Math.sin(rad);
					const mx = mirror ? -1 : 1;

					const newX = x + (instance.x * cos * mx - instance.y * sin) * magnification;
					const newY = y + (instance.x * sin * mx + instance.y * cos) * magnification;
					const newRotation = rotation + instance.rotation;
					const newMirror = mirror !== instance.mirror;
					const newMagnification = magnification * instance.magnification;

					const result = await this.renderCell(
						refCell,
						document,
						newX,
						newY,
						newRotation,
						newMirror,
						newMagnification,
						maxDepth - 1,
						remainingBudget,
						fillMode,
						overrideScale,
						layerVisibility,
						onProgress,
					);
					graphicsItems.push(...result.graphicsItems);
					totalPolygons += result.renderedPolygons;
					remainingBudget -= result.renderedPolygons;
				}
			}
		}

		return {
			totalPolygons,
			renderedPolygons: totalPolygons,
			graphicsItems,
		};
	}

	/**
	 * Add polygon to Graphics object with transformation
	 */
	private addPolygonToGraphics(
		graphics: Graphics,
		polygon: Polygon,
		colorHex: string,
		strokeWidthDB: number,
		fillMode: boolean,
		x: number,
		y: number,
		rotation: number,
		mirror: boolean,
		magnification: number,
	): void {
		let color = Number.parseInt(colorHex.replace("#", ""), 16);

		if (Number.isNaN(color)) {
			console.warn(`[GDSRenderer] Invalid color: "${colorHex}", using default blue`);
			color = 0x4a9eff;
		}

		if (polygon.points.length > 0 && polygon.points[0]) {
			// Transform first point
			const firstPt = this.transformPoint(
				polygon.points[0].x,
				polygon.points[0].y,
				x,
				y,
				rotation,
				mirror,
				magnification,
			);
			graphics.moveTo(firstPt.x, firstPt.y);

			// Transform and draw remaining points
			for (let i = 1; i < polygon.points.length; i++) {
				const point = polygon.points[i];
				if (point) {
					const pt = this.transformPoint(point.x, point.y, x, y, rotation, mirror, magnification);
					graphics.lineTo(pt.x, pt.y);
				}
			}
			graphics.closePath();

			if (fillMode) {
				graphics.fill({ color, alpha: 0.7 });
			} else {
				graphics.stroke({ color, width: strokeWidthDB, alpha: 1.0 });
			}
		}
	}

	/**
	 * Transform a single point by position, rotation, mirror, and magnification
	 * GDS transformation order: mirror → rotate → magnify → translate
	 */
	private transformPoint(
		px: number,
		py: number,
		x: number,
		y: number,
		rotation: number,
		mirror: boolean,
		magnification: number,
	): { x: number; y: number } {
		// Step 1: Mirror (flip Y-axis if mirror=true)
		const mx = mirror ? px : px;
		const my = mirror ? -py : py;

		// Step 2: Rotate
		const rad = (rotation * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const rx = mx * cos - my * sin;
		const ry = mx * sin + my * cos;

		// Step 3: Magnify
		const sx = rx * magnification;
		const sy = ry * magnification;

		// Step 4: Translate
		return { x: sx + x, y: sy + y };
	}

	/**
	 * Transform a bounding box by transforming all 4 corners and finding the new bounds
	 */
	private transformBoundingBox(
		bbox: BoundingBox,
		x: number,
		y: number,
		rotation: number,
		mirror: boolean,
		magnification: number,
	): BoundingBox {
		// Transform all 4 corners
		const corners = [
			this.transformPoint(bbox.minX, bbox.minY, x, y, rotation, mirror, magnification),
			this.transformPoint(bbox.maxX, bbox.minY, x, y, rotation, mirror, magnification),
			this.transformPoint(bbox.minX, bbox.maxY, x, y, rotation, mirror, magnification),
			this.transformPoint(bbox.maxX, bbox.maxY, x, y, rotation, mirror, magnification),
		];

		// Find the new bounding box
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const corner of corners) {
			minX = Math.min(minX, corner.x);
			minY = Math.min(minY, corner.y);
			maxX = Math.max(maxX, corner.x);
			maxY = Math.max(maxY, corner.y);
		}

		return { minX, minY, maxX, maxY };
	}
}
