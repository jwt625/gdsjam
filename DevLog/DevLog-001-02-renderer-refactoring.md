# DevLog 001-02: PixiRenderer Refactoring Plan

**Date**: 2025-11-23
**Status**: Phase 3 Complete
**Goal**: Refactor the 1,688-line PixiRenderer class into modular, maintainable components

---

## Implementation Progress

### Phase 3: Extract LOD Manager - COMPLETE

**Date Completed**: 2025-11-23
**Actual Effort**: ~45 minutes
**Status**: All tests passed, performance metrics working correctly

**Files Created**:
- `src/lib/renderer/lod/LODManager.ts` (158 lines)
- `src/lib/renderer/lod/ZoomLimits.ts` (95 lines)

**PixiRenderer Changes**:
- **Before**: 1,359 lines
- **After**: 1,200 lines
- **Reduction**: 159 lines (removed 6 LOD methods and 4 private fields)

**What Was Extracted**:
1. **LODManager** - Manages LOD depth, zoom threshold tracking, budget utilization monitoring, re-render triggering with cooldown
2. **ZoomLimits** - Calculates min/max zoom scales based on scale bar constraints (1nm to 1m), clamps zoom to limits

**Methods Removed from PixiRenderer**:
- `hasZoomChangedSignificantly()` - Moved to LODManager
- `updateZoomThresholds()` - Moved to LODManager
- `getMinZoomScale()` - Moved to ZoomLimits
- `getMaxZoomScale()` - Moved to ZoomLimits
- `clampZoomScale()` - Moved to ZoomLimits
- `triggerLODRerender()` - Replaced by LODManager.checkAndTriggerRerender()

**Fields Removed from PixiRenderer**:
- `zoomThresholdLow` - Moved to LODManager
- `zoomThresholdHigh` - Moved to LODManager
- `lastLODChangeTime` - Moved to LODManager
- Removed 7 unused LOD constants from imports

**Architecture Changes**:
- LODManager uses callback-based architecture to notify PixiRenderer of depth changes
- ZoomLimits is a stateless utility class
- LODManager exposes getZoomThresholds() for performance panel display
- Scaled budget calculation centralized in LODManager.getScaledBudget()

**Bug Fixes During Integration**:
- Fixed missing zoomThresholdLow/zoomThresholdHigh in getPerformanceMetrics() causing performance panel errors
- Added getZoomThresholds() method to LODManager to expose thresholds for UI display

**Testing Results**:
- Min and max zoom limits working correctly (1nm to 1m scale bar)
- LOD depth changes trigger correctly based on budget utilization
- Performance panel shows/hides correctly (P key)
- All performance stats display correctly (FPS, polygons, budget, LOD depth, zoom thresholds)
- Rendering performance unchanged from before refactoring
- No console errors
- TypeScript compilation passes

**Lessons Learned**:
- When extracting state management, ensure all public interfaces that depend on that state are updated
- Performance metrics need to expose internal state for UI display even when that state is encapsulated
- Callback-based architecture works well for LOD depth changes, allowing clean separation of concerns

---

### Phase 2: Extract Input Controllers - COMPLETE

**Date Completed**: 2025-11-23
**Actual Effort**: ~1 hour
**Status**: All tests passed, all input methods working correctly

**Files Created**:
- `src/lib/renderer/controls/InputController.ts` (61 lines)
- `src/lib/renderer/controls/MouseController.ts` (128 lines)
- `src/lib/renderer/controls/KeyboardController.ts` (78 lines)
- `src/lib/renderer/controls/TouchController.ts` (181 lines)

**PixiRenderer Changes**:
- **Before**: 1,609 lines
- **After**: 1,359 lines
- **Reduction**: 250 lines (328 removed from setupControls, 78 added for handlers and integration)

**What Was Extracted**:
1. **MouseController** - Mouse wheel zoom, middle button pan, Space+drag pan, coordinate tracking
2. **KeyboardController** - Arrow key panning, Enter/Shift+Enter zoom, F key fit-to-view, G key grid toggle
3. **TouchController** - One-finger pan, two-finger pinch zoom, touch coordinate tracking
4. **InputController** - Coordinates all three controllers with unified callback interface

