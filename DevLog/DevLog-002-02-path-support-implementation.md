# DevLog 002-02: PATH Support Implementation Plan

**Date:** 2025-12-13
**Status:** Implemented - Testing Pending
**Related:** DevLog-002-01 (Bug 3: Layer 24 Missing)

## Executive Summary

Layer 24 in TLS08C_20220725.gds contains 77,220 PATH elements (96% of all paths in the file) and zero BOUNDARY polygons. Since the parser does not support PATH records, the entire layer is invisible. This document provides a detailed implementation plan to add PATH support by converting paths to polygons during parsing.

## Problem Analysis

### Current Parser Architecture

The parser uses a state machine pattern in `buildGDSDocument()`:

```typescript
// Current state variables
let currentCell: Cell | null = null;
let currentPolygon: Partial<Polygon> | null = null;
let currentInstance: Partial<CellInstance> | null = null;
let currentLayer = 0;
let currentDatatype = 0;
```

**State transitions:**
- `BOUNDARY` → creates `currentPolygon`
- `LAYER/DATATYPE` → sets layer/datatype on active element
- `XY` → sets points on active element
- `ENDEL` → finalizes element, adds to cell

**Missing:** No handling for `PATH`, `WIDTH`, `PATHTYPE` records.

### Data Flow

```
GDS File → parseGDSWithDeprecatedRecords() → buildGDSDocument() → GDSDocument
                                                    ↓
                                            Paths must convert to Polygons here
                                                    ↓
                                            Rendering pipeline (unchanged)
```

**Key insight:** Paths must convert to polygons during parsing, not rendering. The rendering pipeline only processes `Polygon` objects.

### PATH Record Structure

```
PATH
  LAYER <layer>
  DATATYPE <datatype>
  PATHTYPE <0=flush, 1=round, 2=extended, 4=custom>
  WIDTH <width in DB units>
  XY <array of centerline points>
ENDEL
```

**Pathtype definitions:**
- 0: Flush - square end at path endpoint
- 1: Round - semicircle cap
- 2: Extended - square end extends by halfWidth
- 4: Custom - uses BGNEXTN/ENDEXTN (already parsed, not yet used)

## Implementation Plan

### Phase 1: Parser State Extension

**File:** `src/lib/gds/GDSParser.ts`

**Location:** Line ~733 (after existing state variables)

**Changes:**
```typescript
// Add PATH state tracking
let currentPath: Partial<{
    id: string;
    points: Point[];
    layer: number;
    datatype: number;
    width: number;
    pathtype: number;
}> | null = null;
let currentPathWidth = 0;
let currentPathType = 0;
```

**Rationale:** Separate from `currentPolygon` because PATH has different attributes (width, pathtype).

### Phase 2: Record Handlers

**Location:** `src/lib/gds/GDSParser.ts`, switch statement starting at line ~755

**Add new cases:**

1. **PATH handler** (after BOUNDARY case, line ~794):
```typescript
case RecordType.PATH:
    currentPath = {
        id: generateUUID(),
        points: [],
    };
    break;
```

2. **WIDTH handler** (after DATATYPE case, line ~808):
```typescript
case RecordType.WIDTH:
    currentPathWidth = data as number;
    if (currentPath) {
        currentPath.width = currentPathWidth;
    }
    break;
```

3. **PATHTYPE handler** (after WIDTH case):
```typescript
case RecordType.PATHTYPE:
    currentPathType = data as number;
    if (currentPath) {
        currentPath.pathtype = currentPathType;
    }
    break;
```

**Update existing handlers:**

4. **LAYER handler** (line ~796):
```typescript
case RecordType.LAYER:
    currentLayer = data as number;
    if (currentPolygon) {
        currentPolygon.layer = currentLayer;
    }
    if (currentPath) {  // ADD
        currentPath.layer = currentLayer;
    }
    break;
```

5. **DATATYPE handler** (line ~803):
```typescript
case RecordType.DATATYPE:
    currentDatatype = data as number;
    if (currentPolygon) {
        currentPolygon.datatype = currentDatatype;
    }
    if (currentPath) {  // ADD
        currentPath.datatype = currentDatatype;
    }
    break;
```

6. **XY handler** (line ~810):
```typescript
case RecordType.XY:
    if (currentPolygon && Array.isArray(data)) {
        // ... existing polygon handling ...
    } else if (currentPath && Array.isArray(data)) {  // ADD
        const points: Point[] = [];
        for (const coord of data) {
            if (Array.isArray(coord) && coord.length >= 2) {
                points.push({ x: coord[0], y: coord[1] });
            }
        }
        currentPath.points = points;
    } else if (currentInstance && Array.isArray(data) && data.length >= 1) {
        // ... existing instance handling ...
    }
    break;
```

**Note:** All record types (PATH, WIDTH, PATHTYPE) are already parsed by `parseGDSWithDeprecatedRecords()`. No changes needed to the low-level parser.

### Phase 3: Path-to-Polygon Conversion Algorithm

**File:** `src/lib/gds/GDSParser.ts`

**Location:** Line ~315 (after `calculateBoundingBox()` function)

