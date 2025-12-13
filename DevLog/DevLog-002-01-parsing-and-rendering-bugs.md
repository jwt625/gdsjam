# DevLog-002-01: GDSII Parsing and Rendering Bugs

**Date**: 2025-12-13  
**Related Issues**: #59, #39  
**Status**: Investigation

## Problem Statement

Multiple failure modes have been identified in GDSII file parsing and rendering:

1. **Silent Failure**: Complex layouts render as blank/empty despite successful parsing
2. **Explicit Parse Errors**: "Invalid record length: 0" errors after ENDLIB record
3. **Missing Geometry**: Circles, ellipses, and paths not rendered in layouts

## Test Case: Silent Failure

### File Information
- **File**: `tests/gds/test.gds`
- **Source**: gdsfactory-generated photonic circuit
- **Symptom**: File appears to parse successfully but renders nothing visible
- **Log**: `tests/gds/test.log` (gdstk parsing output)

### Analysis from gdstk Log

The log reveals the file structure:
- **186 cells** total
- **110 "Unnamed" cells** (Unnamed_100 through Unnamed_209)
- Many cells with **only references, no direct polygons**
- Top cell: `chip` (referenced by `$$$CONTEXT_INFO$$$`)

Key observations:
```
Cell: $$$CONTEXT_INFO$$$
  Polygons: 1
  Paths: 0
  Labels: 0
  References: 185
    Polygon - Layer 0, datatype 0
      Points: [[0. 0.] [0. 0.] [0. 0.] [0. 0.]]  # Degenerate polygon!
```

The context info cell has a **degenerate polygon** (all points at origin) and references all other cells.

## Root Cause Analysis

### 1. Missing PATH Support

**Critical Finding**: The GDS parser does NOT handle `PATH` records.

<augment_code_snippet path="src/lib/gds/GDSParser.ts" mode="EXCERPT">
````typescript
switch (tag) {
    case RecordType.LIBNAME:
    case RecordType.UNITS:
    case RecordType.BGNSTR:
    case RecordType.BOUNDARY:  // Handled
    case RecordType.LAYER:
    case RecordType.DATATYPE:
    case RecordType.XY:
    case RecordType.ENDEL:
    case RecordType.SREF:
    // ... but NO case for RecordType.PATH!
}
````
</augment_code_snippet>

**Impact**: Waveguides, interconnects, and other path-based geometries are **silently ignored** during parsing.

### 2. Missing Geometry Types

The parser only handles:
- [YES] `BOUNDARY` (polygons)
- [YES] `SREF` (cell references)
- [NO] `PATH` (paths with width)
- [NO] `BOX` (rectangles)
- [NO] `TEXT` (labels)
- [NO] `AREF` (array references)

### 3. Degenerate Polygon Handling

Polygons with all points at the same location (like the context info polygon) should be filtered out but currently aren't.

### 4. Invalid Record Length Error (Issue #59)

Error: "Invalid record length: 0" after ENDLIB suggests:
- File may have trailing bytes after valid GDSII data
- Parser doesn't gracefully handle end-of-file
- Need to stop parsing after ENDLIB record

## Impact Assessment

### Silent Failures
Files with primarily PATH-based geometry (photonic circuits, PCB layouts) will:
- Parse without errors
- Show statistics (cell count, etc.)
- Render as **completely blank**
- No warning to user that geometry was skipped

### Partial Rendering
Files mixing BOUNDARY and PATH will:
- Show only polygon-based geometry
- Missing all path-based features
- Appear incomplete/corrupted

## Available Record Types in gdsii Library

The `gdsii` library already parses these record types:
- `PATH` (RecordType.PATH = 2304)
- `WIDTH` (RecordType.WIDTH = 3843)
- `PATHTYPE` (RecordType.PATHTYPE = 8450)
- `BOX` (RecordType.BOX = 11520)
- `AREF` (RecordType.AREF = 2816)
- `COLROW` (RecordType.COLROW = 4866)
- `TEXT` (RecordType.TEXT = 3072)
- `STRING` (RecordType.STRING = 6406)

**The library parses them, but our code ignores them!**

## Proposed Solutions

### Phase 1: PATH Support (High Priority)

**Goal**: Convert PATH records to polygons during parsing.

