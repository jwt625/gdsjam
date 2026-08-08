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
import { DEBUG_RENDERER } from "../../debug";
import type { RenderDiagnostics } from "../../diagnostics/renderDiagnostics";
import {
	type AffineTransform,
	transformBoundingBox as applyTransformToBoundingBox,
	transformPoint as applyTransformToPoint,
	composeAffine,
	fromGDSReferenceTransform,
	IDENTITY_TRANSFORM,
} from "../../layout/AffineTransform";
import type { RTreeItem, SpatialIndex } from "../../spatial/RTree";

export type RenderProgressCallback = (
	progress: number,
	message: string,
	diagnostics?: RenderDiagnostics,
) => void;

export interface RenderOptions {
	maxDepth: number;
	maxPolygonsPerRender: number;
	fillMode: boolean;
	overrideScale?: number;
	layerVisibility: Map<string, boolean>;
	/** Explicit roots to render. Descendants are still resolved from the full document. */
	rootCellNames?: readonly string[];
}

export interface RenderResult {
	totalPolygons: number;
	renderedPolygons: number;
	graphicsItems: RTreeItem[];
	budgetExhausted: boolean;
	depthLimited: boolean;
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

		const topCells = (options.rootCellNames ?? document.topCells)
			.map((cellName) => document.cells.get(cellName))
			.filter((cell): cell is Cell => {
				if (!cell) return false;
				return !cell.name.includes("CONTEXT_INFO") && !cell.name.startsWith("$$$");
			});

		if (DEBUG_RENDERER) {
			console.log(
				`[GDSRenderer] Rendering with maxDepth=${options.maxDepth}, budget=${options.maxPolygonsPerRender}`,
			);
			console.log(`[GDSRenderer] Top cells to render: ${topCells.length}`);
			for (const cell of topCells) {
				console.log(
					`[GDSRenderer]   ${cell.name}: ${cell.polygons.length} polygons, ${cell.instances.length} instances`,
				);
			}
		}

		// Give hierarchy-only top cells a non-zero progress weight.
		const totalProgressWeight = Math.max(
			1,
			topCells.reduce((sum, cell) => sum + Math.max(cell.polygons.length, 1), 0),
		);

		let totalPolygons = 0;
		let polygonBudget = options.maxPolygonsPerRender;
		let processedProgressWeight = 0;
		let budgetExhausted = false;
		let depthLimited = false;

		// Render each top cell
		for (let topCellIndex = 0; topCellIndex < topCells.length; topCellIndex++) {
			const cell = topCells[topCellIndex];
			if (!cell) continue;
			if (polygonBudget <= 0) {
				budgetExhausted = true;
				break;
			}

			const topCellName = cell.name;

			const cellProgressWeight = Math.max(cell.polygons.length, 1);
			const baseProgress = Math.floor((processedProgressWeight / totalProgressWeight) * 80);
			const message = `Rendering ${topCellName} (${cell.polygons.length} polygons)...`;
			onProgress?.(baseProgress, message);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const result = await this.renderCell(
				cell,
				document,
				{ ...IDENTITY_TRANSFORM },
				options.maxDepth,
				polygonBudget,
				options.fillMode,
				options.overrideScale,
				options.layerVisibility,
				(cellProgress, cellMessage) => {
					const cellContribution = (cellProgressWeight / totalProgressWeight) * 80;
					const overallProgress =
						baseProgress + Math.floor((cellProgress / 100) * cellContribution);
					onProgress?.(overallProgress, cellMessage);
				},
			);

			allGraphicsItems.push(...result.graphicsItems);
			totalPolygons += result.renderedPolygons;
			budgetExhausted ||= result.budgetExhausted;
			depthLimited ||= result.depthLimited;
			polygonBudget -= result.renderedPolygons;
			processedProgressWeight += cellProgressWeight;

			const afterProgress = Math.floor((processedProgressWeight / totalProgressWeight) * 80);
			const afterMessage = `Rendered ${topCellName}`;
			onProgress?.(afterProgress, afterMessage);
			await new Promise((resolve) => setTimeout(resolve, 0));

			if (polygonBudget <= 0 && (result.budgetExhausted || topCellIndex < topCells.length - 1)) {
				budgetExhausted = true;
				console.warn(
					`[GDSRenderer] Budget exhausted (${options.maxPolygonsPerRender.toLocaleString()}), stopping render`,
				);
				break;
			}
		}

		if (DEBUG_RENDERER) {
			console.log(
				budgetExhausted
					? `[GDSRenderer] Partial render: budget stopped at ${totalPolygons} polygons, ${allGraphicsItems.length} graphics items`
					: `[GDSRenderer] Render complete: ${totalPolygons} polygons rendered, ${allGraphicsItems.length} graphics items`,
			);
		}