**Architecture Changes**:
- Removed entire 328-line setupControls() method
- Added three handler methods in PixiRenderer: handleZoom(), handlePan(), handleCoordinatesUpdate()
- Implemented callback-based architecture where controllers call PixiRenderer methods
- All event listeners properly cleaned up in destroy() method
- Controllers are independent and focused on specific input types

**Testing Results**:
- Mouse wheel zoom works correctly (zoom to cursor position)
- Mouse pan works (middle button drag)
- Space+drag pan works correctly
- Arrow keys pan correctly
- Enter/Shift+Enter zoom works
- F key fit-to-view works
- G key grid toggle works
- Touch controls work (pan and pinch zoom)
- Coordinates display updates correctly on mouse move
- Grid and scale bar update correctly after all input actions
- No console errors
- TypeScript compilation passes

**Lessons Learned**:
- Callback-based architecture provides clean separation between input handling and viewport state management
- Controllers handle their own event listener cleanup, preventing memory leaks
- World position calculation must remain in PixiRenderer since controllers don't have access to mainContainer state
- Total line count reduction of 250 lines while improving modularity and testability

---

### Phase 1: Extract UI Overlays - COMPLETE

**Date Completed**: 2025-11-23
**Actual Effort**: ~2 hours
**Status**: All tests passed, Y-coordinate bug fixed

**Files Created**:
- `src/lib/renderer/overlays/FPSCounter.ts` (53 lines)
- `src/lib/renderer/overlays/CoordinatesDisplay.ts` (48 lines)
- `src/lib/renderer/overlays/GridOverlay.ts` (81 lines)
- `src/lib/renderer/overlays/ScaleBarOverlay.ts` (84 lines)

**PixiRenderer Changes**:
- **Before**: 1,688 lines
- **After**: 1,612 lines
- **Reduction**: 76 lines (128 removed, 52 added for delegation)

**What Was Extracted**:
1. **FPSCounter** - Tracks and displays frames per second
2. **CoordinatesDisplay** - Shows mouse cursor position in world coordinates
3. **GridOverlay** - Renders dynamic grid based on viewport
4. **ScaleBarOverlay** - Renders scale bar showing zoom level

**Bug Fixes During Refactoring**:
- Fixed Y-coordinate sign in CoordinatesDisplay (pre-existing bug)
  - Added Y-axis flip correction: `worldY = -((mouseY - containerY) / scale)`
  - Coordinates now correctly match GDSII Cartesian convention (Y-up)

**Testing Results**:
- FPS counter displays and updates correctly
- Coordinates display updates on mouse move (Y-axis sign now correct)
- Grid toggle (G key) works
- Scale bar updates correctly under various zoom levels
- File loading works fine
- No console errors
- TypeScript compilation passes

**Lessons Learned**:
- Refactoring revealed pre-existing Y-coordinate bug that was caught during testing
- Overlay extraction was cleaner than expected due to minimal coupling
- Total line count increased (+188 net) but this is expected for proper modularization
- Each overlay is now independently testable and maintainable

---

## Current State Analysis

### File Statistics
- **Total lines**: 1,688 lines (32% of entire codebase)
- **Public API methods**: 13 methods (344 lines)
- **Private methods**: 20 methods (1,344 lines)
- **Constructor + fields**: 93 lines

### Responsibility Breakdown

**1. Input Controls (327 lines)**
- `setupControls()`: Mouse wheel, mouse pan, keyboard, touch controls, coordinate tracking
- Single 327-line method handling all input types

**2. Rendering Pipeline (404 lines)**
- `renderGDSDocument()`: Main render entry point (148 lines)
- `renderCellGeometry()`: Recursive cell/instance rendering (219 lines)
- `addPolygonToGraphics()`: Polygon drawing (37 lines)

**3. LOD System (199 lines)**
- `triggerLODRerender()`: LOD depth calculation (58 lines)
- `performIncrementalRerender()`: Re-render without re-parsing (65 lines)
- `hasZoomChangedSignificantly()`, `updateZoomThresholds()`: Zoom tracking (17 lines)
- `getMinZoomScale()`, `getMaxZoomScale()`, `clampZoomScale()`: Zoom limits (59 lines)

