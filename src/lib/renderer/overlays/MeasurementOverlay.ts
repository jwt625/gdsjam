/**
 * MeasurementOverlay - Renders measurement lines and distance labels
 *
 * Responsibilities:
 * - Render completed measurements (line + label)
 * - Render active measurement (partial line from point1 to cursor)
 * - Convert world coordinates to screen coordinates
 * - Format distance labels with smart units
 * - Handle viewport changes (measurements stay anchored to world coordinates)
 */

import type { Application, Container } from "pixi.js";
import { Graphics, Text } from "pixi.js";
import type { ActiveMeasurement, DistanceMeasurement } from "../../measurements/types";
import { formatDistance, worldToScreen } from "../../measurements/utils";

export class MeasurementOverlay {
	private container: Container;
	private app: Application;

	constructor(container: Container, app: Application) {
		this.container = container;
		this.app = app;
	}

	/**
	 * Update measurement rendering
	 * Called when measurements change or viewport changes
	 */
	update(
		measurements: Map<string, DistanceMeasurement>,
		activeMeasurement: ActiveMeasurement | null,
		cursorWorldPos: { worldX: number; worldY: number } | null,
		visible: boolean,
		containerX: number,
		containerY: number,
		scale: number,
		highlightedMeasurementId: string | null,
	): void {
		this.container.removeChildren();

		if (!visible) return;

		// Render completed measurements
		for (const measurement of measurements.values()) {
			const isHighlighted = measurement.id === highlightedMeasurementId;
			this.renderMeasurement(measurement, containerX, containerY, scale, isHighlighted);
		}

		// Render active measurement (in progress)
		if (activeMeasurement?.point1) {
			if (activeMeasurement.point2) {
				// Both points set (drag gesture in progress)
				this.renderActiveMeasurement(
					activeMeasurement.point1,
					activeMeasurement.point2,
					containerX,
					containerY,
					scale,
				);
			} else if (cursorWorldPos) {
				// Only point1 set, cursor tracking
				this.renderActiveMeasurement(
					activeMeasurement.point1,
					cursorWorldPos,
					containerX,
					containerY,
					scale,
				);
			}
		}
	}

	/**
	 * Render a completed measurement
	 */
	private renderMeasurement(
		measurement: DistanceMeasurement,
		containerX: number,
		containerY: number,
		scale: number,
		isHighlighted: boolean,
	): void {
		const { point1, point2, distanceMicrometers } = measurement;

		// Convert world coordinates to screen coordinates
		const screen1 = worldToScreen(point1.worldX, point1.worldY, containerX, containerY, scale);
		const screen2 = worldToScreen(point2.worldX, point2.worldY, containerX, containerY, scale);

		// Draw line
		const graphics = new Graphics();
		const lineColor = isHighlighted ? 0xffffff : 0xcccccc; // Light grey (matches coordinates text)
		const lineWidth = isHighlighted ? 3 : 2;
		const lineAlpha = isHighlighted ? 1.0 : 0.8;

		graphics.setStrokeStyle({ width: lineWidth, color: lineColor, alpha: lineAlpha });
		graphics.moveTo(screen1.x, screen1.y);
		graphics.lineTo(screen2.x, screen2.y);
		graphics.stroke();

		// Draw endpoint circles
		const circleRadius = isHighlighted ? 5 : 4;
		graphics.circle(screen1.x, screen1.y, circleRadius);
		graphics.fill({ color: lineColor, alpha: 1.0 });
		graphics.circle(screen2.x, screen2.y, circleRadius);
		graphics.fill({ color: lineColor, alpha: 1.0 });

		this.container.addChild(graphics);

		// Draw distance label at midpoint
		const midX = (screen1.x + screen2.x) / 2;
		const midY = (screen1.y + screen2.y) / 2;

		const label = new Text({
			text: formatDistance(distanceMicrometers),
			style: {
				fontFamily: "monospace",
				fontSize: isHighlighted ? 13 : 12,
				fill: lineColor,
				stroke: { color: 0x000000, width: 3 },
			},
		});
		label.x = midX;
		label.y = midY - 15; // Offset above the line
		label.anchor.set(0.5, 0.5);

		this.container.addChild(label);
	}

	/**
	 * Render active measurement (in progress)
	 */
	private renderActiveMeasurement(
		point1: { worldX: number; worldY: number },
		point2: { worldX: number; worldY: number },
		containerX: number,
		containerY: number,
		scale: number,
	): void {
		const screen1 = worldToScreen(point1.worldX, point1.worldY, containerX, containerY, scale);
		const screen2 = worldToScreen(point2.worldX, point2.worldY, containerX, containerY, scale);

		// Draw dashed line (preview)
		const graphics = new Graphics();
		const lineColor = 0xcccccc; // Light grey (matches coordinates text)
		const lineWidth = 2;
		const lineAlpha = 0.6;

		graphics.setStrokeStyle({ width: lineWidth, color: lineColor, alpha: lineAlpha });

		// Simple dashed line approximation
		const dx = screen2.x - screen1.x;
		const dy = screen2.y - screen1.y;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const dashLength = 10;
		const gapLength = 5;
		const totalLength = dashLength + gapLength;

		if (distance > 0) {
			const numSegments = Math.floor(distance / totalLength);

			for (let i = 0; i < numSegments; i++) {
				const t1 = (i * totalLength) / distance;
				const t2 = (i * totalLength + dashLength) / distance;
				const x1 = screen1.x + dx * t1;
				const y1 = screen1.y + dy * t1;
				const x2 = screen1.x + dx * t2;
				const y2 = screen1.y + dy * t2;
				graphics.moveTo(x1, y1);
				graphics.lineTo(x2, y2);
			}

			// Draw remaining segment
			const remainingDistance = distance - numSegments * totalLength;
			if (remainingDistance > 0) {
				const t1 = (numSegments * totalLength) / distance;
				const t2 = Math.min(1, (numSegments * totalLength + dashLength) / distance);
				const x1 = screen1.x + dx * t1;
				const y1 = screen1.y + dy * t1;
				const x2 = screen1.x + dx * t2;
				const y2 = screen1.y + dy * t2;
				graphics.moveTo(x1, y1);
				graphics.lineTo(x2, y2);
			}
		}

		graphics.stroke();

		// Draw first point circle
		graphics.circle(screen1.x, screen1.y, 4);
		graphics.fill({ color: lineColor, alpha: 1.0 });

		this.container.addChild(graphics);
	}

	/**
	 * Clear all rendered measurements
	 */
	clear(): void {
		this.container.removeChildren();
	}
}
