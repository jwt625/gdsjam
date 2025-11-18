/**
 * Pixi.js WebGL Renderer for GDSII layouts
 * Implements viewport culling, zoom/pan controls, and FPS monitoring
 */

import { Application, Container, Graphics, Text } from "pixi.js";
import type { Cell, GDSDocument, Polygon } from "../../types/gds";
import { SpatialIndex } from "../spatial/RTree";

export interface ViewportState {
	x: number;
	y: number;
	scale: number;
}

export class PixiRenderer {
	private app: Application;
	private mainContainer: Container;
	private spatialIndex: SpatialIndex;
	private fpsText: Text;
	private lastFrameTime: number;
	private frameCount: number;
	private fpsUpdateInterval: number;

	constructor() {
		// Initialize Pixi.js application
		this.app = new Application();
		this.mainContainer = new Container();
		this.spatialIndex = new SpatialIndex();
		this.lastFrameTime = performance.now();
		this.frameCount = 0;
		this.fpsUpdateInterval = 500; // Update FPS every 500ms

		// FPS counter text (top-right corner)
		this.fpsText = new Text({
			text: "FPS: 0",
			style: {
				fontFamily: "monospace",
				fontSize: 14,
				fill: 0x00ff00,
			},
		});
	}

	/**
	 * Initialize the renderer
	 */
	async init(canvas: HTMLCanvasElement): Promise<void> {
		const parentElement = canvas.parentElement;
		await this.app.init({
			canvas,
			background: 0x1a1a1a,
			resizeTo: parentElement ? parentElement : undefined,
			antialias: true,
			autoDensity: true,
			resolution: window.devicePixelRatio || 1,
		});

		this.app.stage.addChild(this.mainContainer);

		// Position FPS counter at top-right
		this.fpsText.x = this.app.screen.width - 80;
		this.fpsText.y = 10;
		this.app.stage.addChild(this.fpsText);

		// Start render loop
		this.app.ticker.add(this.onTick.bind(this));

		// Enable interactivity
		this.mainContainer.eventMode = "static";
		this.setupControls();
	}

	/**
	 * Render loop tick
	 */
	private onTick(): void {
		this.frameCount++;
		const now = performance.now();
		const elapsed = now - this.lastFrameTime;

		if (elapsed >= this.fpsUpdateInterval) {
			const fps = Math.round((this.frameCount * 1000) / elapsed);
			this.fpsText.text = `FPS: ${fps}`;
			this.frameCount = 0;
			this.lastFrameTime = now;
		}

		// Update FPS text position if window resized
		this.fpsText.x = this.app.screen.width - 80;
	}

	/**
	 * Setup zoom and pan controls
	 */
	private setupControls(): void {
		// Mouse wheel zoom
		this.app.canvas.addEventListener("wheel", (e) => {
			e.preventDefault();
			const delta = e.deltaY;
			const zoomFactor = delta > 0 ? 0.9 : 1.1;

			// Zoom to cursor position
			const mouseX = e.offsetX;
			const mouseY = e.offsetY;

			const worldPos = {
				x: (mouseX - this.mainContainer.x) / this.mainContainer.scale.x,
				y: (mouseY - this.mainContainer.y) / this.mainContainer.scale.y,
			};

			this.mainContainer.scale.x *= zoomFactor;
			this.mainContainer.scale.y *= zoomFactor;

			this.mainContainer.x = mouseX - worldPos.x * this.mainContainer.scale.x;
			this.mainContainer.y = mouseY - worldPos.y * this.mainContainer.scale.y;

			this.updateViewport();
		});

		// Pan with middle mouse or Space + drag
		let isPanning = false;
		let lastMouseX = 0;
		let lastMouseY = 0;
		let isSpacePressed = false;

		window.addEventListener("keydown", (e) => {
			if (e.code === "Space") {
				isSpacePressed = true;
				e.preventDefault();
			}
		});

		window.addEventListener("keyup", (e) => {
			if (e.code === "Space") {
				isSpacePressed = false;
			}
		});

		this.app.canvas.addEventListener("mousedown", (e) => {
			if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
				isPanning = true;
				lastMouseX = e.clientX;
				lastMouseY = e.clientY;
				e.preventDefault();
			}
		});

		window.addEventListener("mousemove", (e) => {
			if (isPanning) {
				const dx = e.clientX - lastMouseX;
				const dy = e.clientY - lastMouseY;

				this.mainContainer.x += dx;
				this.mainContainer.y += dy;

				lastMouseX = e.clientX;
				lastMouseY = e.clientY;

				this.updateViewport();
			}
		});

