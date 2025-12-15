# DevLog-005-00: Measurement Mode Implementation Plan

**Date**: 2025-12-14  
**Status**: Complete (Tested)  
**Feature**: Two-point distance measurement tool

## Overview

Add measurement mode to gdsjam GDS viewer, allowing users to measure distances between two points on the layout. This is a local-only MVP feature (not synced via Y.js) following established patterns from the comment and editor mode features.

## Requirements

1. Hold 'm' key (500ms) to enter/exit measurement mode
2. Two-point distance measurement (click point1, click point2)
3. Visual feedback: measurement lines with distance labels
4. Smart unit formatting (nm/µm/mm based on scale)
5. Mobile support via FAB menu with tap-to-place interaction
6. No animations (instant transitions)
7. Local-only state (no Y.js sync, no localStorage persistence)
8. Architecture supports future measurement types (angle, area, etc.)

## Key Design Decisions

### 1. Persistence Strategy
- Solo mode: localStorage with key `gdsjam_measurements_${fileName}_${fileSize}`
- Collaboration mode: Local-only (NOT synced via Y.js)
- Rationale: Measurements are analysis tools, useful to persist locally but not broadcast to collaborators
- Ctrl/Cmd+K to clear all measurements (similar to KLayout)

### 2. Keyboard Activation
- Hold 'm' key (500ms) to enter measurement mode
- Hold 'm' again (500ms) to exit measurement mode
- Pattern: Identical to 'c' (comments) and 'e' (editor) hold patterns
- No conflict with minimap: minimap remains on 'KeyM' short press in KeyboardShortcutManager
- Measurement mode uses hold detection in ViewerCanvas.svelte (not KeyboardShortcutManager)

### 3. Measurement Interaction
- Desktop: Click point1, ruler follows cursor, click point2 to complete (KLayout-style)
- Mobile: Touch and drag to drag out measurement ruler (overrides pan gesture during measurement mode)
- Click completed measurement: Visual highlight only (no deletion, no tooltip)
- Maximum 50 measurements: Warn user and auto-delete oldest when limit reached

### 4. Visual Rendering
- Pixi.js Graphics overlay (similar to grid/scale bar)
- Completed measurements: Cyan solid line with distance label
- Active measurement: Yellow dashed line following cursor
- Endpoint markers: Filled circles at measurement points
- Highlighted measurement: Brighter color or thicker line (visual feedback only)

## Architecture

### New Files to Create

1. **src/lib/measurements/types.ts** (~50 lines)
   - `MeasurementPoint` interface (worldX, worldY)
   - `DistanceMeasurement` interface (id, point1, point2, distanceMicrometers, createdAt)
   - `MeasurementStoreState` interface

2. **src/lib/measurements/utils.ts** (~80 lines)
   - `calculateDistance()`: Euclidean distance in micrometers
   - `formatDistance()`: Smart unit selection (nm/µm/mm)
   - Reuses coordinate conversion patterns from CoordinatesDisplay.ts

3. **src/stores/measurementStore.ts** (~250 lines)
   - Svelte store for measurement state
   - Pattern: Similar to commentStore.ts with localStorage for solo mode
   - Methods: enterMeasurementMode, exitMeasurementMode, addPoint, clearAllMeasurements, toggleMeasurementsVisibility, reset, loadFromLocalStorage, saveToLocalStorage
   - Limit: 50 measurements max, auto-delete oldest when exceeded
   - Toast notification when limit reached

4. **src/lib/renderer/overlays/MeasurementOverlay.ts** (~250 lines)
   - Pixi.js overlay for rendering measurements
   - Pattern: Similar to GridOverlay.ts and ScaleBarOverlay.ts
   - Renders completed measurements (cyan solid line + label)
   - Renders active measurement (yellow dashed line to cursor)
   - Handles world-to-screen coordinate conversion with Y-axis flip

### Files to Modify

1. **src/components/viewer/ViewerCanvas.svelte** (~180 lines added)
   - Add M key hold detection (pattern: identical to C/E key handlers)
   - Desktop: Click for point1, cursor tracking, click for point2
   - Mobile: Touch and drag gesture for measurement (overrides pan during measurement mode)
   - Click completed measurement for visual highlight
   - ESC key to cancel measurement mode
   - Integration with measurementStore and localStorage
   - Ctrl/Cmd+K to clear all measurements
   - Reference: Lines 58-76 (F key), 204-386 (C/E key), 392-420 (canvas click)

2. **src/lib/renderer/PixiRenderer.ts** (~40 lines added)
   - Create measurementContainer (similar to gridContainer, scaleBarContainer)
   - Initialize MeasurementOverlay instance
   - Add updateMeasurementOverlay() public method
   - Call measurement overlay update in viewport change handlers
   - Reference: Lines 754-773 (viewport state), overlay initialization patterns

3. **src/components/ui/MobileControls.svelte** (~30 lines added)
   - Add onToggleMeasurementMode prop
   - Add measurementModeActive prop
   - Add "Measure Distance" menu item with ruler icon
   - Reference: Lines 106-256 (FAB menu structure)

4. **src/App.svelte** (~1 line modified)
   - Update keyboard shortcuts help text
   - Add "M (hold) to toggle measurement mode | Ctrl/Cmd+K to clear measurements"
   - Reference: Line 596 (controls info text)

5. **src/stores/gdsStore.ts** (~5 lines added)
   - Import measurementStore
   - Call measurementStore.reset() in setDocument() method
   - Initialize measurementStore for new file (triggers localStorage load)
   - Ensures measurements are loaded/cleared appropriately when file changes