		return {
			totalPolygons,
			renderedPolygons: totalPolygons,
			graphicsItems: allGraphicsItems,
			budgetExhausted,
			depthLimited,
		};
	}

	/**
	 * Render cell geometry with transformations (batched by layer and tile)
	 */
	private async renderCell(
		cell: Cell,
		document: GDSDocument,
		worldTransform: AffineTransform,
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
			return {
				totalPolygons: 0,
				renderedPolygons: 0,
				graphicsItems: [],
				budgetExhausted: true,
				depthLimited: false,
			};
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
		let budgetExhausted = false;
		let depthLimited = false;

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
			const transformedBBox = applyTransformToBoundingBox(worldTransform, polygon.boundingBox);

			// Debug: Show transformed bbox for via layers
			if (
				DEBUG_RENDERER &&
				(polygon.layer === 40 || polygon.layer === 43 || polygon.layer === 44)
			) {
				console.log(
					`[GDSRenderer] Via layer ${polygon.layer} transformed bbox: ` +
						`[${transformedBBox.minX.toFixed(2)}, ${transformedBBox.minY.toFixed(2)}] to ` +
						`[${transformedBBox.maxX.toFixed(2)}, ${transformedBBox.maxY.toFixed(2)}]`,
				);
			}

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
				worldTransform,
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
		budgetExhausted ||=
			renderedPolygons >= directPolygonBudget && directPolygonBudget < totalPolygonsInCell;

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
				id: `${cell.name}_${tileKey}_${worldTransform.a}_${worldTransform.b}_${worldTransform.c}_${worldTransform.d}_${worldTransform.e}_${worldTransform.f}`,
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
		if (maxDepth <= 0 && cell.instances.length > 0 && !isContextCell) {
			depthLimited = true;
		}

		if (maxDepth > 0 && remainingBudget > 0 && !isContextCell) {
			for (let instanceIndex = 0; instanceIndex < cell.instances.length; instanceIndex++) {
				const instance = cell.instances[instanceIndex];
				if (!instance) continue;
				if (remainingBudget <= 0) {
					budgetExhausted = true;
					break;
				}

				const refCell = document.cells.get(instance.cellRef);
				if (refCell) {
					const instanceTransform = fromGDSReferenceTransform({
						x: instance.x,
						y: instance.y,
						rotationDegrees: instance.rotation,
						reflectAcrossX: instance.mirror,
						magnification: instance.magnification,
					});
					const childWorldTransform = composeAffine(worldTransform, instanceTransform);

					// Debug: Log instance transformation (first 3 instances per cell)
					if (DEBUG_RENDERER && cell.instances.indexOf(instance) < 3) {
						console.log(
							`[GDSRenderer] Instance: "${cell.name}" → "${refCell.name}" | ` +
								`inst_pos=(${instance.x.toFixed(2)}, ${instance.y.toFixed(2)}) | ` +
								`parent_origin=(${worldTransform.e.toFixed(2)}, ${worldTransform.f.toFixed(2)}) | ` +
								`→ final_origin=(${childWorldTransform.e.toFixed(2)}, ${childWorldTransform.f.toFixed(2)})`,
						);
					}

					const result = await this.renderCell(
						refCell,
						document,
						childWorldTransform,
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
					budgetExhausted ||= result.budgetExhausted;
					depthLimited ||= result.depthLimited;
					if (remainingBudget <= 0 && instanceIndex < cell.instances.length - 1) {
						budgetExhausted = true;
					}
				}
			}
		}

		return {
			totalPolygons,
			renderedPolygons: totalPolygons,
			graphicsItems,
			budgetExhausted,
			depthLimited,
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
		worldTransform: AffineTransform,
	): void {
		let color = Number.parseInt(colorHex.replace("#", ""), 16);

		if (Number.isNaN(color)) {
			console.warn(`[GDSRenderer] Invalid color: "${colorHex}", using default blue`);
			color = 0x4a9eff;
		}

		if (polygon.points.length > 0 && polygon.points[0]) {
			// Transform first point
			const firstPt = applyTransformToPoint(worldTransform, polygon.points[0]);
			graphics.moveTo(firstPt.x, firstPt.y);

			// Transform and draw remaining points
			for (let i = 1; i < polygon.points.length; i++) {
				const point = polygon.points[i];
				if (point) {
					const pt = applyTransformToPoint(worldTransform, point);
					graphics.lineTo(pt.x, pt.y);
				}
			}

			// Polylines (2 points - zero-width paths) are rendered as lines, not filled polygons
			const isPolyline = polygon.points.length === 2;

			if (!isPolyline) {
				graphics.closePath();
			}

			if (fillMode && !isPolyline) {
				graphics.fill({ color, alpha: 0.7 });
			} else {
				graphics.stroke({ color, width: strokeWidthDB, alpha: 1.0 });
			}
		}
	}
}
