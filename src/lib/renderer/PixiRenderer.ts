/**
 * Pixi.js WebGL Renderer for GDSII layouts
 * Implements viewport culling, zoom/pan controls, and FPS monitoring
 */

import { Application, Container, Graphics, Text } from "pixi.js";
import type { BoundingBox, Cell, GDSDocument, Polygon } from "../../types/gds";
import {
	DEBUG,
	FPS_UPDATE_INTERVAL,
	MAX_POLYGONS_PER_RENDER,
	POLYGON_FILL_MODE,
	SPATIAL_TILE_SIZE,
} from "../config";
import { type RTreeItem, SpatialIndex } from "../spatial/RTree";
import { InputController } from "./controls/InputController";
import { LODManager } from "./lod/LODManager";
import { ZoomLimits } from "./lod/ZoomLimits";
import { CoordinatesDisplay } from "./overlays/CoordinatesDisplay";
import { FPSCounter } from "./overlays/FPSCounter";
import { GridOverlay } from "./overlays/GridOverlay";
import { ScaleBarOverlay } from "./overlays/ScaleBarOverlay";

export interface ViewportState {
	x: number;
	y: number;
	scale: number;
}

export type RenderProgressCallback = (progress: number, message: string) => void;

export class PixiRenderer {
	private app: Application;
	private mainContainer: Container;
	private gridContainer: Container;
	private spatialIndex: SpatialIndex;
	private fpsText: Text;
	private scaleBarContainer: Container;
	private coordsText: Text;
	private allGraphicsItems: RTreeItem[] = [];
	private isInitialized = false;
	private maxPolygonsPerRender = MAX_POLYGONS_PER_RENDER;
	private currentRenderDepth = 0;
	private fillPolygons = POLYGON_FILL_MODE;
	private documentUnits = { database: 1e-9, user: 1e-6 };
	private viewportUpdateTimeout: number | null = null;
	private gridUpdateTimeout: number | null = null;
	private scaleBarUpdateTimeout: number | null = null;
	private currentDocument: GDSDocument | null = null;

	// LOD metrics tracking
	private visiblePolygonCount = 0;
	private totalRenderedPolygons = 0;
	private layerVisibility: Map<string, boolean> = new Map();
	private isRerendering = false;
	private cellRenderCounts: Map<string, number> = new Map();

	// LOD Manager
	private lodManager!: LODManager;
	private zoomLimits!: ZoomLimits;

	// UI Overlays
	private fpsCounter!: FPSCounter;
	private coordinatesDisplay!: CoordinatesDisplay;
	private gridOverlay!: GridOverlay;
	private scaleBarOverlay!: ScaleBarOverlay;

	// Input Controllers
	private inputController!: InputController;

	constructor() {
		this.app = new Application();
		this.mainContainer = new Container();
		this.gridContainer = new Container();
		this.scaleBarContainer = new Container();
		this.spatialIndex = new SpatialIndex();

		this.fpsText = new Text({
			text: "FPS: 0",
			style: {
				fontFamily: "monospace",
				fontSize: 14,
				fill: 0x00ff00,
			},
		});

		this.coordsText = new Text({
			text: "X: 0.00 µm, Y: 0.00 µm",
			style: {
				fontFamily: "monospace",
				fontSize: 12,
				fill: 0xcccccc,
			},
		});
	}

