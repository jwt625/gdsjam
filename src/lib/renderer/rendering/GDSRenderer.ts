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
import { DEBUG, SPATIAL_TILE_SIZE } from "../../config";
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

		if (DEBUG) {
			console.log(`[GDSRenderer] Found ${topCells.length} top-level cells`);
		}

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
			if (DEBUG) {
				console.log(
					`[GDSRenderer] Rendering top cell: ${topCellName} (${cell.polygons.length} polygons)`,
				);
			}

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

		if (DEBUG) {
			console.log(
				`[GDSRenderer] Render complete: ${totalPolygons.toLocaleString()} polygons in ${allGraphicsItems.length} tiles`,
			);
			console.log("[GDSRenderer] Cell render counts:", this.cellRenderCounts);
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
		const cellContainer = new Container();
		cellContainer.x = x;
		cellContainer.y = y;
		cellContainer.rotation = (rotation * Math.PI) / 180;
		cellContainer.scale.x = magnification * (mirror ? -1 : 1);
		cellContainer.scale.y = magnification;

		// Calculate stroke width for outline mode
		const currentScale = overrideScale ?? this.mainContainer.scale.x;
		const desiredScreenPixels = 2.0;
		let strokeWidthDB = desiredScreenPixels / currentScale;
		const minStrokeWidthDB = 0.1;
		if (strokeWidthDB < minStrokeWidthDB) {
			strokeWidthDB = minStrokeWidthDB;
		}

		if (DEBUG) {
			console.log(
				`[GDSRenderer] Cell ${cell.name}: strokeWidthDB=${strokeWidthDB.toExponential(2)} DB units, scale=${currentScale.toExponential(3)}`,
			);
		}

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
				if (DEBUG) {
					console.log(
						`[GDSRenderer] Cell ${cell.name}: Budget exhausted (${renderedPolygons}/${totalPolygonsInCell} rendered)`,
					);
				}
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

			// Calculate tile coordinates
			const centerX = (polygon.boundingBox.minX + polygon.boundingBox.maxX) / 2;
			const centerY = (polygon.boundingBox.minY + polygon.boundingBox.maxY) / 2;
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

			// Add polygon to graphics
			this.addPolygonToGraphics(graphics, polygon, layer.color, strokeWidthDB, fillMode);
			renderedPolygons++;

			// Update tile stats
			const currentCount = tilePolygonCounts.get(tileKey) || 0;
			tilePolygonCounts.set(tileKey, currentCount + 1);

			const bounds = tileBounds.get(tileKey)!;
			bounds.minX = Math.min(bounds.minX, polygon.boundingBox.minX);
			bounds.minY = Math.min(bounds.minY, polygon.boundingBox.minY);
			bounds.maxX = Math.max(bounds.maxX, polygon.boundingBox.maxX);
			bounds.maxY = Math.max(bounds.maxY, polygon.boundingBox.maxY);
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

			const item: RTreeItem = {
				minX: bounds.minX + x,
				minY: bounds.minY + y,
				maxX: bounds.maxX + x,
				maxY: bounds.maxY + y,
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

		if (maxDepth > 0 && remainingBudget > 0) {
			if (DEBUG) {
				console.log(
					`[GDSRenderer] Cell ${cell.name}: Rendering ${cell.instances.length} instances at depth ${maxDepth}`,
				);
			}

			for (const instance of cell.instances) {
				if (remainingBudget <= 0) break;

				const refCell = document.cells.get(instance.cellRef);
				if (refCell) {
					const result = await this.renderCell(
						refCell,
						document,
						x + instance.x,
						y + instance.y,
						rotation + instance.rotation,
						mirror !== instance.mirror,
						magnification * instance.magnification,
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
	 * Add polygon to Graphics object
	 */
	private addPolygonToGraphics(
		graphics: Graphics,
		polygon: Polygon,
		colorHex: string,
		strokeWidthDB: number,
		fillMode: boolean,
	): void {
		let color = Number.parseInt(colorHex.replace("#", ""), 16);

		if (Number.isNaN(color)) {
			console.warn(`[GDSRenderer] Invalid color: "${colorHex}", using default blue`);
			color = 0x4a9eff;
		}

		if (polygon.points.length > 0 && polygon.points[0]) {
			graphics.moveTo(polygon.points[0].x, polygon.points[0].y);
			for (let i = 1; i < polygon.points.length; i++) {
				const point = polygon.points[i];
				if (point) {
					graphics.lineTo(point.x, point.y);
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
}