**4. Viewport Management (123 lines)**
- `updateViewport()`, `performViewportUpdate()`: Viewport culling with R-tree (95 lines)
- `getViewportBounds()`: Bounds calculation (28 lines)

**5. Layer Visibility (77 lines)**
- `handleLayerVisibilityChange()`, `updateLayerVisibility()`: Layer toggle handling (46 lines)
- `renderLayers()`: On-demand layer rendering (31 lines)

**6. UI Overlays (137 lines)**
- `onTick()`: FPS counter and text positioning (20 lines)
- `updateGrid()`, `performGridUpdate()`: Grid overlay (48 lines)
- `updateScaleBar()`, `performScaleBarUpdate()`: Scale bar overlay (69 lines)

**7. Pixi.js Application Management (49 lines)**
- `init()`: Canvas setup, container hierarchy, event listeners

**8. Public API (344 lines)**
- Viewport state, metrics, toggles, lifecycle methods

### Critical Dependencies

**Shared State (accessed by multiple responsibilities)**:
- `mainContainer`: Used by controls, viewport, rendering, overlays
- `app`: Used by init, controls, overlays, lifecycle
- `spatialIndex`: Used by rendering, viewport culling
- `currentDocument`: Used by rendering, layer visibility, LOD
- `layerVisibility`: Used by layer visibility, viewport culling
- `currentRenderDepth`: Used by LOD, rendering, metrics
- `documentUnits`: Used by rendering, overlays (scale bar, coordinates)

**Method Dependencies**:
- Controls → `updateViewport()`, `updateGrid()`, `updateScaleBar()`, `clampZoomScale()`
- LOD → `performIncrementalRerender()` → `renderGDSDocument()`
- Layer visibility → `performViewportUpdate()`, `renderLayers()` → `performIncrementalRerender()`
- Viewport → `spatialIndex`, `layerVisibility`, `mainContainer`

---

## Refactoring Goals

### Primary Objectives
1. **Reduce cognitive load**: Break 1,688-line file into focused modules (< 300 lines each)
2. **Improve testability**: Isolate responsibilities for unit testing
3. **Enable extensibility**: Make it easier to add new input methods, overlays, or rendering strategies
4. **Maintain stability**: Keep app fully functional after each phase

### Non-Goals
- Not a rewrite: Preserve existing logic and behavior
- Not optimizing performance: Focus on structure, not speed
- Not changing public API: External callers (ViewerCanvas) should not need changes

---

## Phased Implementation Plan

### Phase 1: Extract UI Overlays (Easiest, Low Risk)
**Effort**: 4-6 hours  
**Risk**: Low (minimal dependencies, easy to verify)

**What to Extract**:
- Grid overlay rendering
- Scale bar rendering
- FPS counter
- Coordinate display

**New Files**:
```
src/lib/renderer/overlays/
├── GridOverlay.ts       (~60 lines)
├── ScaleBarOverlay.ts   (~90 lines)
├── FPSCounter.ts        (~40 lines)
└── CoordinatesDisplay.ts (~40 lines)
```

**Interface Design**:
```typescript
// GridOverlay.ts
export class GridOverlay {
  constructor(private container: Container, private app: Application) {}

  update(viewportBounds: BoundingBox, scale: number, visible: boolean): void {
    // Render grid based on viewport bounds
  }
}

// ScaleBarOverlay.ts
export class ScaleBarOverlay {
  constructor(private container: Container, private app: Application) {}

  update(viewportBounds: BoundingBox, scale: number, documentUnits: { database: number; user: number }): void {
    // Render scale bar
  }
}

// FPSCounter.ts
export class FPSCounter {
  constructor(private text: Text, private updateInterval: number) {}

  onTick(): void {
    // Update FPS counter
  }

  getCurrentFPS(): number {
    return this.currentFPS;
  }
}

// CoordinatesDisplay.ts
export class CoordinatesDisplay {
  constructor(private text: Text) {}

  update(mouseX: number, mouseY: number, containerX: number, containerY: number, scale: number, documentUnits: { database: number; user: number }): void {
    // Update coordinate display
  }
}
```

