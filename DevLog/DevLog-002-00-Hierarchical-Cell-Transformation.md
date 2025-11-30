# Hierarchical Cell Transformation Bug

**Date:** 2025-11-30
**Status:** In Progress
**Issue:** https://github.com/jwt625/gdsjam/issues/39

## Problem Statement

GDS files with hierarchical cell structures (cells containing references to other cells with transformations) are not rendering correctly. The spiral test file created with gdsfactory shows all cell instances at the same location instead of being properly transformed and positioned.

## Test Cases

### test.log (Working - Flattened Structure)
- Single "TOP" cell with 3021 polygons
- No cell references, all geometry is flattened
- Renders correctly in gdsjam

### test_spiral.log (Broken - Hierarchical Structure)
- 18 cells with hierarchical structure
- Top cells: `$$$CONTEXT_INFO$$$` (1 polygon, 16 instances) and `chip` (0 polygons, 1 instance)
- `chip` → `spiral_...` (0 polygons, 54 instances) → bend/straight cells (1 polygon each)
- Total: 16 polygons, 71 instances
- Renders correctly in KLayout but not in gdsjam
- Expected: ~54 polygons rendered (from spiral instances)
- Actual: 124 polygons rendered (includes 16 context info instances + duplicates)

## Root Cause Analysis

### Initial Investigation

The GDSRenderer was using simple addition for cell instance positioning instead of applying proper geometric transformations:

```typescript
// WRONG (original code)
const newX = x + instance.x;
const newY = y + instance.y;
```

GDS transformation order requires: mirror, rotate, magnify, then translate. The correct formula is:

```typescript
// CORRECT
const rad = (rotation * Math.PI) / 180;
const cos = Math.cos(rad);
const sin = Math.sin(rad);
const mx = mirror ? -1 : 1;
const newX = x + (instance.x * cos * mx - instance.y * sin) * magnification;
const newY = y + (instance.x * sin * mx + instance.y * cos) * magnification;
```

### Secondary Issue: Container vs Point Transformation

After fixing the transformation formula, cells were still rendering incorrectly. The issue was that GDSRenderer was applying transformations to PixiJS containers (position, rotation, scale properties) while also calculating transformed positions. This caused double-transformation.

The MinimapRenderer uses a different approach: it transforms each polygon point directly to world coordinates without using container transformations. This is the correct approach for a flattened hierarchy.

## Solution

### 1. Transform Polygon Points Directly

Modified `addPolygonToGraphics` to accept transformation parameters and transform each point:

```typescript
private addPolygonToGraphics(
    graphics: Graphics,
    polygon: Polygon,
    colorHex: string,
    strokeWidthDB: number,
    fillMode: boolean,
    x: number,
    y: number,
    rotation: number,
    mirror: boolean,
    magnification: number,
): void {
    // Transform each point using transformPoint()
    const firstPt = this.transformPoint(
        polygon.points[0].x,
        polygon.points[0].y,
        x, y, rotation, mirror, magnification
    );
    graphics.moveTo(firstPt.x, firstPt.y);
    // ... transform remaining points
}
```

### 2. Transform Bounding Boxes

Added `transformBoundingBox` method to correctly calculate tile coordinates and spatial index bounds:

```typescript
private transformBoundingBox(
    bbox: BoundingBox,
    x: number, y: number,
    rotation: number, mirror: boolean, magnification: number
): BoundingBox {
    // Transform all 4 corners and find new bounds
    const corners = [
        this.transformPoint(bbox.minX, bbox.minY, x, y, rotation, mirror, magnification),
        // ... other corners
    ];
    // Return new bounding box
}
```

### 3. Remove Container Transformations

Removed position/rotation/scale from cell containers since transformations are now baked into polygon coordinates:

```typescript
// Create container without transformations
const cellContainer = new Container();
// No cellContainer.x, cellContainer.y, cellContainer.rotation, etc.
```