PATH record structure:
```
PATH
  LAYER <layer>
  DATATYPE <datatype>
  PATHTYPE <0=flush, 1=round, 2=extended>
  WIDTH <width in DB units>
  XY <array of points>
ENDEL
```

Implementation approach:
1. Add `currentPath` state variable (similar to `currentPolygon`)
2. Handle `RecordType.PATH`, `RecordType.WIDTH`, `RecordType.PATHTYPE`
3. On `ENDEL`, convert path to polygon:
   - Calculate perpendicular offsets at each point
   - Create outline polygon based on width and pathtype
   - Handle end caps (flush/round/extended)
   - Store as regular polygon

Path-to-polygon conversion algorithm:
```typescript
function pathToPolygon(points: Point[], width: number, pathtype: number): Point[] {
    // For each segment, calculate perpendicular offset
    // Create left and right edge points
    // Handle end caps based on pathtype
    // Return closed polygon
}
```

### Phase 2: Additional Geometry Types

1. **BOX**: Simple rectangle → convert to 4-point polygon
   - BOX has 5 XY points (4 corners + closing point)
   - Directly convert to polygon

2. **AREF**: Array references → expand to multiple SREF instances
   - AREF has COLROW (columns, rows) and 3 XY points
   - XY[0] = reference point, XY[1] = column spacing, XY[2] = row spacing
   - Expand to `cols × rows` individual SREF instances

3. **TEXT**: Labels → store separately, render as overlay
   - Add `labels` array to Cell type
   - Store position, string, layer for later rendering

### Phase 3: Robustness Improvements

1. **Degenerate geometry filtering**: Skip polygons with < 3 unique points
2. **Post-ENDLIB handling**: Stop parsing after ENDLIB, ignore trailing data
3. **Unsupported record warnings**: Log when skipping unknown record types
4. **Statistics enhancement**: Report skipped geometry counts

## Detailed Analysis: test.gds Silent Failure

### File Structure
- **186 cells** total
- **Top cell**: "chip" (0 polygons, 214 references)
- **Context cell**: "$$$CONTEXT_INFO$$$" (1 degenerate polygon, 185 references at origin)
- **Geometry cells**: Various cells with 1-106 polygons each
- **No PATH records** in this file (all geometry is BOUNDARY-based)

### Hierarchy Depth
```
chip (top)
  └─ spiral_mzi_circuit_NL10_MLX150
       └─ mzi_gdsfactory...
            └─ straight_gdsfactory...
                 └─ [actual polygons]
```

The hierarchy is **4-5 levels deep**, but our default render depth for hierarchical files is only **3**.

### Root Cause 1: LOD_MAX_DEPTH Limit

<augment_code_snippet path="src/lib/config.ts" mode="EXCERPT">
````typescript
// LOD depth limits
export const LOD_MIN_DEPTH = 0;
export const LOD_MAX_DEPTH = 3; // Limit to 3 to prevent instance explosion
````
</augment_code_snippet>

The LOD system has a **hard limit of depth 3**. Even though hierarchical files start at depth 3, the LOD manager cannot increase depth beyond 3.

For test.gds with 4-5 level hierarchy:
- Initial render depth: 3 (hierarchical detection)
- LOD can increase to: 3 (hard limit)
- Actual geometry depth: 4-5
- **Result**: Geometry never rendered

### Root Cause 2: Context Cell Handling

<augment_code_snippet path="src/lib/renderer/rendering/GDSRenderer.ts" mode="EXCERPT">
````typescript
// Skip rendering instances for context info cells (they're just library references)
const isContextCell = cell.name.includes("CONTEXT_INFO");

if (maxDepth > 0 && remainingBudget > 0 && !isContextCell) {
    for (const instance of cell.instances) {
        // ... render instances recursively
    }
}
````
</augment_code_snippet>

Context cells ARE already excluded from instance rendering. However:
- The context cell's **degenerate polygon** is still rendered
- The context cell is a **top cell** (not referenced by others)
- It gets rendered at depth 3, but its instances are skipped
- This is correct behavior

### Root Cause 3: Top Cell Selection

<augment_code_snippet path="src/lib/renderer/rendering/GDSRenderer.ts" mode="EXCERPT">
````typescript
// Find top-level cells (cells that are not referenced by any other cell)
const referencedCells = new Set<string>();
for (const cell of document.cells.values()) {
    for (const instance of cell.instances) {
        referencedCells.add(instance.cellRef);
    }
}