**Function signature:**
```typescript
function pathToPolygon(centerPoints: Point[], width: number, pathtype: number): Point[]
```

**Algorithm overview:**

1. **Input validation:**
   - Return empty array if no points
   - Return centerline if width <= 0 (degenerate case)

2. **Edge generation:**
   - For each centerline point, calculate perpendicular direction
   - Create left and right edge points at distance `halfWidth` from center
   - Handle corners with miter joins (average of incoming/outgoing perpendiculars)

3. **End cap generation:**
   - Pathtype 0 (flush): No extension, connect edges directly
   - Pathtype 1 (round): Approximate semicircle with 8 segments
   - Pathtype 2 (extended): Extend by `halfWidth` in path direction
   - Pathtype 4 (custom): Fall back to flush (BGNEXTN/ENDEXTN support deferred)

4. **Polygon assembly:**
   - Combine: `startCap + leftEdge + endCap + rightEdge.reverse()`
   - Close polygon by duplicating first point at end

**Complexity:** ~150 lines of geometry calculations

**Edge cases:**
- Zero-width paths: Return centerline
- Single-point paths: Skip (< 3 points after conversion)
- Sharp corners: Miter join may create spikes (acceptable for MVP)
- Self-intersecting paths: Acceptable, renderer handles it

### Phase 4: ENDEL Handler Update

**File:** `src/lib/gds/GDSParser.ts`

**Location:** Line ~837 (ENDEL case, after polygon handling)

**Add path completion logic:**

```typescript
case RecordType.ENDEL:
    if (currentPolygon && currentCell && currentPolygon.points) {
        // ... existing polygon handling ...
        currentPolygon = null;
    } else if (currentPath && currentCell && currentPath.points) {  // ADD
        // Validate path fields
        if (currentPath.layer === undefined) {
            currentPath.layer = currentLayer || 0;
        }
        if (currentPath.datatype === undefined) {
            currentPath.datatype = currentDatatype || 0;
        }
        if (currentPath.width === undefined) {
            currentPath.width = currentPathWidth || 0;
        }
        if (currentPath.pathtype === undefined) {
            currentPath.pathtype = currentPathType || 0;
        }

        // Convert path to polygon
        const polygonPoints = pathToPolygon(
            currentPath.points,
            currentPath.width,
            currentPath.pathtype
        );

        if (polygonPoints.length >= 3) {
            const polygon: Polygon = {
                id: currentPath.id!,
                points: polygonPoints,
                layer: currentPath.layer,
                datatype: currentPath.datatype,
                boundingBox: calculateBoundingBox(polygonPoints),
            };

            // Add to cell (same as BOUNDARY polygons)
            currentCell.polygons.push(polygon);
            polygonCount++;

            // Track layer (same as BOUNDARY)
            const layerKey = `${polygon.layer}:${polygon.datatype}`;
            if (!layers.has(layerKey)) {
                layers.set(layerKey, {
                    layer: polygon.layer,
                    datatype: polygon.datatype,
                    name: `Layer ${polygon.layer}/${polygon.datatype}`,
                    color: generateLayerColor(polygon.layer, polygon.datatype),
                    visible: true,
                });
            }
        }

        currentPath = null;
    } else if (currentInstance && currentCell) {
        // ... existing instance handling ...
    }
    break;
```

**Key points:**
- Paths convert to `Polygon` objects, added to `cell.polygons[]`
- Layer tracking identical to BOUNDARY handling
- Polygon count incremented (paths counted as polygons in statistics)

## Files Modified

**Single file change:**
- `src/lib/gds/GDSParser.ts` (~220 lines added)

**No changes needed:**
- `src/types/gds.ts` - Paths convert to existing `Polygon` type
- `src/lib/renderer/rendering/GDSRenderer.ts` - Already handles polygons
- `src/lib/renderer/viewport/ViewportManager.ts` - Works with any polygon
- `src/stores/layerStore.ts` - Layer tracking happens during parsing
- Statistics, bounding boxes, spatial indexing - All work with converted polygons

## Implementation Strategy

### Incremental Approach

**Step 1: Flush caps only (pathtype 0)**
- Simplest case: square ends at path endpoints
- Gets layer 24 visible immediately
- Estimated: 3 hours

**Step 2: Extended caps (pathtype 2)**
- Trivial extension of flush caps
- Estimated: 30 minutes

**Step 3: Round caps (pathtype 1)**
- Requires arc approximation
- Estimated: 1 hour

**Step 4: Custom caps (pathtype 4)**
- Use BGNEXTN/ENDEXTN values (already parsed)
- Deferred to future work

### Testing Plan

1. **Unit tests:**
   - Single-segment path with each pathtype
   - Multi-segment path with corners
   - Zero-width path (degenerate)
   - Single-point path (degenerate)

2. **Integration test:**
   - Load TLS08C_20220725.gds
   - Verify 77,220 paths on layer 24 convert successfully
   - Verify layer 24 appears in layer list
   - Verify layer 24 renders on canvas
   - Compare visual output with gdstk/KLayout