### 4. Skip Context Info Cells

Added check to skip rendering instances for `$$$CONTEXT_INFO$$$` cells (library reference holders):

```typescript
const isContextCell = cell.name.includes("CONTEXT_INFO");
if (maxDepth > 0 && remainingBudget > 0 && !isContextCell) {
    // Render instances
}
```

## Debug Attempts

1. Added transformation formula to instance position calculation
2. Added recursive bounding box calculation in parser
3. Implemented hierarchical file detection (start at depth=3 instead of 0)
4. Removed excessive console logging that was creating unmanageable log files
5. Added context cell filtering to reduce polygon count from 124 to expected ~54

## Current Status

Code changes implemented but rendering still incorrect. Need to verify:
- Context cell filtering is working (should see "SKIPPING context cell" message)
- Polygon transformations are being applied correctly
- Spatial index bounds are correct

## Files Modified

- `src/lib/renderer/rendering/GDSRenderer.ts`: Transform polygon points, add transformBoundingBox, skip context cells
- `src/lib/renderer/MinimapRenderer.ts`: Skip context cells
- `src/lib/gds/GDSParser.ts`: Recursive bounding box calculation
- `src/lib/renderer/PixiRenderer.ts`: Hierarchical file detection

## Debug Session 2025-11-30 (Continued)

### Code Review Findings

Reviewed all transformation code in detail:

1. **Instance Position Transformation** (GDSRenderer.ts:343-344)
   - Formula: `newX = x + (instance.x * cos * mx - instance.y * sin) * magnification`
   - This correctly applies parent's rotation/mirror/mag to instance position
   - For simple case (no rotation): `newX = x + instance.x`

2. **Polygon Point Transformation** (GDSRenderer.ts:449-450)
   - Formula: `rx = (px * cos * mx - py * sin) * magnification + x`
   - This correctly transforms each polygon point to world coordinates
   - For simple case: `rx = px + x`

3. **Bounding Box Transformation** (GDSRenderer.ts:458-487)
   - Transforms all 4 corners and finds new bounds
   - Used for tile calculation and spatial indexing

4. **Parser Instance Reading** (GDSParser.ts:575-611)
   - Reads XY, STRANS, MAG, ANGLE records correctly
   - Defaults: x=0, y=0, rotation=0, mirror=false, magnification=1.0

### Transformation Math Verification

For test_spiral.gds with instance at (-10, 10):
```
Top cell "chip" at (0, 0, rot=0, mir=false, mag=1)
  → Instance "spiral" at (0, 0)
    → Instance "bend_euler" at (-10, 10)
      → Polygon point (0, -0.25)

Expected transformation:
  newX = 0 + (-10 * 1 * 1 - 10 * 0) * 1 = -10
  newY = 0 + (-10 * 0 * 1 + 10 * 1) * 1 = 10

  rx = (0 * 1 * 1 - (-0.25) * 0) * 1 + (-10) = -10
  ry = (0 * 0 * 1 + (-0.25) * 1) * 1 + 10 = 9.75

Result: Polygon should be at (-10, 9.75)
```

The math is correct! So why are cells at the wrong location?

### Added Debug Logging

Added targeted debug logging to identify the issue:

1. **GDSParser.ts:571-574** - Log first 10 non-zero instance positions during parsing
2. **GDSRenderer.ts:78** - Log top cell names with polygon/instance counts
3. **GDSRenderer.ts:331-332** - Log cell instance rendering (for cells with ≤10 instances)
4. **GDSRenderer.ts:354-356** - Log instance transformation calculations
5. **GDSRenderer.ts:420-422** - Log polygon point transformations (for 4-point polygons)

### Debugging Strategy

Run the dev server and load test_spiral.gds. Check console for:

1. **Parser output**: Are instance positions being read correctly?
   - Look for: `[GDSParser] Instance X: ... at (x, y)`
   - Expected: Non-zero positions like (-10, 10), (-20, 20), etc.