const topCells = Array.from(document.cells.values()).filter(
    (cell) => !referencedCells.has(cell.name),
);
````
</augment_code_snippet>

For test.gds:
- **Top cells found**: "$$$CONTEXT_INFO$$$" and "chip"
- Both have 0 direct polygons
- "chip" has 214 instances at depth 1
- With maxDepth=3, we render to depth 3 from "chip"
- But actual geometry is at depth 4-5
- **Result**: Nothing rendered from "chip" cell

### Additional Issues

1. **Degenerate Polygon in Context Cell**
   - Points: `[[0,0], [0,0], [0,0], [0,0]]`
   - Currently rendered as invalid geometry (creates degenerate path)
   - Should be filtered during parsing or rendering

2. **Progress Calculation Bug**
   - Progress based on `cell.polygons.length` of top cells
   - For hierarchical files, top cells have 0 polygons
   - Division by zero → progress stuck at 0%

## Actual Root Cause (2025-12-13 Update)

### Test Results with Debug Logging

Console output when loading test.gds:
```
[GDSParser] Total cells: 186, Top cells: 1
[GDSParser] Top cells: ['$$$CONTEXT_INFO$$$']
[GDSParser]   $$$CONTEXT_INFO$$$: 1 polygons, 185 instances
[GDSRenderer] Rendering with maxDepth=3, budget=100000
[GDSRenderer] Top cells to render: 1
[GDSRenderer]   $$$CONTEXT_INFO$$$: 1 polygons, 185 instances
[GDSRenderer] Render complete: 1 polygons rendered, 1 graphics items
```

**Observed behavior**:
- Nothing visible on canvas or minimap
- Viewport zoomed in heavily on load (zoomed to degenerate polygon at origin)
- Perf panel: 1 visible polygon, 1 total polygon
- File stats: 186 cells, 416 total polygons, 702 instances
- No errors or warnings

### Corrected Root Cause Analysis

**WRONG ASSUMPTION**: The DevLog initially assumed both `$$$CONTEXT_INFO$$$` and `chip` would be detected as top cells.

**ACTUAL PROBLEM**: Only `$$$CONTEXT_INFO$$$` is detected as a top cell!

**Why this happens**:
1. `$$$CONTEXT_INFO$$$` cell has 185 references to ALL other cells (including "chip")
2. Top cell detection marks any referenced cell as "not a top cell"
3. Therefore "chip" is marked as referenced → NOT a top cell
4. Only `$$$CONTEXT_INFO$$$` is rendered (1 degenerate polygon at origin)
5. The real geometry in "chip" cell is never rendered

**Why nothing is visible**:
1. Only the context cell's 1 polygon is rendered
2. That polygon is degenerate: `[[0,0], [0,0], [0,0], [0,0]]`
3. Viewport zooms to fit this degenerate polygon (explains heavy zoom)
4. All actual geometry is in "chip" cell which isn't being rendered at all

**Conclusion**: This is NOT a depth limit issue. It's a top cell detection bug where context cells poison the reference graph.

### Fix Verification (2025-12-13)

After implementing fixes for parser and renderer:

Console output:
```
[GDSParser] Skipping degenerate polygon with 1 unique points in cell $$$CONTEXT_INFO$$$
[GDSParser] Total cells: 186, Top cells: 2
[GDSParser] Top cells: ['$$$CONTEXT_INFO$$$', 'chip']
[GDSParser]   $$$CONTEXT_INFO$$$: 0 polygons, 185 instances
[GDSParser]   chip: 0 polygons, 214 instances
[GDSRenderer] Rendering with maxDepth=3, budget=100000
[GDSRenderer] Top cells to render: 1
[GDSRenderer]   chip: 0 polygons, 214 instances
```

**Result**: RENDERING WORKS
- Minimap renders correctly
- Canvas shows geometry
- Context cell excluded from rendering
- Degenerate polygon filtered

**Status**: First rendering bug FIXED

## Next Steps

### Immediate Fixes (High Priority)

1. [DONE] Copy test files to `tests/gds/`
2. [DONE] Document findings in DevLog
3. [DONE] Analyze renderer code
4. [DONE] **Fix top cell detection** in `src/lib/gds/GDSParser.ts`
   - Exclude references FROM context cells when building referenced cells set
   - Pattern: cells with `CONTEXT_INFO` in name or starting with `$$$`
   - This allows "chip" to be detected as a top cell
