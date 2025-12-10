/**
 * MinimapRenderer - Renders a simplified overview of the GDS document
 *
 * Features:
 * - Separate PIXI Application instance (independent from main canvas)
 * - LOD culling: skips cells marked with skipInMinimap (< 1% of layout extent)
 * - Viewport outline: shows current main canvas viewport as a rectangle
 * - Click-to-navigate: clicking on minimap centers main viewport on that location
 * - Only re-renders on document load or layer visibility/color changes
 */

import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { BoundingBox, Cell, GDSDocument } from "../../types/gds";
import type { ParticipantViewport } from "../collaboration/types";
import { HIERARCHICAL_POLYGON_THRESHOLD } from "../config";

/** Screen-space bounds for a participant viewport (used for click detection) */
interface ParticipantViewportScreenBounds {
	userId: string;
	left: number;
	top: number;
	width: number;
	height: number;
	// For navigation: exact view center and scale
	worldCenterX: number;
	worldCenterY: number;
	scale: number;
}

export interface MinimapRenderStats {
	polygonCount: number;
	cellsSkipped: number;
	lastRenderTimeMs: number;
}

export class MinimapRenderer {
	private app: Application | null = null;
	private mainContainer: Container | null = null;
	private viewportOutline: Graphics | null = null;
	private participantViewportsContainer: Container | null = null;
	private isInitialized = false;

	// Document state
	private documentBounds: BoundingBox | null = null;
	private lastViewportBounds: BoundingBox | null = null;
	private canvas: HTMLCanvasElement | null = null;

	// Participant viewports for click detection
	private participantViewportBounds: ParticipantViewportScreenBounds[] = [];
	// Text objects pool for participant labels (reuse to avoid allocation)
	private labelPool: Text[] = [];

	// Render stats
	private stats: MinimapRenderStats = {
		polygonCount: 0,
		cellsSkipped: 0,
		lastRenderTimeMs: 0,
	};

	// Callback for click-to-navigate (extended to support exact view with scale)
	private onNavigateCallback: ((worldX: number, worldY: number, scale?: number) => void) | null =
		null;

	/**
	 * Initialize the minimap renderer with a canvas element
	 */
	async init(canvas: HTMLCanvasElement): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		// Store canvas reference for resize
		this.canvas = canvas;

		this.app = new Application();
		await this.app.init({
			canvas,
			width: canvas.width,
			height: canvas.height,
			backgroundColor: 0x1a1a1a,
			antialias: true,
			resolution: 1, // Use resolution 1 for simplicity - avoid CSS scaling issues
		});

		this.mainContainer = new Container();
		this.app.stage.addChild(this.mainContainer);

		// Participant viewports container (between layout and own viewport)
		this.participantViewportsContainer = new Container();
		this.app.stage.addChild(this.participantViewportsContainer);

		// Viewport outline (drawn on top of everything)
		this.viewportOutline = new Graphics();
		this.app.stage.addChild(this.viewportOutline);

		// Click handler for navigation
		this.app.stage.eventMode = "static";
		this.app.stage.hitArea = this.app.screen;
		this.app.stage.on("pointerdown", this.handleClick.bind(this));