3. **Performance test:**
   - Measure parse time increase
   - Verify no memory issues with 77K path conversions
   - Check polygon count in statistics

## Complexity Estimate

| Component | Lines | Complexity | Time |
|-----------|-------|------------|------|
| State variables | 5 | Trivial | 5 min |
| Record handlers | 25 | Easy | 25 min |
| pathToPolygon() | 150 | Medium | 2-3 hrs |
| ENDEL handler | 40 | Easy | 30 min |
| Testing/debugging | N/A | Medium | 1-2 hrs |
| **Total** | **220** | **Medium** | **4-6 hrs** |

## Expected Impact

**Fixes:**
- Layer 24 in TLS08C_20220725.gds (77,220 paths) becomes visible
- All path-based geometry in GDSII files supported
- Photonic circuits, PCB layouts, metal routing now render correctly

**Performance:**
- One-time conversion cost during parsing
- No runtime overhead (paths become polygons)
- 77K paths in ~1-2 seconds (estimated)

**Compatibility:**
- No breaking changes to existing code
- Paths transparently convert to polygons
- All downstream systems unchanged

## Implementation Status

**Completed (2025-12-13):**

1. Phase 1: Parser state extension - DONE
   - Added `currentPath`, `currentPathWidth`, `currentPathType` state variables
   - Location: GDSParser.ts line 735-745

2. Phase 2: Record handlers - DONE
   - Added PATH handler
   - Added WIDTH handler
   - Added PATHTYPE handler
   - Updated LAYER handler to set currentPath.layer
   - Updated DATATYPE handler to set currentPath.datatype
   - Updated XY handler to handle path points

3. Phase 3: Path-to-polygon conversion - DONE
   - Created separate module `src/lib/gds/pathToPolygon.ts` (287 lines)
   - Exported `pathToPolygon()` function with clean API
   - Supports all three pathtypes:
     - Pathtype 0 (flush): Square ends at path endpoints
     - Pathtype 1 (round): Semicircle caps with 8-segment approximation
     - Pathtype 2 (extended): Square ends extending by halfWidth
     - Pathtype 4 (custom): Falls back to flush with warning
   - Handles edge cases: zero-width paths, single-point paths
   - Uses miter joins for corners
   - Helper functions: `calculatePerpendicular()`, `generateStartCap()`, `generateEndCap()`

4. Phase 4: ENDEL handler - DONE
   - Added path completion logic in GDSParser.ts
   - Converts path to polygon using imported pathToPolygon()
   - Adds converted polygon to cell.polygons[]
   - Tracks layer in layers Map
   - Increments polygonCount
   - Debug logging for conversion details

**Code organization:**
- Refactored path conversion logic into separate module for better maintainability
- GDSParser.ts: 1,216 lines (down from 1,441 lines before refactoring)
- pathToPolygon.ts: 287 lines (new module)
- Clean separation of concerns: parser handles records, pathToPolygon handles geometry

**Testing:**
- Created comprehensive test suite: `tests/gds/pathToPolygon.test.ts`
- 10 test cases covering:
  - Edge cases (empty paths, zero-width paths)
  - All pathtype modes (flush, round, extended, custom)
  - Complex multi-segment paths
  - Polygon closure verification
- All tests passing (94 total tests in project)

**Total changes:**
- Files modified: `src/lib/gds/GDSParser.ts`
- Files created: `src/lib/gds/pathToPolygon.ts`, `tests/gds/pathToPolygon.test.ts`
- Net lines added: ~52 lines to parser, 287 lines in new module, 161 lines of tests
- Implementation time: ~2 hours (including refactoring and testing)

## Testing and Bug Fix

**Initial Issue (2025-12-13):**
Layer 24 not appearing despite PATH support implementation. Console showed:
```
[pathToPolygon] Zero-width path, returning centerline
[GDSParser] Skipping degenerate path with 2 outline points in cell TOP
```

**Root Cause:**
All 77,220 paths on layer 24 have **zero width** (width=0 in GDS file). The initial implementation rejected zero-width paths as degenerate.

**Fix Applied:**
1. Modified `pathToPolygon()` to return centerline for zero-width paths (polylines)
2. Updated parser to accept 2-point polylines (changed threshold from 3 to 2 points)
3. Updated renderers (GDSRenderer and MinimapRenderer) to:
   - Detect polylines (2 points)
   - Render as stroked lines instead of filled polygons
   - Skip `closePath()` for polylines
4. Updated tests to verify polyline behavior

**Files Modified (Bug Fix):**
- `src/lib/gds/pathToPolygon.ts`: Return centerline for zero-width paths
- `src/lib/gds/GDSParser.ts`: Accept 2-point polylines
- `src/lib/renderer/rendering/GDSRenderer.ts`: Render polylines as lines
- `src/lib/renderer/MinimapRenderer.ts`: Render polylines as lines
- `tests/gds/pathToPolygon.test.ts`: Updated tests for polyline behavior

**Status:** Fixed - All tests passing (94/94)

**Next Steps:**
1. User to test with TLS08C_20220725.gds to verify layer 24 appears
2. Verify visual correctness of path rendering
3. Check performance with 77K paths