5. [DONE] **Filter degenerate polygons** during parsing in `src/lib/gds/GDSParser.ts`
   - Check if polygon has < 3 unique points
   - Skip adding to cell.polygons array
6. [DONE] **Fix renderer top cell detection** in `src/lib/renderer/rendering/GDSRenderer.ts`
   - Apply same context cell exclusion logic as parser
   - Exclude context cells from final top cells list to prevent rendering them
7. [DONE] Test with test.gds to verify rendering - CONFIRMED WORKING
8. [TODO] **IF STILL NOT RENDERING**: Increase LOD_MAX_DEPTH from 3 to 6-8 in `src/lib/config.ts`
   - Only do this if top cell fix doesn't solve the problem
   - Current: `export const LOD_MAX_DEPTH = 3;`
   - Proposed: `export const LOD_MAX_DEPTH = 8;`
   - Rationale: gdsfactory files have 4-5 level hierarchies
9. [TODO] **IF STILL NOT RENDERING**: Increase initial hierarchical depth from 3 to 5 in `src/lib/renderer/PixiRenderer.ts`
   - Only do this if needed after testing
   - Current: `this.currentRenderDepth = isHierarchical ? 3 : 0;`
   - Proposed: `this.currentRenderDepth = isHierarchical ? 5 : 0;`
   - Rationale: Start deeper to show content immediately
10. [TODO] **Fix progress calculation** for hierarchical files in `src/lib/renderer/rendering/GDSRenderer.ts`
   - Current: Uses `cell.polygons.length` (0 for hierarchical top cells)
   - Proposed: Count total polygons recursively or use instance count

### Medium Priority