		this.isInitialized = true;
	}

	/**
	 * Set callback for click-to-navigate
	 * @param callback - Called with world coordinates and optional scale (for participant viewport clicks)
	 */
	setOnNavigate(callback: ((worldX: number, worldY: number, scale?: number) => void) | null): void {
		this.onNavigateCallback = callback;
	}

	/**
	 * Handle click on minimap - check participant viewports first, then navigate to world coordinates
	 */
	private handleClick(event: { global: { x: number; y: number } }): void {
		if (!this.documentBounds || !this.mainContainer || !this.app) {
			return;
		}

		const screenX = event.global.x;
		const screenY = event.global.y;

		// Check if click is on a participant viewport (check in reverse order - topmost first)
		for (let i = this.participantViewportBounds.length - 1; i >= 0; i--) {
			const bounds = this.participantViewportBounds[i];
			if (!bounds) continue;
			if (
				screenX >= bounds.left &&
				screenX <= bounds.left + bounds.width &&
				screenY >= bounds.top &&
				screenY <= bounds.top + bounds.height
			) {
				// Clicked on a participant viewport - navigate to their exact view
				this.onNavigateCallback?.(bounds.worldCenterX, bounds.worldCenterY, bounds.scale);
				return;
			}
		}

		// No participant viewport hit - convert to world coordinates for regular navigation
		const worldX = (screenX - this.mainContainer.x) / this.mainContainer.scale.x;
		const worldY = (screenY - this.mainContainer.y) / this.mainContainer.scale.y;

		this.onNavigateCallback?.(worldX, worldY);
	}

	/**
	 * Render the GDS document to the minimap
	 */
	async render(
		document: GDSDocument,
		layerVisibility: Map<string, boolean>,
		layerColors: Map<string, number>,
	): Promise<void> {
		if (!this.isInitialized || !this.app || !this.mainContainer) {
			return;
		}

		const startTime = performance.now();
		this.documentBounds = document.boundingBox;

		// Clear previous content
		this.mainContainer.removeChildren();

		// Reset stats
		this.stats.polygonCount = 0;
		this.stats.cellsSkipped = 0;

		// Check for valid bounds
		if (
			!this.documentBounds ||
			this.documentBounds.maxX <= this.documentBounds.minX ||
			this.documentBounds.maxY <= this.documentBounds.minY
		) {
			return;
		}

		// Fit document to minimap canvas
		this.fitToView();

		// Render all cells (skipping those marked for LOD culling)
		await this.renderCells(document, layerVisibility, layerColors);

		this.stats.lastRenderTimeMs = performance.now() - startTime;
	}

	/**
	 * Fit document bounds to minimap canvas
	 */
	private fitToView(): void {
		if (!this.app || !this.mainContainer || !this.documentBounds) {
			return;
		}

		const bounds = this.documentBounds;
		const docWidth = bounds.maxX - bounds.minX;
		const docHeight = bounds.maxY - bounds.minY;

		if (docWidth <= 0 || docHeight <= 0) {
			return;
		}

		const screenWidth = this.app.screen.width;
		const screenHeight = this.app.screen.height;
		const padding = 10; // pixels

		// Calculate scale to fit with padding
		const scaleX = (screenWidth - padding * 2) / docWidth;
		const scaleY = (screenHeight - padding * 2) / docHeight;
		const scale = Math.min(scaleX, scaleY);

		// Apply scale (Y-flip for GDS coordinates)
		this.mainContainer.scale.set(scale, -scale);

		// Center the document
		// With Y-flip, we need to position so the document center maps to screen center
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerY = (bounds.minY + bounds.maxY) / 2;

		// Container position: screen_center - doc_center * scale
		// For Y with flip: we add because the scale is negative
		this.mainContainer.x = screenWidth / 2 - centerX * scale;
		this.mainContainer.y = screenHeight / 2 + centerY * scale;
	}

	/**
	 * Render all cells with LOD culling
	 */
	private async renderCells(
		document: GDSDocument,
		layerVisibility: Map<string, boolean>,
		layerColors: Map<string, number>,
	): Promise<void> {
		if (!this.mainContainer) return;

		// Use document's topCells if available, otherwise find them
		let topCells: Cell[] = [];
		if (document.topCells && document.topCells.length > 0) {
			for (const cellName of document.topCells) {
				const cell = document.cells.get(cellName);
				if (cell) topCells.push(cell);
			}
		} else {
			// Fallback: find top-level cells by checking references
			const referencedCells = new Set<string>();
			for (const cell of document.cells.values()) {
				for (const instance of cell.instances) {
					referencedCells.add(instance.cellRef);
				}
			}
			topCells = Array.from(document.cells.values()).filter(
				(cell) => !referencedCells.has(cell.name),
			);
		}

		// Batch all polygons by layer for efficient rendering
		const layerGraphics = new Map<string, Graphics>();

		// For hierarchical files (top cells have instances but few/no polygons), start with higher depth
		// Otherwise we render nothing
		let startDepth = 0;
		let totalTopCellPolygons = 0;
		let totalTopCellInstances = 0;

		for (const cell of topCells) {
			totalTopCellPolygons += cell.polygons.length;
			totalTopCellInstances += cell.instances.length;
		}

		// If top cells have instances but very few polygons, it's hierarchical
		const isHierarchical =
			totalTopCellInstances > 0 && totalTopCellPolygons < HIERARCHICAL_POLYGON_THRESHOLD;
		startDepth = isHierarchical ? 3 : 0; // Start at depth 3 for hierarchical files

		for (const cell of topCells) {
			await this.renderCellRecursive(
				cell,
				document,
				0,
				0,
				0,
				false,
				1,
				layerVisibility,
				layerColors,
				layerGraphics,
				startDepth,
			);
		}

		// Add all layer graphics to container
		for (const graphics of layerGraphics.values()) {
			this.mainContainer.addChild(graphics);
		}
	}

	/**
	 * Recursively render a cell and its instances
	 */
	private async renderCellRecursive(
		cell: Cell,
		document: GDSDocument,
		x: number,
		y: number,
		rotation: number,
		mirror: boolean,
		magnification: number,
		layerVisibility: Map<string, boolean>,
		layerColors: Map<string, number>,
		layerGraphics: Map<string, Graphics>,
		depth: number,
	): Promise<void> {
		// LOD culling: skip small cells
		if (cell.skipInMinimap) {
			this.stats.cellsSkipped++;
			return;
		}

		// Limit recursion depth for performance
		const MAX_DEPTH = 10;
		if (depth > MAX_DEPTH) {
			return;
		}

		// Render direct polygons
		for (const polygon of cell.polygons) {
			const layerKey = `${polygon.layer}:${polygon.datatype}`;

			// Check visibility
			const isVisible = layerVisibility.get(layerKey) ?? true;
			if (!isVisible) continue;

			// Get or create graphics for this layer
			let graphics = layerGraphics.get(layerKey);
			if (!graphics) {
				graphics = new Graphics();
				layerGraphics.set(layerKey, graphics);
			}

			// Get layer color
			const color = layerColors.get(layerKey) ?? 0x888888;

			// Transform and draw polygon points (polygon.points is Point[] with .x, .y)
			const firstPoint = polygon.points[0];
			if (polygon.points.length > 0 && firstPoint) {
				const firstPt = this.transformPoint(
					firstPoint.x,
					firstPoint.y,
					x,
					y,
					rotation,
					mirror,
					magnification,
				);
				graphics.moveTo(firstPt.x, firstPt.y);

				for (let i = 1; i < polygon.points.length; i++) {
					const point = polygon.points[i];
					if (point) {
						const pt = this.transformPoint(point.x, point.y, x, y, rotation, mirror, magnification);
						graphics.lineTo(pt.x, pt.y);
					}
				}
				graphics.closePath();
				graphics.fill({ color, alpha: 0.8 });
			}

			this.stats.polygonCount++;
		}

		// Render child instances (skip context info cells - they're just library references)
		const isContextCell = cell.name.includes("$$$CONTEXT_INFO$$$");
		if (!isContextCell) {
			for (const instance of cell.instances) {
				const refCell = document.cells.get(instance.cellRef);
				if (!refCell) continue;

				// Calculate transformed position
				const rad = (rotation * Math.PI) / 180;
				const cos = Math.cos(rad);
				const sin = Math.sin(rad);
				const mx = mirror ? -1 : 1;

				const newX = x + (instance.x * cos * mx - instance.y * sin) * magnification;
				const newY = y + (instance.x * sin * mx + instance.y * cos) * magnification;
				const newRotation = rotation + instance.rotation;
				const newMirror = mirror !== instance.mirror;
				const newMagnification = magnification * instance.magnification;

				await this.renderCellRecursive(
					refCell,
					document,
					newX,
					newY,
					newRotation,
					newMirror,
					newMagnification,
					layerVisibility,
					layerColors,
					layerGraphics,
					depth + 1,
				);
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
	 * Update viewport outline to show current main canvas viewport
	 */
	updateViewportOutline(viewportBounds: BoundingBox): void {
		if (!this.viewportOutline || !this.mainContainer || !this.app) {
			return;
		}

		this.lastViewportBounds = viewportBounds;
		this.viewportOutline.clear();

		// Transform viewport bounds to minimap screen coordinates
		const scale = this.mainContainer.scale.x;
		const offsetX = this.mainContainer.x;
		const offsetY = this.mainContainer.y;

		// Convert world coordinates to screen coordinates
		// World Y increases up, screen Y increases down
		const x1 = viewportBounds.minX * scale + offsetX;
		const x2 = viewportBounds.maxX * scale + offsetX;
		// For Y: with -scale on container, world Y becomes inverted on screen
		const y1 = viewportBounds.minY * -scale + offsetY;
		const y2 = viewportBounds.maxY * -scale + offsetY;

		// y1 should be > y2 because minY (bottom) maps to larger screen Y
		const left = Math.min(x1, x2);
		const top = Math.min(y1, y2);
		const width = Math.abs(x2 - x1);
		const height = Math.abs(y2 - y1);

		// Draw viewport rectangle - use a thicker line to ensure visibility
		this.viewportOutline.rect(left, top, width, height);
		this.viewportOutline.stroke({ color: 0xcccccc, width: 3, alpha: 1.0 }); // Light grey (same as coordinates)
	}

	/**
	 * Update participant viewports display on minimap (Phase 3)
	 * Draws colored rectangles with labels for each participant's viewport
	 */
	updateParticipantViewports(viewports: ParticipantViewport[]): void {
		if (!this.participantViewportsContainer || !this.mainContainer || !this.app) {
			return;
		}

		// Clear previous participant viewports
		this.participantViewportsContainer.removeChildren();
		this.participantViewportBounds = [];

		// Hide unused labels from pool
		for (const label of this.labelPool) {
			label.visible = false;
		}

		const scale = this.mainContainer.scale.x;
		const offsetX = this.mainContainer.x;
		const offsetY = this.mainContainer.y;

		let labelIndex = 0;

		for (const participant of viewports) {
			const vp = participant.viewport;

			// Calculate viewport bounds in world coordinates
			// Use same logic as ViewportManager.getViewportBounds()
			// container.scale.y is -scale (Y flipped), so scaleY = -vp.scale
			const scaleY = -vp.scale;

			// World coordinates of viewport top-left corner
			const worldX = -vp.x / vp.scale;
			const worldY = -vp.y / scaleY;

			// Width and height in world units
			const worldWidth = vp.width / vp.scale;
			const worldHeight = vp.height / Math.abs(scaleY);

			// With scaleY < 0, the world Y range is [worldY - height, worldY]
			const worldMinX = worldX;
			const worldMaxX = worldX + worldWidth;
			const worldMinY = worldY - worldHeight;
			const worldMaxY = worldY;

			// Calculate world center for click navigation
			const worldCenterX = (worldMinX + worldMaxX) / 2;
			const worldCenterY = (worldMinY + worldMaxY) / 2;

			// Convert to screen coordinates
			const x1 = worldMinX * scale + offsetX;
			const x2 = worldMaxX * scale + offsetX;
			const y1 = worldMinY * -scale + offsetY;
			const y2 = worldMaxY * -scale + offsetY;

			const left = Math.min(x1, x2);
			const top = Math.min(y1, y2);
			const width = Math.abs(x2 - x1);
			const height = Math.abs(y2 - y1);

			// Skip if too small to see
			if (width < 4 || height < 4) continue;

			// Store bounds for click detection
			this.participantViewportBounds.push({
				userId: participant.userId,
				left,
				top,
				width,
				height,
				worldCenterX,
				worldCenterY,
				scale: vp.scale,
			});

			// Parse hex color to number
			const colorNum = this.parseColor(participant.color);

			// Draw rectangle
			const graphics = new Graphics();

			if (participant.isFollowed) {
				// Followed user: thicker border with subtle glow (larger outer stroke)
				graphics.rect(left - 2, top - 2, width + 4, height + 4);
				graphics.stroke({ color: colorNum, width: 4, alpha: 0.3 });
			}

			graphics.rect(left, top, width, height);
			graphics.stroke({ color: colorNum, width: 2, alpha: 0.9 });

			// Subtle fill for participant viewports
			graphics.rect(left, top, width, height);
			graphics.fill({ color: colorNum, alpha: 0.1 });

			this.participantViewportsContainer.addChild(graphics);

			// Add label at top-left corner
			const label = this.getOrCreateLabel(labelIndex);
			label.text = participant.displayName;
			label.style = new TextStyle({
				fontFamily: "Arial, sans-serif",
				fontSize: 10,
				fill: colorNum,
				fontWeight: participant.isFollowed ? "bold" : "normal",
			});
			label.x = left + 2;
			label.y = top + 2;
			label.visible = true;

			// Add background for readability
			const labelBg = new Graphics();
			const labelWidth = label.width + 4;
			const labelHeight = label.height + 2;
			labelBg.rect(left, top, labelWidth, labelHeight);
			labelBg.fill({ color: 0x1a1a1a, alpha: 0.7 });

			this.participantViewportsContainer.addChild(labelBg);
			this.participantViewportsContainer.addChild(label);

			labelIndex++;
		}
	}

	/**
	 * Get or create a label from the pool
	 */
	private getOrCreateLabel(index: number): Text {
		const existing = this.labelPool[index];
		if (existing) {
			return existing;
		}
		const label = new Text({ text: "" });
		this.labelPool.push(label);
		return label;
	}

	/**
	 * Parse color string (hex or named) to number
	 */
	private parseColor(color: string): number {
		if (color.startsWith("#")) {
			return Number.parseInt(color.slice(1), 16);
		}
		// Default fallback
		return 0x888888;
	}

	/**
	 * Get render statistics
	 */
	getStats(): MinimapRenderStats {
		return { ...this.stats };
	}

	/**
	 * Resize the minimap canvas
	 */
	resize(width: number, height: number): void {
		if (!this.app || !this.canvas) return;

		// Update canvas element size
		this.canvas.width = width;
		this.canvas.height = height;

		// Resize PixiJS renderer
		this.app.renderer.resize(width, height);

		// Update stage hit area after resize
		this.app.stage.hitArea = this.app.screen;

		this.fitToView();

		// Re-render viewport outline if we have document bounds
		if (this.documentBounds && this.lastViewportBounds) {
			this.updateViewportOutline(this.lastViewportBounds);
		}
	}

	/**
	 * Destroy the renderer and clean up resources
	 */
	destroy(): void {
		if (this.app) {
			this.app.destroy(true, { children: true, texture: true });
			this.app = null;
		}
		this.mainContainer = null;
		this.viewportOutline = null;
		this.participantViewportsContainer = null;
		this.participantViewportBounds = [];
		this.labelPool = [];
		this.documentBounds = null;
		this.lastViewportBounds = null;
		this.isInitialized = false;
	}
}
