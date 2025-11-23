/**
 * GridOverlay - Renders a dynamic grid based on viewport bounds
 *
 * Responsibilities:
 * - Calculate grid spacing based on viewport width (powers of 10)
 * - Render vertical and horizontal grid lines
 * - Update grid when viewport changes (zoom/pan)
 * - Toggle grid visibility (G key)
 *
 * Implementation:
 * - Grid spacing: 10^floor(log10(viewWidth / targetLines))
 * - Line width scales with zoom to maintain constant screen width
 * - Grid container transforms match main container for alignment
 */

import type { Application, Container } from "pixi.js";
import { Graphics } from "pixi.js";
import type { BoundingBox } from "../../../types/gds";

export class GridOverlay {
	private container: Container;
	private visible = true;

	constructor(container: Container, _app: Application) {
		this.container = container;
	}

	/**
	 * Update grid rendering
	 */
	update(viewportBounds: BoundingBox, scale: number, visible: boolean): void {
		this.visible = visible;
		this.container.removeChildren();

		if (!this.visible) return;

		const bounds = viewportBounds;

		// Calculate grid spacing (powers of 10)
		const viewWidth = bounds.maxX - bounds.minX;
		const targetLines = 10;
		const rawSpacing = viewWidth / targetLines;
		const gridSpacing = 10 ** Math.floor(Math.log10(rawSpacing));

		const graphics = new Graphics();
		graphics.setStrokeStyle({ width: 1 / scale, color: 0x333333, alpha: 0.3 });

		// Vertical lines
		const startX = Math.floor(bounds.minX / gridSpacing) * gridSpacing;
		for (let x = startX; x <= bounds.maxX; x += gridSpacing) {
			graphics.moveTo(x, bounds.minY);
			graphics.lineTo(x, bounds.maxY);
		}
		graphics.stroke();

		// Horizontal lines
		const startY = Math.floor(bounds.minY / gridSpacing) * gridSpacing;
		for (let y = startY; y <= bounds.maxY; y += gridSpacing) {
			graphics.moveTo(bounds.minX, y);
			graphics.lineTo(bounds.maxX, y);
		}
		graphics.stroke();

		this.container.addChild(graphics);
	}

	/**
	 * Update container position and scale to match main container
	 */
	updateTransform(x: number, y: number, scaleX: number, scaleY: number): void {
		this.container.x = x;
		this.container.y = y;
		this.container.scale.x = scaleX;
		this.container.scale.y = scaleY;
	}

	/**
	 * Toggle grid visibility
	 */
	toggleVisibility(): void {
		this.visible = !this.visible;
	}

	/**
	 * Get current visibility state
	 */
	isVisible(): boolean {
		return this.visible;
	}
}