2. **Top cells**: Which cells are being rendered?
   - Look for: `[GDSRenderer] Found N top-level cells: ...`
   - Expected: `$$$CONTEXT_INFO$$$ (1p, 16i), chip (0p, 1i)`

3. **Instance transformations**: Are transformations being calculated?
   - Look for: `[GDSRenderer] Cell X has N instances at (x, y)`
   - Look for: `Instance X at (x1, y1) → (x2, y2)`
   - Expected: Different output positions for each instance

4. **Polygon rendering**: Are polygons being drawn at transformed positions?
   - Look for: `Polygon L1:0 at (x, y): [px, py] → [rx, ry]`
   - Expected: Different positions for each polygon

### Possible Issues to Investigate

If transformations are NOT being applied:
- Check if `maxDepth` is 0 (instances wouldn't be rendered)
- Check if hierarchical detection is working (should set depth=3)
- Check if context cell filtering is too aggressive

If transformations ARE being applied but cells still overlap:
- Check if there's a coordinate system mismatch (units, Y-axis flip)
- Check if PixiJS container transformations are interfering
- Check if viewport/camera is not showing the full extent

## Test Results (from tmp.log)

### Key Findings

1. **Context cell filtering is working**
   - Line 90: `[GDSRenderer] SKIPPING context cell: $$$CONTEXT_INFO$$$ (16 instances)`

2. **Hierarchical detection is working**
   - Line 85: `[Render] Hierarchical file detected (17 instances, 1 polygons in top cells), starting at depth 3`

3. **Top cells are correct**
   - Line 87: `[GDSRenderer] Found 2 top-level cells: $$$CONTEXT_INFO$$$ (1p, 16i), chip (0p, 1i)`

4. **Instance rendering at depth=3**
   - Line 99: Rendered 18 cells including `bend_euler` (28 instances)
   - Line 97: `55 polygons in 55 tiles`

5. **THE BUG: Instance position is (0, 0)**
   - Line 95: `Instance spiral_... at (0, 0) → (0.00, 0.00)`
   - The `chip` cell's instance to `spiral` is at `(0, 0)` - this is CORRECT per test_spiral.log
   - But we need to see the `spiral` cell's 54 instances to verify THEIR positions

### Analysis

The log shows that at depth=3, we rendered 55 polygons from 18 cells, which is correct. But we're not seeing the debug output for the `spiral` cell's instances because the logging was limited to cells with ≤10 instances.

The `spiral` cell has 54 instances, so we need to see if those instances have the correct positions `(-10, 10)`, `(-20, 20)`, etc.

### Updated Debug Logging

Added more comprehensive logging:
1. **GDSRenderer.ts:332-340** - Log first 5 instances for ALL cells (not just ≤10)
2. **GDSParser.ts:710-720** - Log first 5 instances of spiral cell after parsing

## Second Test Results (from tmp.log - updated)

### ROOT CAUSE FOUND

Lines 21-25 show the parsed instance positions:
```
GDSParser.ts:717   Instance 0: bend_euler_... at (0, 0) rot=180 mir=true
GDSParser.ts:717   Instance 1: bend_euler_... at (0, 0) rot=90 mir=false
GDSParser.ts:717   Instance 2: bend_euler_... at (0, 0) rot=180 mir=false
GDSParser.ts:717   Instance 3: bend_euler_... at (0, 0) rot=270 mir=false
GDSParser.ts:717   Instance 4: straight_... at (0, 0) rot=270 mir=false
```

**ALL INSTANCES ARE BEING PARSED WITH POSITION (0, 0)!**

But from test_spiral.log, they should be:
- Instance 0: `(0, 0)` (correct)
- Instance 1: `(0, 0)` (correct)
- Instance 2: `(-10, 10)` (parsed as 0, 0 - wrong)
- Instance 3: `(-20, 20)` (parsed as 0, 0 - wrong)
- Instance 4: `(-30, 7)` (parsed as 0, 0 - wrong)

**The bug is in the GDS parser's XY record handling for instances.**

### Investigation

The XY parsing code (lines 521-549) looks correct:
- It checks for nested array format `[[x, y]]` or flat format `[x, y]`
- It assigns `currentInstance.x` and `currentInstance.y`

Possible issues:
1. XY record comes AFTER ENDEL (wrong order)
2. XY data format is different than expected
3. currentInstance is null when XY is processed

### Added Detailed Logging

Added logging to track the record sequence for first 5 instances:
1. **SREF record** - When instance starts
2. **SNAME record** - When cell reference is set
3. **XY record** - When position is parsed (with raw data)
4. **ENDEL record** - When instance is finalized

This will show us exactly what's happening during parsing.

## Third Test Results (from tmp.log - updated again)

### CRITICAL FINDING: XY Records Are Missing

The record sequence shows:
```
Line 19: SREF record: Starting instance 0
Line 20: SNAME record: cellRef="straight_..."
Line 21: ENDEL record: Finalizing instance 0 at (0, 0)
```

**There is NO XY record between SNAME and ENDEL!**

Expected sequence:
1. SREF (start instance)
2. SNAME (cell reference)
3. **XY (position)** ← MISSING!
4. ENDEL (end element)

This means either:
1. The XY record is not in the file for instances (unlikely - KLayout renders it correctly)
2. The XY record is being skipped/ignored by the parser
3. The XY record has a different format that doesn't match our logging conditions

### Updated Logging

Added comprehensive XY record logging to show:
- Whether currentPolygon or currentInstance is set
- Data type (array vs other)
- Raw data content

This will reveal if XY records are being parsed at all, and what their data looks like.

## Fourth Test Results - ROOT CAUSE IDENTIFIED

### The Bug

Looking at the XY record logs:
```
Line 22: XY record: currentPolygon=false, currentInstance=true, data type=array, data=[[0,0]]
Line 26: XY record: currentPolygon=false, currentInstance=true, data type=array, data=[[0,0]]
```

The XY data format is `[[0,0]]` - a **single nested array**, not `[0, 0]` (two elements).

**The bug was in line 538 of GDSParser.ts:**
```typescript
} else if (currentInstance && Array.isArray(data) && data.length >= 2) {
```

This condition requires `data.length >= 2`, but for instances, the data is `[[x, y]]` which has `length = 1`!

So the condition was FALSE, and we never entered the block to set `currentInstance.x` and `currentInstance.y`. They remained at their default values of `0`.

### The Fix

Changed the condition from `data.length >= 2` to `data.length >= 1`, and properly handle both formats:

```typescript
} else if (currentInstance && Array.isArray(data) && data.length >= 1) {
    // For instances, XY contains the position
    // Check if it's nested array format [[x, y]] or flat format [x, y]
    if (Array.isArray(data[0]) && data[0].length >= 2) {
        // Nested array format: [[x, y]]
        currentInstance.x = data[0][0];
        currentInstance.y = data[0][1];
    } else if (data.length >= 2) {
        // Flat array format: [x, y]
        currentInstance.x = data[0];
        currentInstance.y = data[1];
    }
}
```

This now correctly handles:
- Nested format: `[[x, y]]` (what the gdsii library actually returns)
- Flat format: `[x, y]` (for compatibility)

## Fifth Test Results - Position Fix Verified

### Status: Mostly Working

After fixing the XY parsing bug, the spiral pattern now renders correctly with cells at their proper positions.

**Working:**
- Instance positions are parsed correctly
- Cells are positioned correctly in the spiral pattern
- Minimap shows all straight segments (after fixing skipInMinimap logic)

**Remaining Issue:**
- One bend instance has incorrect rotation (180 degrees wrong)
- The same rotation issue appears in both main viewport and minimap

### Minimap skipInMinimap Fix

Fixed the logic for skipping small cells in minimap. Changed from OR to AND:

```typescript
// Before (wrong): Skip if small in EITHER dimension
cell.skipInMinimap =
    cellWidth < MINIMAP_SKIP_THRESHOLD * layoutExtentX ||
    cellHeight < MINIMAP_SKIP_THRESHOLD * layoutExtentY;

// After (correct): Skip only if small in BOTH dimensions
cell.skipInMinimap =
    cellWidth < MINIMAP_SKIP_THRESHOLD * layoutExtentX &&
    cellHeight < MINIMAP_SKIP_THRESHOLD * layoutExtentY;
```

This fixed the missing straight segments in the minimap.

### Rotation Issue Investigation

Attempted fixes that did NOT work:
1. Changing transformation order to mirror → rotate → magnify → translate (reverted)
2. Negating child rotation when parent is mirrored (reverted)

All transformation changes were reverted. The current code uses the original working formula:

```typescript
const rad = (rotation * Math.PI) / 180;
const cos = Math.cos(rad);
const sin = Math.sin(rad);
const mx = mirror ? -1 : 1;
const newX = x + (instance.x * cos * mx - instance.y * sin) * magnification;
const newY = y + (instance.x * sin * mx + instance.y * cos) * magnification;
const newRotation = rotation + instance.rotation;
const newMirror = mirror !== instance.mirror;
```

This formula correctly positions all cells but one bend has wrong rotation.

## Current Status

**Fixed:**
- XY record parsing for instances (data.length >= 1 instead of >= 2)
- Minimap skipInMinimap logic (AND instead of OR)
- Instance position transformation (working correctly)

**Remaining:**
- One bend instance has incorrect rotation (180 degrees off)
- Need to investigate rotation/mirror transformation logic

### Rotation Issue Analysis

**Problem:** Two bend instances at (0, 0), one is correct and one is 180 degrees off:
- Instance 0: rot=180, mir=true (wrong orientation)
- Instance 6: rot=0, mir=false (correct orientation)

**GDS Mirror Specification:**
- Mirror (x_reflection) only mirrors across the X-axis
- It flips the Y coordinate: (x, y) becomes (x, -y)
- Mirror is NOT the same as rotating 180 degrees
- Mirror + rotation is different from just rotation

**Root Cause:**
The transformation formula was applying mirror DURING rotation instead of BEFORE rotation:

```typescript
// WRONG: Applies mirror during rotation
const mx = mirror ? -1 : 1;
const rx = (px * cos * mx - py * sin) * magnification + x;
const ry = (px * sin * mx + py * cos) * magnification + y;
```

The GDS spec requires transformations in this order: mirror → rotate → magnify → translate

**The Fix:**
Separated the transformation steps to apply mirror before rotation:

```typescript
// CORRECT: Apply mirror first, then rotate
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
```

This fix was applied to both:
- `GDSRenderer.transformPoint()` - for main viewport polygon rendering
- `MinimapRenderer.transformPoint()` - for minimap polygon rendering

## Final Status

**All Issues Resolved:**

1. **XY record parsing** - Fixed by changing condition from `data.length >= 2` to `data.length >= 1` to handle nested array format `[[x, y]]`

2. **Minimap skipInMinimap logic** - Fixed by changing from OR to AND (skip only if small in BOTH dimensions)

3. **Rotation with mirror** - Fixed by applying mirror BEFORE rotation instead of during rotation

**Test Results:**
- All cell instances are positioned correctly
- All cell instances have correct rotation and orientation
- Minimap shows all segments correctly
- Both main viewport and minimap render identically to KLayout

## Files Modified

- `src/lib/gds/GDSParser.ts`: XY record parsing fix, skipInMinimap logic fix
- `src/lib/renderer/rendering/GDSRenderer.ts`: transformPoint method fix
- `src/lib/renderer/MinimapRenderer.ts`: transformPoint method fix