**Changes to PixiRenderer**:
- Remove `onTick()` FPS logic → delegate to `FPSCounter.onTick()`
- Remove `performGridUpdate()` → delegate to `GridOverlay.update()`
- Remove `performScaleBarUpdate()` → delegate to `ScaleBarOverlay.update()`
- Remove coordinate tracking in `setupControls()` → delegate to `CoordinatesDisplay.update()`
- Keep debounce wrappers (`updateGrid()`, `updateScaleBar()`) in PixiRenderer for now

**Testing Steps**:
1. Verify grid toggle (G key) still works
2. Verify scale bar updates on zoom/pan
3. Verify FPS counter updates
4. Verify coordinate display updates on mouse move
5. Verify all overlays position correctly on window resize

**Acceptance Criteria**:
- All UI overlays render identically to before
- No visual regressions
- PixiRenderer reduced by ~137 lines

---

### Phase 2: Extract Input Controllers (Medium Risk)
**Effort**: 1-2 days
**Risk**: Medium (complex logic, many dependencies)

**What to Extract**:
- Mouse wheel zoom
- Mouse pan (middle button + Space+drag)
- Keyboard controls
- Touch controls

**New Files**:
```
src/lib/renderer/controls/
├── InputController.ts      (~100 lines) - Main coordinator
├── MouseController.ts      (~120 lines) - Wheel zoom + pan
├── KeyboardController.ts   (~80 lines)  - Arrow keys, Enter, F, G, O, P, L
└── TouchController.ts      (~120 lines) - Touch pan + pinch zoom
```

**Interface Design**:
```typescript
// InputController.ts
export class InputController {
  private mouseController: MouseController;
  private keyboardController: KeyboardController;
  private touchController: TouchController;

  constructor(
    canvas: HTMLCanvasElement,
    callbacks: {
      onZoom: (factor: number, centerX: number, centerY: number) => void;
      onPan: (dx: number, dy: number) => void;
      onFitToView: () => void;
      onToggleGrid: () => void;
      onToggleFill: () => void;
      // ... other callbacks
    }
  ) {
    this.mouseController = new MouseController(canvas, callbacks);
    this.keyboardController = new KeyboardController(callbacks);
    this.touchController = new TouchController(canvas, callbacks);
  }

  destroy(): void {
    this.mouseController.destroy();
    this.keyboardController.destroy();
    this.touchController.destroy();
  }
}
```

**Changes to PixiRenderer**:
- Remove entire `setupControls()` method (327 lines)
- Add `inputController: InputController` field
- In `init()`: Create `InputController` with callbacks that call existing methods
- Callbacks will call: `clampZoomScale()`, `updateViewport()`, `updateGrid()`, `updateScaleBar()`, `fitToView()`, `toggleGrid()`, `toggleFill()`

**Testing Steps**:
1. Verify mouse wheel zoom works (zoom to cursor)
2. Verify middle mouse pan works
3. Verify Space+drag pan works
4. Verify arrow key panning works
5. Verify Enter/Shift+Enter zoom works
6. Verify F key fit-to-view works
7. Verify G key grid toggle works
8. Verify O key fill/outline toggle works
9. Verify touch pan (one finger) works
10. Verify touch pinch zoom (two fingers) works
11. Verify zoom limits are respected

**Acceptance Criteria**:
- All input methods work identically to before
- No input lag or responsiveness issues
- PixiRenderer reduced by ~327 lines

---

### Phase 3: Extract LOD Manager (Medium Risk)
**Effort**: 6-8 hours
**Risk**: Medium (complex logic, but well-isolated)

**What to Extract**:
- LOD depth calculation
- Zoom threshold tracking
- Zoom limits calculation
- Incremental re-rendering coordination

**New Files**:
```
src/lib/renderer/lod/
├── LODManager.ts        (~150 lines)
└── ZoomLimits.ts        (~80 lines)
```

