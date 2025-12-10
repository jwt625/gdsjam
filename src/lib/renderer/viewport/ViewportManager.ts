/**
 * ViewportManager - Handles viewport culling and layer visibility filtering
 *
 * Responsibilities:
 * - Calculate viewport bounds in world coordinates (accounting for Y-axis flip)
 * - Query spatial index to find graphics items within viewport
 * - Apply layer visibility filtering to hide/show items
 * - Track visibility statistics for performance metrics
 * - Detect newly visible layers for on-demand rendering
 *
 * Performance:
 * - Uses R-tree spatial index for efficient viewport queries
 * - Only updates visibility when viewport changes (debounced)
 * - Minimizes Graphics object visibility toggles
 */

import type { Graphics } from "pixi.js";
import type { BoundingBox } from "../../../types/gds";
import type { RTreeItem, SpatialIndex } from "../../spatial/RTree";

export interface ViewportUpdateResult {
	visiblePolygonCount: number;
	visibleByLayerCount: number;
	hiddenByLayerCount: number;
}

export class ViewportManager {
	constructor(
		private spatialIndex: SpatialIndex,
		private getLayerVisibility: () => Map<string, boolean>,
	) {}

	/**
	 * Calculate viewport bounds in world coordinates
	 */
	getViewportBounds(
		screenWidth: number,
		screenHeight: number,
		containerX: number,
		containerY: number,
		scale: number,
		scaleY: number,
	): BoundingBox {
		const x = -containerX / scale;
		const y = -containerY / scaleY;
		const width = screenWidth / scale;
		const height = screenHeight / Math.abs(scaleY);

		// Account for Y-axis flip
		if (scaleY < 0) {
			return {
				minX: x,
				minY: y - height,
				maxX: x + width,
				maxY: y,
			};
		}

		return {
			minX: x,
			minY: y,
			maxX: x + width,
			maxY: y + height,
		};
	}

	/**
	 * Update visibility of all graphics items based on viewport and layer visibility
	 * Returns counts for performance metrics
	 */
	updateVisibility(
		viewportBounds: BoundingBox,
		allGraphicsItems: RTreeItem[],
	): ViewportUpdateResult {
		if (allGraphicsItems.length === 0) {
			return {
				visiblePolygonCount: 0,
				visibleByLayerCount: 0,
				hiddenByLayerCount: 0,
			};
		}

		const visibleItems = this.spatialIndex.query(viewportBounds);
		const visibleIds = new Set(visibleItems.map((item) => item.id));
		const layerVisibility = this.getLayerVisibility();

		// Update visibility of all graphics items (combine viewport + layer visibility)
		let visiblePolygonCount = 0;
		let hiddenByLayerCount = 0;
		let visibleByLayerCount = 0;
		const layerCounts = new Map<string, { total: number; visible: number }>();

		for (const item of allGraphicsItems) {
			const graphics = item.data as Graphics;
			const inViewport = visibleIds.has(item.id);

			// Check layer visibility
			const layerKey = `${item.layer}:${item.datatype}`;
			const layerVisible = layerVisibility.get(layerKey) ?? true;

			const isVisible = inViewport && layerVisible;
			graphics.visible = isVisible;

			// Track per-layer counts
			if (!layerCounts.has(layerKey)) {
				layerCounts.set(layerKey, { total: 0, visible: 0 });
			}
			const counts = layerCounts.get(layerKey)!;
			counts.total++;
			if (isVisible) counts.visible++;

			if (inViewport) {
				if (layerVisible) {
					visibleByLayerCount++;
				} else {
					hiddenByLayerCount++;
				}
			}

			if (isVisible) {
				visiblePolygonCount += item.polygonCount || 0;
			}
		}

		return {
			visiblePolygonCount,
			visibleByLayerCount,
			hiddenByLayerCount,
		};
	}

	/**
	 * Detect newly visible layers that need to be rendered
	 */
	detectNewlyVisibleLayers(
		newVisibility: { [key: string]: boolean },
		currentVisibility: Map<string, boolean>,
		allGraphicsItems: RTreeItem[],
	): string[] {
		const newlyVisibleLayers: string[] = [];

		for (const [key, visible] of Object.entries(newVisibility)) {
			const wasVisible = currentVisibility.get(key) ?? true;
			if (visible && !wasVisible) {
				// Check if this layer has any rendered graphics
				const hasGraphics = allGraphicsItems.some(
					(item) => `${item.layer}:${item.datatype}` === key,
				);
				if (!hasGraphics) {
					newlyVisibleLayers.push(key);
				}
			}
		}

		return newlyVisibleLayers;
	}
}
