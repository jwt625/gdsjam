import { Container, Graphics } from "pixi.js";
import type { CompleteOverviewArtifact } from "./CompleteOverview";

/** Convert a ready coverage artifact into Pixi run-length rectangles. */
export function createOverviewPixiContainer(artifact: CompleteOverviewArtifact): Container {
	if (!artifact.telemetry.complete || artifact.telemetry.status !== "ready") {
		throw new Error("Only a complete overview artifact may be committed to the renderer");
	}
	const container = new Container();
	container.label = "complete-overview";
	const worldWidth = artifact.bounds.maxX - artifact.bounds.minX;
	const worldHeight = artifact.bounds.maxY - artifact.bounds.minY;
	const pixelWidth = worldWidth / artifact.telemetry.physicalWidth;
	const pixelHeight = worldHeight / artifact.telemetry.physicalHeight;

	for (const layer of artifact.layers) {
		const graphics = new Graphics();
		graphics.label = `complete-overview-layer:${layer.key}`;
		const parsedColor = Number.parseInt(layer.color.replace("#", ""), 16);
		const color = Number.isNaN(parsedColor) ? 0x4a9eff : parsedColor;
		for (let row = 0; row < artifact.telemetry.physicalHeight; row++) {
			let column = 0;
			while (column < artifact.telemetry.physicalWidth) {
				if (layer.coverage[row * artifact.telemetry.physicalWidth + column] === 0) {
					column++;
					continue;
				}
				const runStart = column;
				while (
					column < artifact.telemetry.physicalWidth &&
					layer.coverage[row * artifact.telemetry.physicalWidth + column] !== 0
				) {
					column++;
				}
				graphics.rect(
					artifact.bounds.minX + runStart * pixelWidth,
					artifact.bounds.minY + row * pixelHeight,
					(column - runStart) * pixelWidth,
					pixelHeight,
				);
			}
		}
		graphics.fill({ color, alpha: 0.38 });
		container.addChild(graphics);
	}
	return container;
}
