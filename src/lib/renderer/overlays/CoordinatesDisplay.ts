/**
 * CoordinatesDisplay - Shows mouse cursor position in world coordinates
 *
 * Responsibilities:
 * - Convert screen coordinates to world coordinates
 * - Account for Y-axis flip (GDSII uses Y-up Cartesian convention)
 * - Convert database units to micrometers for display
 * - Update display text with formatted coordinates
 *
 * Coordinate System:
 * - Screen: Origin at top-left, Y-down
 * - World: Origin at center, Y-up (flipped via mainContainer.scale.y = -1)
 * - Display: Micrometers with 3 decimal places (nm precision)
 */

import type { Text } from "pixi.js";

export class CoordinatesDisplay {
	private text: Text;

	constructor(text: Text) {
		this.text = text;
	}

	/**
	 * Update coordinate display based on mouse position
	 */
	update(
		mouseX: number,
		mouseY: number,
		containerX: number,
		containerY: number,
		scale: number,
		documentUnits: { database: number; user: number },
	): void {
		// Convert screen coordinates to world coordinates (in database units)
		const worldX = (mouseX - containerX) / scale;
		// Y-axis is flipped (mainContainer.scale.y = -1), so negate Y coordinate
		const worldY = -((mouseY - containerY) / scale);

		// Convert to micrometers with nm precision (3 decimal places)
		// Coordinates are in database units, so: db_units * (database meters) / 1e-6 = micrometers
		const worldXMicrometers = (worldX * documentUnits.database) / 1e-6;
		const worldYMicrometers = (worldY * documentUnits.database) / 1e-6;

		this.text.text = `X: ${worldXMicrometers.toFixed(3)} µm, Y: ${worldYMicrometers.toFixed(3)} µm`;
	}

	/**
	 * Update text position (called on window resize)
	 */
	updatePosition(screenWidth: number, screenHeight: number): void {
		this.text.x = screenWidth - 200;
		this.text.y = screenHeight - 30;
	}
}