**Interface Design**:
```typescript
// ZoomLimits.ts
export class ZoomLimits {
  getMinZoomScale(viewportBounds: BoundingBox, currentScale: number, documentUnits: { database: number; user: number }): number {
    // Calculate min zoom based on 1m scale bar constraint
  }

  getMaxZoomScale(viewportBounds: BoundingBox, currentScale: number, documentUnits: { database: number; user: number }): number {
    // Calculate max zoom based on 1nm scale bar constraint
  }

  clampZoomScale(newScale: number, viewportBounds: BoundingBox, currentScale: number, documentUnits: { database: number; user: number }): number {
    const min = this.getMinZoomScale(viewportBounds, currentScale, documentUnits);
    const max = this.getMaxZoomScale(viewportBounds, currentScale, documentUnits);
    return Math.max(min, Math.min(max, newScale));
  }
}

// LODManager.ts
export class LODManager {
  private currentDepth = 0;
  private zoomThresholdLow = 0;
  private zoomThresholdHigh = 0;
  private lastLODChangeTime = 0;

  constructor(
    private maxPolygonsPerRender: number,
    private callbacks: {
      onDepthChange: (newDepth: number) => void;
      getCurrentZoom: () => number;
      getVisiblePolygonCount: () => number;
    }
  ) {}

  checkAndTriggerRerender(currentZoom: number): boolean {
    // Check if zoom crossed thresholds
    // Check if budget utilization requires depth change
    // Return true if re-render triggered
  }

  getCurrentDepth(): number {
    return this.currentDepth;
  }

  getScaledBudget(): number {
    const budgetMultipliers = [1, 1.5, 2, 2.5];
    const multiplier = budgetMultipliers[Math.min(this.currentDepth, 3)] ?? 1;
    return Math.floor(this.maxPolygonsPerRender * multiplier);
  }
}
```

**Changes to PixiRenderer**:
- Remove `hasZoomChangedSignificantly()`, `updateZoomThresholds()` → move to `LODManager`
- Remove `getMinZoomScale()`, `getMaxZoomScale()`, `clampZoomScale()` → move to `ZoomLimits`
- Remove `triggerLODRerender()` → delegate to `LODManager.checkAndTriggerRerender()`
- Keep `performIncrementalRerender()` in PixiRenderer (calls `renderGDSDocument()`)
- Add `lodManager: LODManager` and `zoomLimits: ZoomLimits` fields
- Update `updateViewport()` to call `lodManager.checkAndTriggerRerender()`

**Testing Steps**:
1. Verify LOD depth increases when zooming in (budget < 30%)
2. Verify LOD depth decreases when zooming out (budget > 90%)
3. Verify zoom limits work (1nm to 1m scale bar)
4. Verify re-render only triggers on significant zoom changes (0.2x or 2.0x)
5. Verify cooldown prevents thrashing (1 second between depth changes)

**Acceptance Criteria**:
- LOD system behaves identically to before
- Zoom limits enforced correctly
- PixiRenderer reduced by ~199 lines

---

### Phase 4: Extract Viewport Manager (Low-Medium Risk)
**Effort**: 4-6 hours
**Risk**: Low-Medium (well-isolated, but critical for performance)

**What to Extract**:
- Viewport culling logic
- Viewport bounds calculation
- Layer visibility filtering

**New Files**:
```
src/lib/renderer/viewport/
└── ViewportManager.ts   (~150 lines)
```

**Interface Design**:
```typescript
// ViewportManager.ts
export class ViewportManager {
  constructor(
    private spatialIndex: SpatialIndex,
    private getLayerVisibility: () => Map<string, boolean>
  ) {}

  updateVisibility(
    viewportBounds: BoundingBox,
    allGraphicsItems: RTreeItem[]
  ): { visibleCount: number; hiddenCount: number } {
    // Query spatial index for items in viewport
    // Apply layer visibility filtering
    // Update graphics visibility
    // Return counts
  }

  getViewportBounds(
    screenWidth: number,
    screenHeight: number,
    containerX: number,
    containerY: number,
    scale: number
  ): BoundingBox {
    // Calculate viewport bounds in world coordinates
  }
}
```

**Changes to PixiRenderer**:
- Remove `performViewportUpdate()` → delegate to `ViewportManager.updateVisibility()`
- Remove `getViewportBounds()` → delegate to `ViewportManager.getViewportBounds()`
- Keep `updateViewport()` debounce wrapper in PixiRenderer
- Add `viewportManager: ViewportManager` field

