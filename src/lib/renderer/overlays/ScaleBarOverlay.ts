/**
 * ScaleBarOverlay - Renders a scale bar showing the current zoom level
 *
 * Responsibilities:
 * - Calculate scale bar width based on viewport width
 * - Convert database units to micrometers for display
 * - Format label with appropriate units (nm, µm, mm)
 * - Render bar with ticks and label
 *
 * Implementation:
 * - Bar width: 10^floor(log10(viewWidth / 4)) in micrometers
 * - Automatically selects unit based on magnitude (nm < 1µm < 1mm)
 * - Updates when viewport changes (zoom/pan)
 */

import type { Application, Container } from "pixi.js";
import { Graphics, Text } from "pixi.js";
import type { BoundingBox } from "../../../types/gds";

export class ScaleBarOverlay {
	private container: Container;
	private app: Application;

	constructor(container: Container, app: Application) {
		this.container = container;
		this.app = app;
	}

	/**
	 * Update scale bar rendering
	 */
	update(
		viewportBounds: BoundingBox,
		scale: number,
		documentUnits: { database: number; user: number },
	): void {
		this.container.removeChildren();

		const bounds = viewportBounds;
		const viewWidthDB = bounds.maxX - bounds.minX;

		// Convert database units to micrometers
		// Coordinates are ALWAYS in database units (for both GDS and DXF files)
		// database unit = size in meters, so: db_units * (database meters) / 1e-6 = micrometers
		const viewWidthMicrometers = (viewWidthDB * documentUnits.database) / 1e-6;

		// Calculate nice round number for bar width in micrometers
		const barWidthMicrometers = 10 ** Math.floor(Math.log10(viewWidthMicrometers / 4));

		// Convert back to database units for pixel calculation
		// micrometers * 1e-6 / (database meters) = database units
		const barWidthDB = (barWidthMicrometers * 1e-6) / documentUnits.database;
		const barWidthPixels = barWidthDB * scale;

		const graphics = new Graphics();
		const x = 20;
		const y = this.app.screen.height - 40;

		// Draw bar
		graphics.rect(x, y, barWidthPixels, 4);
		graphics.fill({ color: 0xffffff, alpha: 0.7 });

		// Draw ticks
		graphics.rect(x, y - 4, 2, 12);
		graphics.fill({ color: 0xffffff, alpha: 0.7 });
		graphics.rect(x + barWidthPixels - 2, y - 4, 2, 12);
		graphics.fill({ color: 0xffffff, alpha: 0.7 });

		this.container.addChild(graphics);

		// Add label with proper formatting
		let labelText: string;
		if (barWidthMicrometers >= 1000) {
			labelText = `${(barWidthMicrometers / 1000).toFixed(0)} mm`;
		} else if (barWidthMicrometers >= 1) {
			labelText = `${barWidthMicrometers.toFixed(0)} µm`;
		} else {
			labelText = `${(barWidthMicrometers * 1000).toFixed(0)} nm`;
		}

		const label = new Text({
			text: labelText,
			style: {
				fontFamily: "monospace",
				fontSize: 12,
				fill: 0xffffff,
			},
		});
		label.x = x;
		label.y = y + 8;
		this.container.addChild(label);
	}
}