11. [TODO] Implement PATH record parsing
12. [TODO] Add PATH-to-polygon conversion
13. [TODO] Fix post-ENDLIB parsing (Issue #59)
14. [TODO] Add BOX and AREF support

### Low Priority

15. [TODO] Update statistics to show skipped geometry
16. [TODO] Add warnings for unsupported record types

## Summary

### Confirmed Issues

1. **Context Cell Top Cell Detection Bug** - CRITICAL: Context cells poison the reference graph, preventing real top cells from being detected
2. **Degenerate Geometry** - Not filtered, causes rendering artifacts and viewport zoom issues
3. **Missing PATH Support** - Critical for photonic/PCB layouts (separate issue)
4. **Possibly Insufficient Render Depth** - May cause issues on deep hierarchies (needs testing after top cell fix)
5. **Post-ENDLIB Parsing** - Causes explicit errors (Issue #59)

### Quick Wins

The test.gds silent failure is fixed by:
1. [DONE] Excluding context cells from top cell detection (allows "chip" to be detected)
2. [DONE] Filtering degenerate polygons (prevents viewport zoom to origin)
3. [DONE] Excluding context cells from renderer's top cell list (prevents rendering them)
4. [TODO] Testing to verify - if still not rendering, then increase depth limits

These changes require minimal code and should fix the most visible user-facing issue.

### Long-term Solutions

PATH support is essential for:
- Photonic circuits (waveguides)
- PCB layouts (traces)
- Any design using path-based geometry

This requires more substantial implementation but is critical for compatibility.

## Development Guidelines and Coding Standards

### Documentation Standards

**CRITICAL**: NO EMOJIS IN DEVLOGS OR ANY DOCUMENTATION.

#### Rules
1. **NEVER** use emojis (checkmarks, boxes, symbols, etc.) in DevLogs
2. Use plain text markers: [DONE], [TODO], [IN PROGRESS], [SKIPPED]
3. Use plain text for status: YES/NO, PASS/FAIL, COMPLETE/INCOMPLETE
4. Keep documentation professional and text-only

### Debug Logging System

**CRITICAL**: Module-specific debug flags must be used for all debug logging.

#### Setup (Completed)
- Created `src/lib/debug.ts` with module-specific flags
- All flags default to `false` in code
- Flags enabled via `.env.local` (NOT committed to git)
- `.env.example` documents available flags (all commented out)

#### Available Debug Flags
```typescript
// src/lib/debug.ts
export const DEBUG_PARSER = import.meta.env.VITE_DEBUG_PARSER === "true" || false;
export const DEBUG_RENDERER = import.meta.env.VITE_DEBUG_RENDERER === "true" || false;
export const DEBUG_LOD = import.meta.env.VITE_DEBUG_LOD === "true" || false;
export const DEBUG_VIEWPORT = import.meta.env.VITE_DEBUG_VIEWPORT === "true" || false;
export const DEBUG_COLLABORATION = import.meta.env.VITE_DEBUG_COLLABORATION === "true" || false;
```

#### Usage Pattern
```typescript
import { DEBUG_PARSER } from "../debug";

if (DEBUG_PARSER) {
    console.log('[GDSParser] Debug message here');
}
```

#### Rules
1. **NEVER** use global `DEBUG` flag from `config.ts`
2. **NEVER** commit `.env.local` to git
3. **ALWAYS** wrap console.log in module-specific flag check
4. **NEVER** leave debug logs enabled in production
5. All flags must default to `false` in code
6. Flags are enabled ONLY in `.env.local` for local development

#### Rationale
- Previous global DEBUG flag flooded production with logs
- Took one full day to clean up the mess
- Module-specific flags allow targeted debugging
- Explicit opt-in prevents accidental production logging

### Package Management

**CRITICAL**: Always use package managers, never manually edit package files.

#### Rules
1. **ALWAYS** use `pnpm` (this project's package manager)
2. **NEVER** manually edit `package.json` for dependencies
3. Use `pnpm add <package>` to install
4. Use `pnpm remove <package>` to uninstall
5. Only edit `package.json` for scripts, config, or metadata

#### Rationale
- Package managers handle version resolution
- Prevent dependency conflicts
- Automatically update lock files
- AI models may hallucinate incorrect versions

### Scope and File Creation

**CRITICAL**: Minimize unsolicited file creation and documentation.

#### Rules
1. Do what has been asked; nothing more, nothing less
2. **NEVER** create files unless absolutely necessary
3. **ALWAYS** prefer editing existing files over creating new ones
4. **NEVER** proactively create documentation files (*.md) unless explicitly requested
5. **NEVER** create README files unless explicitly requested
6. **NEVER** summarize actions in files unless explicitly requested

### Completeness and Downstream Changes

**CRITICAL**: After every edit, find ALL downstream changes needed.

#### Rules
1. After **EVERY** edit, use `codebase-retrieval` to find downstream changes
2. Find ALL callers and call sites affected by API changes
3. Find ALL implementations of changed interfaces/abstract methods
4. Find ALL subclasses that need updates
5. Update existing tests affected by changes
6. **NEVER** create new test files unless explicitly requested
7. Update type definitions, interfaces, schemas
8. Update import statements
9. Update configuration files

#### Rationale
- Missing related changes is a critical failure
- Incomplete changes break the codebase
- Tests must stay in sync with code changes

### Project-Specific Conventions

#### Mobile-First Design
- Mobile is first-class citizen
- All UI must work on mobile

#### No Animations
- **ALWAYS** use instant/immediate transitions
- **NO** animations for viewport navigation, jumps, or UI transitions
- Animation is explicitly unwanted ("adiabatic murdering")

#### Collaboration Architecture
- HOST uses localStorage as ground truth (survives refresh)
- VIEWERS use Y.js as ground truth (defer to host)
- Without session: pure frontend-only viewer, no server communication
- **ALWAYS** have a host - check every tick, auto-claim if no host exists
- Host transfers buffered, update only at next tick (not immediately)

#### LOD Rendering Strategy
- Prefer polygon-count-based and performance-based strategies
- **NOT** zoom-level-based (zoom is arbitrary, not calibrated)
- Zoom limits based on scale bar: 1 nm (max zoom in) to 1 m (max zoom out)

#### WebRTC Configuration
- `filterBcConns` in `y-webrtc` must **ALWAYS** be `true`
- Forces communication and file transfer with signaling server

#### Example File Hosting
- Prefer Hugging Face repos over GitHub raw URLs
- Hugging Face is more open and flexible for file loading
- GitHub has more constraints

## References

- GDSII Spec: PATH records have LAYER, DATATYPE, WIDTH, PATHTYPE, XY
- gdstk handles: BOUNDARY, PATH, BOX, TEXT, SREF, AREF
- Issue #59: Parse error after ENDLIB
- Issue #39: Spiral rendering bug (may be PATH-related)
- gdsfactory context cells: Special cells with `$$$` prefix/suffix
- Test files: `tests/gds/test.gds`, `tests/gds/test.log`