		window.addEventListener("mouseup", () => {
			isPanning = false;
		});
	}

	/**
	 * Update viewport (called after zoom/pan)
	 */
	private updateViewport(): void {
		// TODO: Implement viewport culling using spatial index
	}

	/**
	 * Render GDS document
	 */
	renderGDSDocument(document: GDSDocument): void {
		console.log("[PixiRenderer] renderGDSDocument called");
		console.log("[PixiRenderer] Document:", document);
		console.log("[PixiRenderer] Top cells:", document.topCells);

		this.clear();
		console.log("[PixiRenderer] Cleared previous content");

		// Render top cells (cells not referenced by others)
		let renderedCells = 0;
		for (const topCellName of document.topCells) {
			console.log("[PixiRenderer] Rendering top cell:", topCellName);
			const cell = document.cells.get(topCellName);
			if (cell) {
				console.log(
					"[PixiRenderer] Cell has",
					cell.polygons.length,
					"polygons and",
					cell.instances.length,
					"instances",
				);
				this.renderCell(cell, document, 0, 0, 0, false, 1);
				renderedCells++;
			} else {
				console.warn("[PixiRenderer] Top cell not found:", topCellName);
			}
		}

		console.log("[PixiRenderer] Rendered", renderedCells, "top cells");
		console.log("[PixiRenderer] Main container children:", this.mainContainer.children.length);

		this.fitToView();
		console.log("[PixiRenderer] Fit to view complete");
	}

	/**
	 * Render a cell with transformations
	 */
	private renderCell(
		cell: Cell,
		document: GDSDocument,
		x: number,
		y: number,
		rotation: number,
		mirror: boolean,
		magnification: number,
	): void {
		console.log(
			"[PixiRenderer] renderCell:",
			cell.name,
			"at",
			x,
			y,
			"polygons:",
			cell.polygons.length,
		);

		// Create container for this cell
		const cellContainer = new Container();
		cellContainer.x = x;
		cellContainer.y = y;
		cellContainer.rotation = (rotation * Math.PI) / 180; // Convert to radians
		cellContainer.scale.x = magnification * (mirror ? -1 : 1);
		cellContainer.scale.y = magnification;

		// Render polygons
		let renderedPolygons = 0;
		for (const polygon of cell.polygons) {
			const layer = document.layers.get(`${polygon.layer}:${polygon.datatype}`);
			if (!layer || !layer.visible) continue;

			const graphics = this.renderPolygon(polygon, layer.color);
			cellContainer.addChild(graphics);
			renderedPolygons++;

			// Add to spatial index (with transformations applied)
			this.spatialIndex.insert({
				minX: polygon.boundingBox.minX + x,
				minY: polygon.boundingBox.minY + y,
				maxX: polygon.boundingBox.maxX + x,
				maxY: polygon.boundingBox.maxY + y,
				id: polygon.id,
				type: "polygon",
				data: graphics,
			});
		}
		console.log("[PixiRenderer] Rendered", renderedPolygons, "polygons for cell", cell.name);

		// Render instances (recursive)
		for (const instance of cell.instances) {
			const refCell = document.cells.get(instance.cellRef);
			if (refCell) {
				this.renderCell(
					refCell,
					document,
					instance.x,
					instance.y,
					instance.rotation,
					instance.mirror,
					instance.magnification,
				);
			}
		}

		this.mainContainer.addChild(cellContainer);
	}

	/**
	 * Render a single polygon
	 */
	private renderPolygon(polygon: Polygon, colorHex: string): Graphics {
		const graphics = new Graphics();

		// Convert hex color to number
		const color = Number.parseInt(colorHex.replace("#", ""), 16);

		// Draw polygon
		if (polygon.points.length > 0) {
			graphics.moveTo(polygon.points[0].x, polygon.points[0].y);
			for (let i = 1; i < polygon.points.length; i++) {
				graphics.lineTo(polygon.points[i].x, polygon.points[i].y);
			}
			graphics.closePath();
			graphics.fill({ color, alpha: 0.7 });
			graphics.stroke({ color, width: 0.5, alpha: 0.9 });
		}

		return graphics;
	}

	/**
	 * Render test geometry (for prototyping)
	 */
	renderTestGeometry(count: number): void {
		this.clear();

		const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];

		for (let i = 0; i < count; i++) {
			const graphics = new Graphics();
			const color = colors[i % colors.length];

			// Random rectangle
			const x = Math.random() * 1000 - 500;
			const y = Math.random() * 1000 - 500;
			const width = Math.random() * 50 + 10;
			const height = Math.random() * 50 + 10;

			graphics.rect(x, y, width, height);
			graphics.fill(color);
			graphics.alpha = 0.7;

			this.mainContainer.addChild(graphics);

			// Add to spatial index
			this.spatialIndex.insert({
				minX: x,
				minY: y,
				maxX: x + width,
				maxY: y + height,
				id: `rect-${i}`,
				type: "polygon",
				data: graphics,
			});
		}

		this.fitToView();
	}

	/**
	 * Fit viewport to show all geometry
	 */
	fitToView(): void {
		const bounds = this.mainContainer.getBounds();

		if (bounds.width === 0 || bounds.height === 0) {
			return;
		}

		const scaleX = this.app.screen.width / bounds.width;
		const scaleY = this.app.screen.height / bounds.height;
		const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to add padding

		this.mainContainer.scale.set(scale);
		this.mainContainer.x = (this.app.screen.width - bounds.width * scale) / 2 - bounds.x * scale;
		this.mainContainer.y = (this.app.screen.height - bounds.height * scale) / 2 - bounds.y * scale;

		this.updateViewport();
	}

	/**
	 * Clear all rendered geometry
	 */
	clear(): void {
		this.mainContainer.removeChildren();
		this.spatialIndex.clear();
	}

	/**
	 * Get current viewport state
	 */
	getViewportState(): ViewportState {
		return {
			x: this.mainContainer.x,
			y: this.mainContainer.y,
			scale: this.mainContainer.scale.x,
		};
	}

	/**
	 * Set viewport state
	 */
	setViewportState(state: ViewportState): void {
		this.mainContainer.x = state.x;
		this.mainContainer.y = state.y;
		this.mainContainer.scale.set(state.scale);
		this.updateViewport();
	}

	/**
	 * Destroy the renderer
	 */
	destroy(): void {
		this.app.destroy(true, { children: true, texture: true });
	}

	/**
	 * Resize the renderer
	 */
	resize(width: number, height: number): void {
		this.app.renderer.resize(width, height);
		this.fpsText.x = width - 80;
	}
}