**Testing Steps**:
1. Verify viewport culling works (polygons outside viewport are hidden)
2. Verify visible polygon count updates correctly
3. Verify layer visibility filtering works
4. Verify performance is not degraded (check FPS)

**Acceptance Criteria**:
- Viewport culling works identically to before
- No performance regression
- PixiRenderer reduced by ~108 lines

---

### Phase 5: Extract Rendering Pipeline (Highest Risk)
**Effort**: 1-2 days
**Risk**: High (core rendering logic, many dependencies)

**What to Extract**:
- GDS document rendering
- Cell geometry rendering
- Polygon batching and tiling

**New Files**:
```
src/lib/renderer/rendering/
├── GDSRenderer.ts       (~200 lines)
├── CellRenderer.ts      (~250 lines)
└── PolygonBatcher.ts    (~100 lines)
```

**Interface Design**:
```typescript
// PolygonBatcher.ts
export class PolygonBatcher {
  batchPolygonsByTile(
    polygons: Polygon[],
    tileSize: number
  ): Map<string, Polygon[]> {
    // Group polygons by tile key "layer:datatype:tileX:tileY"
  }

  addPolygonToGraphics(
    graphics: Graphics,
    polygon: Polygon,
    color: number,
    strokeWidthDB: number,
    fillMode: boolean
  ): void {
    // Draw polygon to graphics object
  }
}

// CellRenderer.ts
export class CellRenderer {
  constructor(
    private polygonBatcher: PolygonBatcher,
    private spatialIndex: SpatialIndex
  ) {}

  async renderCell(
    cell: Cell,
    document: GDSDocument,
    transform: {
      x: number;
      y: number;
      rotation: number;
      mirror: boolean;
      magnification: number;
    },
    options: {
      maxDepth: number;
      polygonBudget: number;
      fillMode: boolean;
      strokeWidthDB: number;
      layerVisibility: Map<string, boolean>;
    },
    onProgress?: (progress: number, message: string) => void
  ): Promise<{ renderedPolygons: number; graphicsItems: RTreeItem[] }> {
    // Render cell geometry recursively
  }
}

// GDSRenderer.ts
export class GDSRenderer {
  constructor(
    private cellRenderer: CellRenderer,
    private mainContainer: Container
  ) {}

  async render(
    document: GDSDocument,
    options: {
      depth: number;
      maxPolygonsPerRender: number;
      fillMode: boolean;
      overrideScale?: number;
      layerVisibility: Map<string, boolean>;
    },
    onProgress?: RenderProgressCallback
  ): Promise<{ totalPolygons: number; graphicsItems: RTreeItem[] }> {
    // Render all top cells
  }
}
```

**Changes to PixiRenderer**:
- Remove `renderCellGeometry()` → move to `CellRenderer.renderCell()`
- Remove `addPolygonToGraphics()` → move to `PolygonBatcher.addPolygonToGraphics()`
- Simplify `renderGDSDocument()` → delegate to `GDSRenderer.render()`
- Add `gdsRenderer: GDSRenderer` field

**Testing Steps**:
1. Verify document renders correctly
2. Verify cell hierarchy renders correctly
3. Verify instances render with correct transformations
4. Verify polygon batching by tile works
5. Verify fill/outline mode works
6. Verify layer visibility works
7. Verify budget limits are respected
8. Verify progress callbacks work
9. Load multiple test files (simple and complex)

**Acceptance Criteria**:
- All rendering works identically to before
- No visual regressions
- No performance regression
- PixiRenderer reduced by ~404 lines

---

### Phase 6: Final Cleanup and Documentation
**Effort**: 2-4 hours
**Risk**: Low

**Tasks**:
1. Remove `renderTestGeometry()` (only used for prototyping)
2. Update PixiRenderer to be a thin orchestrator
3. Add JSDoc comments to all new classes
4. Update README with new architecture diagram
5. Add unit tests for extracted modules