## Coordinate System & Calculations

### Screen to World Conversion
Pattern from CoordinatesDisplay.ts (lines 28-47):
```
worldX = (screenX - containerX) / scale
worldY = -((screenY - containerY) / scale)  // Y-axis flip
```

### World to Screen Conversion
```
screenX = worldX * scale + containerX
screenY = -worldY * scale + containerY  // Y-axis flip
```

### Distance Calculation
```
1. Calculate in database units: sqrt((x2-x1)² + (y2-y1)²)
2. Convert to micrometers: (distanceDB * documentUnits.database) / 1e-6
3. Format with smart units (pattern from ScaleBarOverlay.ts lines 28-68)
```

## Implementation Steps

### Phase 1: Core Infrastructure - COMPLETE
- [x] Create src/lib/measurements/types.ts
- [x] Create src/lib/measurements/utils.ts with distance calculation and formatting
- [x] Create src/stores/measurementStore.ts with state management
- [x] Test store logic in isolation

### Phase 2: Visual Rendering - COMPLETE
- [x] Create src/lib/renderer/overlays/MeasurementOverlay.ts
- [x] Modify src/lib/renderer/PixiRenderer.ts to add measurement container
- [x] Test rendering with mock measurements

### Phase 3: Keyboard & Mouse Integration - COMPLETE
- [x] Modify src/components/viewer/ViewerCanvas.svelte (M key hold detection)
- [x] Add desktop click handler (click point1, cursor tracking, click point2)
- [x] Add mobile touch-and-drag handler (overrides pan during measurement mode)
- [x] Add click handler for completed measurements (visual highlight)
- [x] Add ESC key handler to cancel measurement mode
- [x] Add Ctrl/Cmd+K handler to clear all measurements
- [x] Integrate localStorage save/load on measurement changes

### Phase 4: Mobile Support - COMPLETE
- [x] Modify src/components/ui/MobileControls.svelte (FAB menu)
- [x] Add measurement mode toggle to mobile FAB menu
- [x] Wire up mobile controls in ViewerCanvas.svelte

### Phase 5: Integration & Polish - COMPLETE
- [x] Add measurement toast notification display
- [x] Initialize measurement store on file load (solo and collaboration modes)
- [x] Add measurement overlay update effect
- [x] Test localStorage persistence (save/load on file reload)
- [x] Test 50 measurement limit (warning toast, auto-delete oldest)
- [x] Test viewport changes (pan/zoom) with measurements

## Testing Checklist

### Keyboard Interaction
- [ ] Hold 'm' for 500ms toggles measurement mode (enter/exit)
- [ ] Release 'm' before 500ms does nothing
- [ ] ESC cancels measurement mode
- [ ] Ctrl/Cmd+K clears all measurements
- [ ] Minimap 'M' short press still works (no conflict)

### Measurement Workflow (Desktop)
- [ ] Click point1 shows yellow dashed line to cursor
- [ ] Cursor movement updates dashed line endpoint
- [ ] Click point2 completes measurement with cyan line and label
- [ ] Distance label shows correct units (nm/µm/mm)
- [ ] Can create multiple measurements
- [ ] Click completed measurement shows visual highlight

### Measurement Workflow (Mobile)
- [ ] Touch and drag creates measurement ruler
- [ ] Drag gesture overrides pan during measurement mode
- [ ] Release completes measurement
- [ ] Tap completed measurement shows visual highlight

### Persistence & Limits
- [ ] Measurements persist in localStorage (solo mode)
- [ ] Measurements reload correctly on file reload
- [ ] 50 measurement limit enforced
- [ ] Toast warning when limit reached
- [ ] Oldest measurement auto-deleted when limit exceeded

### Viewport Behavior
- [ ] Measurements stay anchored to world coordinates during pan
- [ ] Measurements scale correctly during zoom
- [ ] Labels remain readable at different zoom levels

### Mobile
- [ ] FAB menu shows "Measure" button
- [ ] Tap-to-place works for point1 and point2
- [ ] Touch feedback is responsive

### Edge Cases
- [ ] Switching files clears measurements
- [ ] Exiting measurement mode clears active measurement
- [ ] No crashes with empty measurements

## Future Extensibility

Architecture supports adding measurement types via keyboard shortcuts within measurement mode:
- Angle measurement (3 points)
- Area measurement (polygon)
- Perimeter measurement (polygon)
- Multi-segment polyline (cumulative distance)

Implementation: Add `type` field to measurement interface, update overlay rendering logic, add type-specific keyboard shortcuts (D=distance, A=angle, P=polygon).

## Estimated Effort

- Total new code: ~630 lines
- Total modifications: ~246 lines
- Complexity: Medium
- Estimated time: 5-7 hours (additional complexity: localStorage, touch-and-drag, 50-limit enforcement)

## References

### Similar Features
- DevLog-001-14-Floating-Comments.md: Hold 'c' key pattern, coordinate conversion, localStorage/Y.js sync
- DevLog-004-01-Client-Side-Editor.md: Hold 'e' key pattern, mode activation

### Key Code Patterns
- ViewerCanvas.svelte: Keyboard hold detection (lines 58-76, 204-386), canvas click (lines 392-420)
- CoordinatesDisplay.ts: Coordinate conversion (lines 28-47)
- ScaleBarOverlay.ts: Smart unit formatting (lines 28-68)
- commentStore.ts: Store pattern with mode management
- MobileControls.svelte: FAB menu structure (lines 106-256)


## Follow-up Features

See DevLog-005-01-Measurement-Snap-Feature.md for Shift-key snap-to-axis enhancement.
