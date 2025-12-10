/**
 * PixiRenderer - Main orchestrator for GDSII layout rendering
 *
 * This class serves as a thin orchestrator that coordinates specialized modules:
 * - InputController: Handles mouse, keyboard, and touch input
 * - ViewportManager: Manages viewport culling and visibility
 * - LODManager: Controls Level of Detail rendering optimization
 * - GDSRenderer: Renders GDS documents with polygon batching
 * - UI Overlays: FPS counter, coordinates, grid, and scale bar
 *
 * Architecture:
 * - Delegates responsibilities to focused, single-purpose modules
 * - Maintains shared state (containers, spatial index, document)
 * - Provides public API for external components (ViewerCanvas)
 *
 * @example
 * const renderer = new PixiRenderer();
 * await renderer.init(canvas);
 * await renderer.renderGDSDocument(document);
 */

import { Application, Container, type Graphics, Text } from "pixi.js";
import type { BoundingBox, GDSDocument } from "../../types/gds";
import {
	FPS_UPDATE_INTERVAL,
	HIERARCHICAL_POLYGON_THRESHOLD,
	MAX_POLYGONS_PER_RENDER,
	POLYGON_FILL_MODE,
} from "../config";
import { type RTreeItem, SpatialIndex } from "../spatial/RTree";
import { InputController } from "./controls/InputController";
import { LODManager } from "./lod/LODManager";
import { ZoomLimits } from "./lod/ZoomLimits";
import { CoordinatesDisplay } from "./overlays/CoordinatesDisplay";
import { FPSCounter } from "./overlays/FPSCounter";
import { GridOverlay } from "./overlays/GridOverlay";
import { ScaleBarOverlay } from "./overlays/ScaleBarOverlay";
import { GDSRenderer, type RenderProgressCallback } from "./rendering/GDSRenderer";
import { ViewportManager } from "./viewport/ViewportManager";