**Final PixiRenderer Structure** (estimated ~400 lines):
```typescript
export class PixiRenderer {
  // Pixi.js core
  private app: Application;
  private mainContainer: Container;

  // Extracted modules
  private inputController: InputController;
  private viewportManager: ViewportManager;
  private lodManager: LODManager;
  private zoomLimits: ZoomLimits;
  private gdsRenderer: GDSRenderer;
  private gridOverlay: GridOverlay;
  private scaleBarOverlay: ScaleBarOverlay;
  private fpsCounter: FPSCounter;
  private coordinatesDisplay: CoordinatesDisplay;

  // Shared state
  private spatialIndex: SpatialIndex;
  private currentDocument: GDSDocument | null;
  private layerVisibility: Map<string, boolean>;

  // Public API (unchanged)
  async init(canvas: HTMLCanvasElement): Promise<void>
  async renderGDSDocument(document: GDSDocument, ...): Promise<void>
  fitToView(): void
  toggleGrid(): void
  toggleFill(): void
  getPerformanceMetrics(): object
  // ... other public methods
}
```

---

## Testing Strategy

### Per-Phase Testing
- After each phase, run the app and test all affected features
- Use browser DevTools to check for console errors
- Verify no visual regressions
- Check FPS to ensure no performance degradation

### Integration Testing
- Load multiple test files (simple and complex GDS files)
- Test all keyboard shortcuts
- Test all mouse interactions
- Test touch interactions on mobile/tablet
- Test layer visibility toggles
- Test zoom limits
- Test LOD depth changes

### Regression Testing Checklist
- [ ] Mouse wheel zoom works
- [ ] Mouse pan works (middle button and Space+drag)
- [ ] Keyboard controls work (arrows, Enter, F, G, O, P, L)
- [ ] Touch controls work (pan, pinch zoom)
- [ ] Grid toggle works
- [ ] Fill/outline toggle works
- [ ] Layer panel toggles work
- [ ] Performance panel shows correct metrics
- [ ] Scale bar updates correctly
- [ ] Coordinate display updates correctly
- [ ] FPS counter updates correctly
- [ ] Viewport culling works
- [ ] LOD depth changes work
- [ ] Zoom limits enforced
- [ ] Fit-to-view works
- [ ] File loading works
- [ ] No console errors

---

## Rollback Plan

### Per-Phase Rollback
If a phase fails:
1. Revert the commit for that phase
2. Verify app works with previous phase
3. Analyze failure and adjust plan
4. Retry phase with fixes

### Git Strategy
- Create feature branch: `refactor/renderer-modularization`
- One commit per phase with descriptive message
- Tag each phase: `refactor-phase-1`, `refactor-phase-2`, etc.
- Merge to main only after all phases complete and pass testing

### Backup Strategy
- Keep original PixiRenderer.ts as PixiRenderer.backup.ts until refactoring complete
- Document any behavior changes in DevLog
- If major issues arise, can revert entire refactoring

---

## Success Metrics

### Code Quality
- PixiRenderer reduced from 1,688 lines to ~400 lines (76% reduction)
- No file larger than 300 lines
- Each module has single responsibility
- All modules have clear interfaces

### Functionality
- All existing features work identically
- No visual regressions
- No performance regressions
- No new bugs introduced

### Maintainability
- New developers can understand each module in < 15 minutes
- Adding new input method requires only editing InputController
- Adding new overlay requires only creating new overlay class
- Rendering changes isolated to rendering modules

---

## Timeline Estimate

- **Phase 1** (UI Overlays): 4-6 hours
- **Phase 2** (Input Controllers): 1-2 days
- **Phase 3** (LOD Manager): 6-8 hours
- **Phase 4** (Viewport Manager): 4-6 hours
- **Phase 5** (Rendering Pipeline): 1-2 days
- **Phase 6** (Cleanup): 2-4 hours

**Total**: 4-6 days of focused work

---

## Next Steps

1. Review this plan with team/stakeholders
2. Create feature branch `refactor/renderer-modularization`
3. Start with Phase 1 (UI Overlays) - lowest risk, quick win
4. Test thoroughly after each phase
5. Document any deviations from plan in this DevLog
6. Update DevLog with actual time spent per phase

---

## Notes

- This is an incremental refactoring, not a rewrite
- App must remain functional after each phase
- Public API should not change (no breaking changes for ViewerCanvas)
- Focus on structure, not optimization
- Each phase should be independently reviewable and testable