	/**
	 * Initialize the renderer
	 */
	async init(canvas: HTMLCanvasElement): Promise<void> {
		const parentElement = canvas.parentElement;
		// biome-ignore lint/suspicious/noExplicitAny: Pixi.js Application init options are complex
		const initOptions: any = {
			canvas,
			background: 0x1a1a1a,
			antialias: true,
			autoDensity: true,
			resolution: window.devicePixelRatio || 1,
		};

		if (parentElement) {
			initOptions.resizeTo = parentElement;
		}

		await this.app.init(initOptions);

		// Add containers in order: grid, main content, UI overlays
		this.app.stage.addChild(this.gridContainer);
		this.app.stage.addChild(this.mainContainer);

		// Flip Y-axis to match GDSII coordinate system
		this.mainContainer.scale.y = -1;
		this.gridContainer.scale.y = -1;

		// Add UI overlays
		this.fpsText.x = this.app.screen.width - 80;
		this.fpsText.y = 10;
		this.app.stage.addChild(this.fpsText);
		this.app.stage.addChild(this.scaleBarContainer);

		this.coordsText.x = this.app.screen.width - 200;
		this.coordsText.y = this.app.screen.height - 30;
		this.app.stage.addChild(this.coordsText);

		// Initialize overlay modules
		this.fpsCounter = new FPSCounter(this.fpsText, FPS_UPDATE_INTERVAL);
		this.coordinatesDisplay = new CoordinatesDisplay(this.coordsText);
		this.gridOverlay = new GridOverlay(this.gridContainer, this.app);
		this.scaleBarOverlay = new ScaleBarOverlay(this.scaleBarContainer, this.app);

		this.app.ticker.add(this.onTick.bind(this));
		this.mainContainer.eventMode = "static";

		this.isInitialized = true;

		// Initialize LOD managers
		this.zoomLimits = new ZoomLimits();
		this.lodManager = new LODManager(this.maxPolygonsPerRender, {
			onDepthChange: (newDepth: number) => {
				this.currentRenderDepth = newDepth;
				this.lodManager.updateZoomThresholds(Math.abs(this.mainContainer.scale.x));
				if (this.currentDocument) {
					this.performIncrementalRerender();
				}
			},
			getBudgetUtilization: () => {
				const scaledBudget = this.lodManager.getScaledBudget();
				return this.visiblePolygonCount / scaledBudget;
			},
		});

		// Initialize input controllers
		this.inputController = new InputController(this.app.canvas, {
			onZoom: this.handleZoom.bind(this),
			onPan: this.handlePan.bind(this),
			onFitToView: this.fitToView.bind(this),
			onToggleGrid: this.toggleGrid.bind(this),
			onCoordinatesUpdate: this.handleCoordinatesUpdate.bind(this),
			getScreenCenter: () => ({
				x: this.app.screen.width / 2,
				y: this.app.screen.height / 2,
			}),
		});

		this.performGridUpdate();
		this.performScaleBarUpdate();

		// Listen for layer visibility changes
		window.addEventListener(
			"layer-visibility-changed",
			this.handleLayerVisibilityChange.bind(this),
		);
	}

	/**
	 * Render loop tick
	 */
	private onTick(): void {
		// Update FPS counter
		this.fpsCounter.onTick();

		// Update overlay positions if window resized
		this.fpsCounter.updatePosition(this.app.screen.width);
		this.coordinatesDisplay.updatePosition(this.app.screen.width, this.app.screen.height);
	}

	/**
	 * Handle zoom from input controllers
	 */
	private handleZoom(
		zoomFactor: number,
		centerX: number,
		centerY: number,
		_worldPosX: number,
		_worldPosY: number,
	): void {
		// Calculate world position at zoom center
		const worldPos = {
			x: (centerX - this.mainContainer.x) / this.mainContainer.scale.x,
			y: (centerY - this.mainContainer.y) / this.mainContainer.scale.y,
		};

		// Calculate new scale and clamp to limits
		const currentYSign = Math.sign(this.mainContainer.scale.y);
		const newScaleX = this.mainContainer.scale.x * zoomFactor;
		const viewportBounds = this.getViewportBounds();
		const clampedScaleX = this.zoomLimits.clampZoomScale(
			newScaleX,
			viewportBounds,
			this.mainContainer.scale.x,
			this.documentUnits,
		);

		// Apply clamped scale
		this.mainContainer.scale.x = clampedScaleX;
		this.mainContainer.scale.y = Math.abs(clampedScaleX) * currentYSign;

		// Adjust position to zoom toward center point
		this.mainContainer.x = centerX - worldPos.x * this.mainContainer.scale.x;
		this.mainContainer.y = centerY - worldPos.y * this.mainContainer.scale.y;

		this.updateViewport();
		this.updateGrid();
		this.updateScaleBar();
	}

	/**
	 * Handle pan from input controllers
	 */
	private handlePan(dx: number, dy: number): void {
		this.mainContainer.x += dx;
		this.mainContainer.y += dy;

		this.updateViewport();
		this.updateGrid();
		this.updateScaleBar();
	}

	/**
	 * Handle coordinates update from input controllers
	 */
	private handleCoordinatesUpdate(mouseX: number, mouseY: number): void {
		this.coordinatesDisplay.update(
			mouseX,
			mouseY,
			this.mainContainer.x,
			this.mainContainer.y,
			this.mainContainer.scale.x,
			this.documentUnits,
		);
	}

	/**
	 * Update viewport (called after zoom/pan)
	 * Implements viewport culling - only shows polygons visible in current viewport
	 * Debounced to prevent performance issues during continuous panning
	 */
	private updateViewport(): void {
		// Clear any pending viewport update
		if (this.viewportUpdateTimeout !== null) {
			clearTimeout(this.viewportUpdateTimeout);
		}

		// Debounce viewport culling updates - only update after 100ms of no movement
		this.viewportUpdateTimeout = window.setTimeout(() => {
			this.performViewportUpdate();
			this.viewportUpdateTimeout = null;
		}, 100);
	}