export interface ViewportState {
	x: number;
	y: number;
	scale: number;
}

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

	// LOD Manager
	private lodManager!: LODManager;
	private zoomLimits!: ZoomLimits;

	// Viewport Manager
	private viewportManager!: ViewportManager;

	// GDS Renderer
	private gdsRenderer!: GDSRenderer;

	// UI Overlays
	private fpsCounter!: FPSCounter;
	private coordinatesDisplay!: CoordinatesDisplay;
	private gridOverlay!: GridOverlay;
	private scaleBarOverlay!: ScaleBarOverlay;

	// Input Controllers
	private inputController!: InputController;

	// Viewport change callback for collaboration sync
	private onViewportChangedCallback: ((state: ViewportState) => void) | null = null;

	// Callback for when viewport interaction is blocked (for showing toast)
	private onViewportBlockedCallback: (() => void) | null = null;

	// Flag to prevent viewport changes when following host
	private isViewportLocked = false;

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
			shouldRerenderOnZoomChange: () => {
				// In outline mode, we need to re-render when zoom changes to update stroke widths
				// Stroke widths are calculated to maintain constant screen pixel width
				return !this.fillPolygons;
			},
		});

		// Initialize viewport manager
		this.viewportManager = new ViewportManager(this.spatialIndex, () => this.layerVisibility);

		// Initialize GDS renderer
		this.gdsRenderer = new GDSRenderer(this.spatialIndex, this.mainContainer);

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
	 * Returns false if viewport is locked (caller can show toast)
	 */
	private handleZoom(
		zoomFactor: number,
		centerX: number,
		centerY: number,
		_worldPosX: number,
		_worldPosY: number,
	): boolean {
		if (this.isViewportLocked) {
			this.onViewportBlockedCallback?.();
			return false;
		}

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
		this.notifyViewportChanged();

		return true;
	}

	/**
	 * Handle pan from input controllers
	 * Returns false if viewport is locked (caller can show toast)
	 */
	private handlePan(dx: number, dy: number): boolean {
		if (this.isViewportLocked) {
			this.onViewportBlockedCallback?.();
			return false;
		}

		this.mainContainer.x += dx;
		this.mainContainer.y += dy;

		this.updateViewport();
		this.updateGrid();
		this.updateScaleBar();
		this.notifyViewportChanged();

		return true;
	}

	/**
	 * Notify viewport change callback (for collaboration sync)
	 */
	private notifyViewportChanged(): void {
		// Skip notification during re-render - mainContainer may be temporarily replaced
		// with a new container that has wrong scale. The correct notification will happen
		// after re-render completes and viewport state is restored.
		if (this.isRerendering) {
			return;
		}
		if (this.onViewportChangedCallback) {
			this.onViewportChangedCallback(this.getViewportState());
		}
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
		const viewportBounds = this.viewportManager.getViewportBounds(
			this.app.screen.width,
			this.app.screen.height,
			this.mainContainer.x,
			this.mainContainer.y,
			this.mainContainer.scale.x,
			this.mainContainer.scale.y,
		);

		const result = this.viewportManager.updateVisibility(viewportBounds, this.allGraphicsItems);

		// Update cached visible polygon count for performance metrics
		this.visiblePolygonCount = result.visiblePolygonCount;

		// Check if zoom has changed significantly and trigger LOD update
		const currentZoom = Math.abs(this.mainContainer.scale.x);
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
		// Detect newly visible layers that need to be rendered
		const newlyVisibleLayers = this.viewportManager.detectNewlyVisibleLayers(
			visibility,
			this.layerVisibility,
			this.allGraphicsItems,
		);

		// Update internal visibility map
		this.layerVisibility.clear();
		for (const [key, visible] of Object.entries(visibility)) {
			this.layerVisibility.set(key, visible);
		}

		// If there are newly visible layers that haven't been rendered, render them
		if (newlyVisibleLayers.length > 0) {
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
			return;
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
			return;
		}

		// Set flag to prevent re-render loops
		this.isRerendering = true;

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

		// Update GDSRenderer's container reference
		this.gdsRenderer.updateMainContainer(this.mainContainer);

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

		// Apply layer visibility to newly created graphics
		this.performViewportUpdate();

		// Clear flag
		this.isRerendering = false;

		// Now notify viewport change with correct bounds (was skipped during re-render)
		this.notifyViewportChanged();
	}

	/**
	 * Get current viewport bounds in world coordinates
	 */
	private getViewportBounds(): BoundingBox {
		return this.viewportManager.getViewportBounds(
			this.app.screen.width,
			this.app.screen.height,
			this.mainContainer.x,
			this.mainContainer.y,
			this.mainContainer.scale.x,
			this.mainContainer.scale.y,
		);
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

		// Only reset depth to 0 on initial render, not on incremental re-renders
		if (!this.isRerendering) {
			// For hierarchical files (top cells have instances but few/no polygons), start with higher depth
			// Otherwise we render nothing and LOD never increases
			let isHierarchical = false;
			let totalTopCellPolygons = 0;
			let totalTopCellInstances = 0;

			for (const topCellName of document.topCells) {
				const cell = document.cells.get(topCellName);
				if (cell) {
					totalTopCellPolygons += cell.polygons.length;
					totalTopCellInstances += cell.instances.length;
				}
			}

			// If top cells have instances but very few polygons, it's hierarchical
			// (Ignore context info cells which are typically small)
			isHierarchical =
				totalTopCellInstances > 0 && totalTopCellPolygons < HIERARCHICAL_POLYGON_THRESHOLD;

			this.currentRenderDepth = isHierarchical ? 3 : 0; // Start at depth 3 for hierarchical files
		}

		// Get scaled budget from LOD manager
		const scaledBudget = this.lodManager.getScaledBudget();

		// Render using GDSRenderer
		const result = await this.gdsRenderer.render(
			document,
			{
				maxDepth: this.currentRenderDepth,
				maxPolygonsPerRender: scaledBudget,
				fillMode: this.fillPolygons,
				overrideScale,
				layerVisibility: this.layerVisibility,
			},
			onProgress,
		);

		// Store results
		this.allGraphicsItems = result.graphicsItems;
		this.totalRenderedPolygons = result.totalPolygons;

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
	 * Fit viewport to show all geometry
	 * Returns false if viewport is locked (caller can show toast)
	 */
	fitToView(): boolean {
		if (this.isViewportLocked) {
			this.onViewportBlockedCallback?.();
			return false;
		}

		if (!this.isInitialized || !this.app || !this.app.screen) {
			return true; // Not locked, just not ready
		}

		// Get local bounds (unscaled) to calculate proper fit
		const bounds = this.mainContainer.getLocalBounds();

		if (bounds.width === 0 || bounds.height === 0) {
			return true;
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
		this.notifyViewportChanged();

		return true;
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
		this.updateGrid();
		this.updateScaleBar();
		this.notifyViewportChanged();
	}

	/**
	 * Set callback for viewport changes (called on zoom/pan)
	 * Used for collaboration sync
	 */
	setOnViewportChanged(callback: ((state: ViewportState) => void) | null): void {
		this.onViewportChangedCallback = callback;
	}

	/**
	 * Set callback for when viewport interaction is blocked (for showing toast)
	 */
	setOnViewportBlocked(callback: (() => void) | null): void {
		this.onViewportBlockedCallback = callback;
	}

	/**
	 * Lock/unlock viewport (prevent user pan/zoom when following host)
	 */
	setViewportLocked(locked: boolean): void {
		this.isViewportLocked = locked;
	}

	/**
	 * Check if viewport is currently locked
	 */
	isViewportLockedState(): boolean {
		return this.isViewportLocked;
	}

	/**
	 * Get screen dimensions
	 */
	getScreenDimensions(): { width: number; height: number } {
		return {
			width: this.app.screen.width,
			height: this.app.screen.height,
		};
	}

	/**
	 * Get document bounding box (for minimap)
	 */
	getDocumentBoundingBox(): BoundingBox | null {
		return this.currentDocument?.boundingBox ?? null;
	}

	/**
	 * Get current document (for minimap rendering)
	 */
	getCurrentDocument(): GDSDocument | null {
		return this.currentDocument;
	}

	/**
	 * Get document units (for minimap coordinate transformation)
	 */
	getDocumentUnits(): { database: number; user: number } {
		return { ...this.documentUnits };
	}

	/**
	 * Get public viewport bounds (for minimap)
	 */
	getPublicViewportBounds(): BoundingBox {
		return this.getViewportBounds();
	}

	/**
	 * Set viewport center (for minimap click-to-navigate)
	 * Instantly centers the viewport on the given world coordinates
	 */
	setViewportCenter(worldX: number, worldY: number): void {
		if (this.isViewportLocked) {
			this.onViewportBlockedCallback?.();
			return;
		}

		const screenWidth = this.app.screen.width;
		const screenHeight = this.app.screen.height;
		const scaleX = this.mainContainer.scale.x;
		const scaleY = this.mainContainer.scale.y;

		// Calculate new container position to center on world coordinates
		this.mainContainer.x = screenWidth / 2 - worldX * scaleX;
		this.mainContainer.y = screenHeight / 2 - worldY * scaleY;

		// Trigger viewport update
		this.updateViewport();
		this.updateGrid();
		this.updateScaleBar();

		// Notify callback
		this.notifyViewportChanged();
	}

	/**
	 * Set viewport center and scale (for navigating to participant viewport)
	 * Instantly centers the viewport on the given world coordinates with specified scale
	 */
	setViewportCenterAndScale(worldX: number, worldY: number, scale: number): void {
		if (this.isViewportLocked) {
			this.onViewportBlockedCallback?.();
			return;
		}

		const screenWidth = this.app.screen.width;
		const screenHeight = this.app.screen.height;

		// Set scale first (Y is inverted)
		this.mainContainer.scale.set(scale, -scale);

		// Calculate new container position to center on world coordinates
		this.mainContainer.x = screenWidth / 2 - worldX * scale;
		this.mainContainer.y = screenHeight / 2 - worldY * -scale;

		// Trigger viewport update
		this.updateViewport();
		this.updateGrid();
		this.updateScaleBar();

		// Notify callback
		this.notifyViewportChanged();
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

	/**
	 * Trigger a resize to fit the parent element
	 * Useful when parent size changes due to sibling elements being hidden/shown
	 */
	triggerResize(): void {
		// The PixiJS app has a resizer that tracks the parent element
		// Force it to recalculate by triggering the resize method
		if (this.app.resizeTo) {
			const parent = this.app.resizeTo as HTMLElement;
			const width = parent.clientWidth;
			const height = parent.clientHeight;
			this.app.renderer.resize(width, height);
			this.fpsCounter.updatePosition(width);
			this.coordinatesDisplay.updatePosition(width, height);
		}
	}
}