	/**
	 * Perform the actual viewport culling update
	 */
	private performViewportUpdate(): void {
		if (this.allGraphicsItems.length === 0) {
			if (DEBUG) {
				console.log("[PixiRenderer] performViewportUpdate: No graphics items");
			}
			return;
		}

		const viewportBounds = this.getViewportBounds();
		const visibleItems = this.spatialIndex.query(viewportBounds);
		const visibleIds = new Set(visibleItems.map((item) => item.id));

		const currentZoom = Math.abs(this.mainContainer.scale.x);

		// Update visibility of all graphics items (combine viewport + layer visibility)
		let visiblePolygonCount = 0;
		let hiddenByLayerCount = 0;
		let visibleByLayerCount = 0;
		const layerCounts = new Map<string, { total: number; visible: number }>();

		for (const item of this.allGraphicsItems) {
			const graphics = item.data as Graphics;
			const inViewport = visibleIds.has(item.id);

			// Check layer visibility
			const layerKey = `${item.layer}:${item.datatype}`;
			const layerVisible = this.layerVisibility.get(layerKey) ?? true;

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

		if (DEBUG) {
			console.log(
				`[PixiRenderer] performViewportUpdate: ${this.allGraphicsItems.length} total items, ${visibleIds.size} in viewport, ${visibleByLayerCount} visible by layer, ${hiddenByLayerCount} hidden by layer`,
			);
			console.log(
				`[PixiRenderer] Layer breakdown:`,
				Array.from(layerCounts.entries())
					.map(([key, counts]) => `${key}: ${counts.visible}/${counts.total}`)
					.join(", "),
			);
		}

		// Update cached visible polygon count for performance metrics
		this.visiblePolygonCount = visiblePolygonCount;

		// Check if zoom has changed significantly and trigger LOD update
		this.lodManager.checkAndTriggerRerender(currentZoom, this.isRerendering);
	}

	/**
	 * Handle layer visibility change events from LayerPanel
	 */
	private handleLayerVisibilityChange(e: Event): void {
		const customEvent = e as CustomEvent;
		this.updateLayerVisibility(customEvent.detail.visibility);
	}

	/**
	 * Update layer visibility and update viewport to show/hide layers
	 */
	private updateLayerVisibility(visibility: { [key: string]: boolean }): void {
		if (DEBUG) {
			console.log("[PixiRenderer] Updating layer visibility", visibility);
		}

		// Detect newly visible layers that need to be rendered
		const newlyVisibleLayers: string[] = [];
		for (const [key, visible] of Object.entries(visibility)) {
			const wasVisible = this.layerVisibility.get(key) ?? true;
			if (visible && !wasVisible) {
				// Check if this layer has any rendered graphics
				const hasGraphics = this.allGraphicsItems.some(
					(item) => `${item.layer}:${item.datatype}` === key,
				);
				if (!hasGraphics) {
					newlyVisibleLayers.push(key);
				}
			}
		}

		// Update internal visibility map
		this.layerVisibility.clear();
		for (const [key, visible] of Object.entries(visibility)) {
			this.layerVisibility.set(key, visible);
		}

		if (DEBUG) {
			console.log("[PixiRenderer] Internal layerVisibility map updated:", this.layerVisibility);
		}

		// If there are newly visible layers that haven't been rendered, render them
		if (newlyVisibleLayers.length > 0) {
			if (DEBUG) {
				console.log("[PixiRenderer] Rendering newly visible layers:", newlyVisibleLayers);
			}
			this.renderLayers(newlyVisibleLayers);
		} else {
			// Update graphics visibility (combines layer visibility + viewport culling)
			// This will immediately show/hide the already-rendered graphics without re-rendering
			this.performViewportUpdate();
		}
	}

	/**
	 * Render specific layers on-demand (when they're toggled visible)
	 */
	private async renderLayers(layerKeys: string[]): Promise<void> {
		if (!this.currentDocument) {
			console.warn("[PixiRenderer] No document to render layers from");
			return;
		}

		if (DEBUG) {
			console.log(`[PixiRenderer] Rendering ${layerKeys.length} layers on-demand`);
		}

		// Temporarily enable these layers in the document
		const originalVisibility = new Map<string, boolean>();
		for (const key of layerKeys) {
			const layer = this.currentDocument.layers.get(key);
			if (layer) {
				originalVisibility.set(key, layer.visible);
				layer.visible = true;
			}
		}

		// Trigger incremental re-render to include the newly visible layers
		await this.performIncrementalRerender();

		// Restore original visibility (the layerVisibility map will control actual visibility)
		for (const [key, visible] of originalVisibility) {
			const layer = this.currentDocument.layers.get(key);
			if (layer) {
				layer.visible = visible;
			}
		}
	}

	/**
	 * Perform incremental re-render (clear geometry and re-render with new LOD depth)
	 */
	private async performIncrementalRerender(): Promise<void> {
		if (!this.currentDocument) {
			console.warn("[LOD] No document to re-render");
			return;
		}

		// Set flag to prevent re-render loops
		this.isRerendering = true;

		if (DEBUG) {
			console.log(`[LOD] Starting re-render at depth ${this.currentRenderDepth}`);
		}

		// Save viewport state and current scale for stroke width calculation
		const viewportState = this.getViewportState();
		const savedScale = this.mainContainer.scale.x;

		// Save old graphics to keep them visible during re-rendering
		const oldGraphicsItems = this.allGraphicsItems;
		const oldMainContainer = this.mainContainer;

		// Create new container for new render
		this.mainContainer = new Container();
		this.mainContainer.y = this.app.canvas.height;
		this.mainContainer.scale.y = -1;
		this.allGraphicsItems = [];
		this.spatialIndex.clear();

		// Re-render with new depth (skip fitToView to preserve zoom)
		// Pass the saved scale so stroke widths are calculated correctly
		await this.renderGDSDocument(this.currentDocument, undefined, true, savedScale);

		// Restore viewport state to new container
		this.setViewportState(viewportState);

		// Update zoom thresholds based on current zoom
		this.lodManager.updateZoomThresholds(Math.abs(this.mainContainer.scale.x));

		// Swap containers: remove old, add new at correct z-index
		// Z-order: gridContainer (0), mainContainer (1), UI overlays (2+)
		this.app.stage.removeChild(oldMainContainer);
		this.app.stage.addChildAt(this.mainContainer, 1);

		// Destroy old graphics
		for (const item of oldGraphicsItems) {
			const graphics = item.data as Graphics;
			graphics.destroy();
		}
		oldMainContainer.destroy();

		if (DEBUG) {
			console.log(
				`[LOD] Re-render complete: ${this.totalRenderedPolygons.toLocaleString()} polygons in ${this.allGraphicsItems.length} tiles`,
			);
		}

		// Apply layer visibility to newly created graphics
		this.performViewportUpdate();

		// Clear flag
		this.isRerendering = false;
	}

	/**
	 * Get current viewport bounds in world coordinates
	 */
	private getViewportBounds(): BoundingBox {
		const scale = this.mainContainer.scale.x;
		const scaleY = this.mainContainer.scale.y;
		const x = -this.mainContainer.x / scale;
		const y = -this.mainContainer.y / scaleY;
		const width = this.app.screen.width / scale;
		const height = this.app.screen.height / Math.abs(scaleY);

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
	 * Update grid overlay (debounced)
	 */
	private updateGrid(): void {
		// Clear any pending grid update
		if (this.gridUpdateTimeout !== null) {
			clearTimeout(this.gridUpdateTimeout);
		}

		// Debounce grid updates - only update after 50ms of no movement
		this.gridUpdateTimeout = window.setTimeout(() => {
			this.performGridUpdate();
			this.gridUpdateTimeout = null;
		}, 50);
	}

	/**
	 * Perform the actual grid update
	 */
	private performGridUpdate(): void {
		const bounds = this.getViewportBounds();
		const scale = this.mainContainer.scale.x;

		this.gridOverlay.update(bounds, scale, this.gridOverlay.isVisible());
		this.gridOverlay.updateTransform(
			this.mainContainer.x,
			this.mainContainer.y,
			this.mainContainer.scale.x,
			this.mainContainer.scale.y,
		);
	}

	/**
	 * Update scale bar (debounced)
	 */
	private updateScaleBar(): void {
		// Clear any pending scale bar update
		if (this.scaleBarUpdateTimeout !== null) {
			clearTimeout(this.scaleBarUpdateTimeout);
		}

		// Debounce scale bar updates - only update after 50ms of no movement
		this.scaleBarUpdateTimeout = window.setTimeout(() => {
			this.performScaleBarUpdate();
			this.scaleBarUpdateTimeout = null;
		}, 50);
	}

	/**
	 * Perform the actual scale bar update
	 */
	private performScaleBarUpdate(): void {
		const bounds = this.getViewportBounds();
		const scale = this.mainContainer.scale.x;

		this.scaleBarOverlay.update(bounds, scale, this.documentUnits);
	}

	/**
	 * Toggle grid visibility
	 */
	toggleGrid(): void {
		this.gridOverlay.toggleVisibility();
		this.performGridUpdate();
	}

	/**
	 * Toggle polygon fill mode (filled vs outline only)
	 */
	toggleFill(): void {
		this.fillPolygons = !this.fillPolygons;
		if (DEBUG) {
			console.log(`[Renderer] Polygon fill mode: ${this.fillPolygons ? "filled" : "outline only"}`);
			console.log(`[Renderer] Current scale: ${this.mainContainer.scale.x}`);
		}

		// Trigger re-render to apply the new fill mode
		if (this.currentDocument) {
			this.performIncrementalRerender();
		}
	}

	/**
	 * Render GDS document with LOD (Level of Detail) to prevent OOM
	 * @param overrideScale - Optional scale to use for stroke width calculation (used during re-renders)
	 */
	async renderGDSDocument(
		document: GDSDocument,
		onProgress?: RenderProgressCallback,
		skipFitToView = false,
		overrideScale?: number,
	): Promise<void> {
		// Store document for incremental re-rendering
		this.currentDocument = document;
		this.documentUnits = document.units;

		onProgress?.(0, "Preparing to render...");
		await new Promise((resolve) => setTimeout(resolve, 0));
		this.clear();

		const startTime = performance.now();
		// Only reset depth to 0 on initial render, not on incremental re-renders
		if (!this.isRerendering) {
			this.currentRenderDepth = 0;
		}

		// Get scaled budget from LOD manager
		const scaledBudget = this.lodManager.getScaledBudget();

		if (DEBUG) {
			console.log(
				`[Render] Starting render: depth=${this.currentRenderDepth}, budget=${scaledBudget.toLocaleString()}`,
			);
		}

		// Reset cell render tracking
		this.cellRenderCounts.clear();

		// Log top cell structure for debugging
		if (DEBUG) {
			for (const topCellName of document.topCells) {
				const cell = document.cells.get(topCellName);
				if (cell) {
					console.log(
						`[Render] Top cell "${topCellName}": ${cell.polygons.length.toLocaleString()} polygons, ${cell.instances.length.toLocaleString()} instances`,
					);
				}
			}
		}

		let totalPolygons = 0;
		let polygonBudget = scaledBudget;

		// Calculate total polygons for progress tracking
		let totalPolygonCount = 0;
		for (const topCellName of document.topCells) {
			const cell = document.cells.get(topCellName);
			if (cell) {
				totalPolygonCount += cell.polygons.length;
			}
		}

		const topCellCount = document.topCells.length;
		let processedPolygons = 0;

		for (let i = 0; i < topCellCount; i++) {
			const topCellName = document.topCells[i];
			if (!topCellName) continue;
			const cell = document.cells.get(topCellName);

			if (cell) {
				// More granular progress based on polygon count
				const baseProgress = Math.floor((processedPolygons / totalPolygonCount) * 80);
				const message = `Rendering ${topCellName} (${cell.polygons.length} polygons)...`;
				onProgress?.(baseProgress, message);
				await new Promise((resolve) => setTimeout(resolve, 0));

				const rendered = await this.renderCellGeometry(
					cell,
					document,
					0,
					0,
					0,
					false,
					1,
					this.currentRenderDepth,
					polygonBudget,
					(cellProgress, cellMessage) => {
						// Calculate overall progress: base progress + cell progress contribution
						const cellContribution = (cell.polygons.length / totalPolygonCount) * 80;
						const overallProgress =
							baseProgress + Math.floor((cellProgress / 100) * cellContribution);
						onProgress?.(overallProgress, cellMessage);
					},
					overrideScale,
				);
				totalPolygons += rendered;
				polygonBudget -= rendered;
				processedPolygons += cell.polygons.length;

				// Update progress after rendering this cell
				const afterProgress = Math.floor((processedPolygons / totalPolygonCount) * 80);
				const afterMessage = `Rendered ${topCellName}`;
				onProgress?.(afterProgress, afterMessage);
				await new Promise((resolve) => setTimeout(resolve, 0));

				if (polygonBudget <= 0) {
					console.warn(
						`[Render] Budget exhausted (${this.maxPolygonsPerRender.toLocaleString()}), stopping render`,
					);
					break;
				}
			}
		}

		// Store total rendered polygons for metrics
		this.totalRenderedPolygons = totalPolygons;

		const renderTime = performance.now() - startTime;
		if (DEBUG) {
			console.log(
				`[Render] Complete: ${totalPolygons.toLocaleString()} polygons in ${renderTime.toFixed(0)}ms (${this.allGraphicsItems.length} tiles, depth=${this.currentRenderDepth})`,
			);

			// Log cell render statistics to detect instance explosion
			const topCells = Array.from(this.cellRenderCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10);
			if (topCells.length > 0) {
				console.log("[Render] Top 10 most rendered cells:");
				for (const [cellName, count] of topCells) {
					console.log(`  ${cellName}: ${count} times`);
				}
			}
		}

		if (!skipFitToView) {
			onProgress?.(90, "Fitting to view...");
			await new Promise((resolve) => setTimeout(resolve, 0));
			this.fitToView();
			// Initialize zoom thresholds after fitToView
			this.lodManager.updateZoomThresholds(this.mainContainer.scale.x);
		}
		this.updateViewport();

		onProgress?.(100, "Render complete!");
	}

	/**
	 * Render cell geometry with transformations (batched by layer)
	 * Returns number of polygons rendered (including instances)
	 *
	 * @param maxDepth - Maximum hierarchy depth to render (0 = only this cell's polygons)
	 * @param polygonBudget - Maximum polygons to render (stops early if exceeded)
	 * @param onProgress - Optional progress callback for large cells
	 * @param overrideScale - Optional scale to use for stroke width calculation (used during re-renders)
	 */
	private async renderCellGeometry(
		cell: Cell,
		document: GDSDocument,
		x: number,
		y: number,
		rotation: number,
		mirror: boolean,
		magnification: number,
		maxDepth: number,
		polygonBudget: number,
		onProgress?: (progress: number, message: string) => void,
		overrideScale?: number,
	): Promise<number> {
		// Track how many times each cell is rendered (for debugging instance explosion)
		const currentCount = this.cellRenderCounts.get(cell.name) || 0;
		this.cellRenderCounts.set(cell.name, currentCount + 1);

		// Stop if budget exhausted
		if (polygonBudget <= 0) {
			return 0;
		}

		// Create container for this cell
		const cellContainer = new Container();
		cellContainer.x = x;
		cellContainer.y = y;
		cellContainer.rotation = (rotation * Math.PI) / 180;
		cellContainer.scale.x = magnification * (mirror ? -1 : 1);
		cellContainer.scale.y = magnification;

		// Calculate stroke width in world coordinates that will appear constant on screen
		// The polygon graphics are children of mainContainer, so they inherit its scale
		// To get N screen pixels: strokeWidthDB * mainContainer.scale.x = N
		// Therefore: strokeWidthDB = N / mainContainer.scale.x
		// Use overrideScale if provided (during re-renders), otherwise use current scale
		const currentScale = overrideScale ?? this.mainContainer.scale.x;
		const desiredScreenPixels = 2.0;
		let strokeWidthDB = desiredScreenPixels / currentScale;

		// Clamp stroke width to prevent it from becoming too small at high zoom levels
		// Pixi.js has trouble rendering strokes smaller than ~0.1 units
		// At very high zoom (e.g., 100nm scale bar), strokeWidthDB might be < 0.01
		const minStrokeWidthDB = 0.1;
		if (strokeWidthDB < minStrokeWidthDB) {
			strokeWidthDB = minStrokeWidthDB;
		}

		if (DEBUG) {
			console.log(
				`[Render] Cell ${cell.name}: strokeWidthDB=${strokeWidthDB.toExponential(2)} DB units, scale=${currentScale.toExponential(3)}, expected screen pixels=${desiredScreenPixels}`,
			);
		}

		// Batch polygons by layer AND spatial tile for efficient rendering and culling
		// Tile key format: "layer:datatype:tileX:tileY"
		const tileGraphics = new Map<string, Graphics>();
		const tileBounds = new Map<string, BoundingBox>();
		const tilePolygonCounts = new Map<string, number>();

		// Reserve budget for instances when maxDepth > 0
		// At depth 0: Use 100% budget for direct polygons (no instances rendered)
		// At depth 1+: Use 70% budget for direct polygons, reserve 30% for instances
		// More conservative to prevent OOM from deep hierarchies
		let directPolygonBudget = polygonBudget;
		if (maxDepth > 0) {
			directPolygonBudget = Math.floor(polygonBudget * 0.7);
			if (DEBUG) {
				console.log(
					`[Render] Cell ${cell.name}: Reserving budget for instances (${directPolygonBudget.toLocaleString()} for direct polygons, ${(polygonBudget - directPolygonBudget).toLocaleString()} for instances)`,
				);
			}
		}

		let renderedPolygons = 0;
		const totalPolygonsInCell = cell.polygons.length;
		const yieldInterval = 10000; // Yield every 10k polygons for UI updates

		for (let i = 0; i < totalPolygonsInCell; i++) {
			// Check budget before rendering each polygon
			if (renderedPolygons >= directPolygonBudget) {
				if (DEBUG) {
					console.log(
						`[Render] Cell ${cell.name}: Direct polygon budget exhausted (${renderedPolygons.toLocaleString()}/${totalPolygonsInCell.toLocaleString()} rendered)`,
					);
				}
				break;
			}

			const polygon = cell.polygons[i];
			if (!polygon) continue;
			const layerKey = `${polygon.layer}:${polygon.datatype}`;
			const layer = document.layers.get(layerKey);
			if (!layer || !layer.visible) continue;

			// Calculate which tile this polygon belongs to (based on its center)
			const centerX = (polygon.boundingBox.minX + polygon.boundingBox.maxX) / 2;
			const centerY = (polygon.boundingBox.minY + polygon.boundingBox.maxY) / 2;
			const tileX = Math.floor(centerX / SPATIAL_TILE_SIZE);
			const tileY = Math.floor(centerY / SPATIAL_TILE_SIZE);
			const tileKey = `${layerKey}:${tileX}:${tileY}`;

			// Get or create Graphics object for this tile
			let graphics = tileGraphics.get(tileKey);
			if (!graphics) {
				graphics = new Graphics();
				tileGraphics.set(tileKey, graphics);
				cellContainer.addChild(graphics);

				// Initialize bounds for this tile
				tileBounds.set(tileKey, {
					minX: Number.POSITIVE_INFINITY,
					minY: Number.POSITIVE_INFINITY,
					maxX: Number.NEGATIVE_INFINITY,
					maxY: Number.NEGATIVE_INFINITY,
				});

				// Initialize polygon count for this tile
				tilePolygonCounts.set(tileKey, 0);
			}

			// Add polygon to batched graphics
			this.addPolygonToGraphics(graphics, polygon, layer.color, strokeWidthDB);
			renderedPolygons++;

			// Increment polygon count for this tile
			const currentCount = tilePolygonCounts.get(tileKey) || 0;
			tilePolygonCounts.set(tileKey, currentCount + 1);

			// Update tile bounds (avoid calling getBounds() which is expensive)
			// biome-ignore lint/style/noNonNullAssertion: Bounds initialized earlier in loop
			const bounds = tileBounds.get(tileKey)!;
			bounds.minX = Math.min(bounds.minX, polygon.boundingBox.minX);
			bounds.minY = Math.min(bounds.minY, polygon.boundingBox.minY);
			bounds.maxX = Math.max(bounds.maxX, polygon.boundingBox.maxX);
			bounds.maxY = Math.max(bounds.maxY, polygon.boundingBox.maxY);

			// Yield to browser every N polygons for progress updates
			if (onProgress && i > 0 && i % yieldInterval === 0) {
				const progress = Math.floor((i / totalPolygonsInCell) * 100);
				onProgress(progress, `Processing ${cell.name}: ${i}/${totalPolygonsInCell} polygons`);
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		}

		// Add Graphics objects to spatial index (one per tile)
		// DON'T call graphics.getBounds() - it's too expensive for large files
		for (const [tileKey, graphics] of tileGraphics) {
			// biome-ignore lint/style/noNonNullAssertion: Bounds exist for all tiles in map
			const bounds = tileBounds.get(tileKey)!;
			// Parse layer and datatype from tileKey (format: "layer:datatype:tileX:tileY")
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
			this.allGraphicsItems.push(item);
		}

		// Render instances (recursive) only if we have depth budget
		let totalPolygons = renderedPolygons;
		let remainingBudget = polygonBudget - renderedPolygons;

		if (maxDepth > 0 && remainingBudget > 0) {
			if (DEBUG) {
				console.log(
					`[Render] Cell ${cell.name}: Rendering ${cell.instances.length} instances at depth ${maxDepth}`,
				);
			}

			for (const instance of cell.instances) {
				if (remainingBudget <= 0) break;

				const refCell = document.cells.get(instance.cellRef);
				if (refCell) {
					const rendered = await this.renderCellGeometry(
						refCell,
						document,
						x + instance.x,
						y + instance.y,
						rotation + instance.rotation,
						mirror !== instance.mirror,
						magnification * instance.magnification,
						maxDepth - 1, // Decrease depth for child instances
						remainingBudget,
						onProgress, // Pass through progress callback
						overrideScale, // Pass through override scale
					);
					totalPolygons += rendered;
					remainingBudget -= rendered;
				}
			}

			if (DEBUG) {
				console.log(
					`[Render] Cell ${cell.name}: Rendered ${totalPolygons - renderedPolygons} polygons from instances`,
				);
			}
		}

		this.mainContainer.addChild(cellContainer);
		return totalPolygons;
	}

	/**
	 * Add a polygon to an existing Graphics object (for batched rendering)
	 * @param strokeWidthDB - Stroke width in database units for outline mode (calculated once per render pass)
	 */
	private addPolygonToGraphics(
		graphics: Graphics,
		polygon: Polygon,
		colorHex: string,
		strokeWidthDB: number,
	): void {
		// Convert hex color to number
		let color = Number.parseInt(colorHex.replace("#", ""), 16);

		// Validate color and use default if invalid
		if (Number.isNaN(color)) {
			console.warn(`[PixiRenderer] Invalid color: "${colorHex}", using default blue`);
			color = 0x4a9eff; // Default blue
		}

		// Draw polygon
		if (polygon.points.length > 0 && polygon.points[0]) {
			// Build the polygon path
			graphics.moveTo(polygon.points[0].x, polygon.points[0].y);
			for (let i = 1; i < polygon.points.length; i++) {
				const point = polygon.points[i];
				if (point) {
					graphics.lineTo(point.x, point.y);
				}
			}
			graphics.closePath();

			// Apply fill and/or stroke based on mode
			if (this.fillPolygons) {
				// Filled mode: fill only, no stroke
				graphics.fill({ color, alpha: 0.7 });
			} else {
				// Outline only mode: no fill, thicker stroke
				graphics.stroke({ color, width: strokeWidthDB, alpha: 1.0 });
			}
		}
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
		if (!this.isInitialized || !this.app || !this.app.screen) {
			console.warn("[PixiRenderer] Cannot fit to view - renderer not initialized");
			return;
		}

		// Get local bounds (unscaled) to calculate proper fit
		const bounds = this.mainContainer.getLocalBounds();

		if (bounds.width === 0 || bounds.height === 0) {
			return;
		}

		const scaleX = this.app.screen.width / bounds.width;
		const scaleY = this.app.screen.height / bounds.height;
		const scale = Math.min(scaleX, scaleY) * 0.9;

		// Preserve Y-axis flip
		this.mainContainer.scale.set(scale, -scale);

		// Center horizontally
		this.mainContainer.x = (this.app.screen.width - bounds.width * scale) / 2 - bounds.x * scale;

		// Center vertically (accounting for Y-axis flip)
		// With Y-flip, bounds.y maps to screen Y via: containerY + bounds.y * (-scale)
		// We want: containerY + bounds.y * (-scale) = (screen.height - bounds.height * scale) / 2
		// So: containerY = (screen.height - bounds.height * scale) / 2 - bounds.y * (-scale)
		//                = (screen.height - bounds.height * scale) / 2 + bounds.y * scale
		this.mainContainer.y = (this.app.screen.height + bounds.height * scale) / 2 + bounds.y * scale;

		this.performViewportUpdate();
		this.performGridUpdate();
		this.performScaleBarUpdate();
	}

	/**
	 * Clear all rendered geometry
	 */
	clear(): void {
		this.mainContainer.removeChildren();
		this.spatialIndex.clear();
		this.allGraphicsItems = [];
	}

	/**
	 * Check if renderer is initialized and ready to render
	 */
	isReady(): boolean {
		return this.isInitialized;
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
		this.mainContainer.scale.set(state.scale, -state.scale);
		this.updateViewport();
	}

	/**
	 * Get performance metrics for display (returns cached values)
	 */
	getPerformanceMetrics() {
		const scaledBudget = this.lodManager.getScaledBudget();
		const budgetUtilization = this.visiblePolygonCount / scaledBudget;
		const viewportBounds = this.getViewportBounds();
		const zoomLevel = Math.abs(this.mainContainer.scale.x);
		const zoomThresholds = this.lodManager.getZoomThresholds();

		return {
			fps: this.fpsCounter.getCurrentFPS(),
			visiblePolygons: this.visiblePolygonCount,
			totalPolygons: this.totalRenderedPolygons,
			polygonBudget: scaledBudget,
			budgetUtilization,
			currentDepth: this.lodManager.getCurrentDepth(),
			zoomLevel,
			zoomThresholdLow: zoomThresholds.low,
			zoomThresholdHigh: zoomThresholds.high,
			viewportBounds: {
				minX: viewportBounds.minX,
				minY: viewportBounds.minY,
				maxX: viewportBounds.maxX,
				maxY: viewportBounds.maxY,
				width: viewportBounds.maxX - viewportBounds.minX,
				height: viewportBounds.maxY - viewportBounds.minY,
			},
		};
	}

	/**
	 * Destroy the renderer
	 */
	destroy(): void {
		// Clean up input controllers
		if (this.inputController) {
			this.inputController.destroy();
		}

		// Remove event listener
		window.removeEventListener(
			"layer-visibility-changed",
			this.handleLayerVisibilityChange.bind(this),
		);
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
