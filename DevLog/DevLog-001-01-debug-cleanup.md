# Debug Console Log Cleanup

## Date: 2025-11-22

---
**⚠️ CRITICAL CONSTRAINT: NEVER ENABLE BROADCASTCHANNEL**
- `filterBcConns` MUST always be `true` in y-webrtc configuration
- BroadcastChannel causes issues with file sync and session state
- Always force WebRTC connections even for same-browser tabs
---

## Objective
Clean up debug console logs in the renderer to focus on what we currently need to check for the LOD rendering system.

## Changes Made

### 1. Removed Verbose Debug Logs

**Removed from `performViewportUpdate()`:**
- Viewport bounds and zoom level logging (was logging every viewport update)
- Spatial query results logging (was logging every viewport update)
- Sample visible item logging (was logging every viewport update)

**Removed from `updateZoomThresholds()`:**
- Zoom threshold update logging (was logging every threshold update)

**Removed from `triggerLODRerender()`:**
- "Already re-rendering" message
- "LOD change on cooldown" message
- Detailed LOD check logging
- "Increasing/Decreasing depth" messages
- "No depth change needed" message

**Removed from `getViewportBounds()`:**
- Occasional viewport bounds calculation logging (5% sample rate)

**Removed from `renderGDSDocument()`:**
- Initial document info logging (cells, layers, top cells)
- Progress percentage logging for each step
- Top cell rendering info logging

**Removed from `renderCellGeometry()`:**
- Cell geometry rendering start logging
- Budget exhausted logging
- Spatial tiles rendering summary logging

**Removed from `getPerformanceMetrics()`:**
- Occasional metrics logging (10% sample rate)

### 2. Added Focused Debug Logs

**Added to `performViewportUpdate()`:**
```typescript
console.log(
    `[LOD] Zoom threshold crossed: ${currentZoom.toFixed(4)}x (thresholds: ${this.zoomThresholdLow.toFixed(4)}x - ${this.zoomThresholdHigh.toFixed(4)}x)`,
);
```

**Added to `triggerLODRerender()`:**
```typescript
console.log(
    `[LOD] Depth change: ${this.currentRenderDepth} → ${newDepth} (utilization: ${(utilization * 100).toFixed(1)}%, visible: ${metrics.visiblePolygons.toLocaleString()}/${metrics.polygonBudget.toLocaleString()})`,
);
```

**Added to `performIncrementalRerender()`:**
```typescript
console.log(`[LOD] Starting re-render at depth ${this.currentRenderDepth}`);
console.log(
    `[LOD] Re-render complete: ${this.totalRenderedPolygons.toLocaleString()} polygons in ${this.allGraphicsItems.length} tiles`,
);
```

**Added to `renderGDSDocument()`:**
```typescript
console.log(
    `[Render] Starting render: depth=${this.currentRenderDepth}, budget=${this.maxPolygonsPerRender.toLocaleString()}`,
);
console.log(
    `[Render] Complete: ${totalPolygons.toLocaleString()} polygons in ${renderTime.toFixed(0)}ms (${this.allGraphicsItems.length} tiles, depth=${this.currentRenderDepth})`,
);
```

**Added to `renderCellGeometry()` (for instance rendering):**
```typescript
console.log(
    `[Render] Cell ${cell.name}: Rendering ${cell.instances.length} instances at depth ${maxDepth}`,
);
console.log(
    `[Render] Cell ${cell.name}: Rendered ${totalPolygons - renderedPolygons} polygons from instances`,
);
```

### 3. Removed Unused Code

**Removed DEBUG import:**
- Removed `DEBUG` from imports in `PixiRenderer.ts` (no longer used after cleanup)

**Removed unused variable:**
- Removed `visibleGraphicsCount` from `performViewportUpdate()` (was only incremented, never used)

## What to Watch For

With these focused logs, you can now track:

1. **LOD Trigger Events:**
   - `[LOD] Zoom threshold crossed:` - When zoom crosses 0.2x or 2.0x threshold
   - `[LOD] Depth change:` - When LOD depth changes with utilization info

2. **Re-render Process:**
   - `[LOD] Starting re-render at depth X` - When incremental re-render starts
   - `[LOD] Re-render complete:` - When re-render finishes with polygon/tile counts

3. **Initial Render:**
   - `[Render] Starting render:` - Initial render start with depth and budget
   - `[Render] Complete:` - Render completion with timing and counts

4. **Instance Rendering (Critical for LOD):**
   - `[Render] Cell X: Rendering Y instances at depth Z` - When rendering instances
   - `[Render] Cell X: Rendered Y polygons from instances` - Instance rendering results

## Expected Console Output

**On initial load:**
```
[Render] Starting render: depth=0, budget=100,000
[Render] Complete: 100,000 polygons in 1500ms (516 tiles, depth=0)
```

**On zoom in (crossing threshold):**
```
[LOD] Zoom threshold crossed: 0.6300x (thresholds: 0.0005x - 0.0052x)
[LOD] Depth change: 0 → 1 (utilization: 0.1%, visible: 68/100,000)
[LOD] Starting re-render at depth 1
[Render] Starting render: depth=1, budget=100,000
[Render] Cell Big_Dipper_v1_3: Rendering 123 instances at depth 1
[Render] Cell Big_Dipper_v1_3: Rendered 50,000 polygons from instances
[Render] Complete: 150,000 polygons in 2000ms (1024 tiles, depth=1)
[LOD] Re-render complete: 150,000 polygons in 1024 tiles
```

## Critical Bug Found: Budget Exhaustion Prevents Instance Rendering

### Problem Identified

When testing with `Big_Dipper_v1_3.gds`:
- **Top cell:** 776,458 direct polygons + 308 instances
- **Budget:** 100,000 polygons
- **At depth 0:** Renders first 100K direct polygons, budget exhausted, **instances never rendered**
- **At depth 1:** Same issue - budget exhausted by direct polygons before reaching instances

**Console output showed:**
```
[Render] Top cell "Big_Dipper_v1_3": 776,458 polygons, 308 instances
[Render] Budget exhausted (100,000), stopping render
[Render] Complete: 100,000 polygons in 1611ms (516 tiles, depth=0)
```

**Missing:** No instance rendering logs, even at depth 1!

### Root Cause

The rendering logic processes direct polygons first, then instances:
1. Render all direct polygons (up to budget limit)
2. Calculate `remainingBudget = polygonBudget - renderedPolygons`
3. If `remainingBudget > 0` and `maxDepth > 0`, render instances

**Problem:** When a cell has many direct polygons, the budget is exhausted before step 3.

### Solution: Budget Reservation for Instances

Implemented budget reservation strategy in `renderCellGeometry()`:

- **At depth 0:** Use 100% of budget for direct polygons (no instances rendered)
- **At depth 1:** Use 50% of budget for direct polygons, reserve 50% for instances
- **At depth 2+:** Use 25% of budget for direct polygons, reserve 75% for instances

**Code change:**
```typescript
let directPolygonBudget = polygonBudget;
if (maxDepth > 0) {
    const reservationRatio = maxDepth === 1 ? 0.5 : 0.25;
    directPolygonBudget = Math.floor(polygonBudget * reservationRatio);
}
```

### Expected Behavior After Fix

**At depth 0 (initial render):**
```
[Render] Top cell "Big_Dipper_v1_3": 776,458 polygons, 308 instances
[Render] Budget exhausted (100,000), stopping render
[Render] Complete: 100,000 polygons in 1611ms (516 tiles, depth=0)
```

**At depth 1 (after zoom in):**
```
[LOD] Depth change: 0 → 1 (utilization: 0.1%, visible: 67/100,000)
[Render] Cell Big_Dipper_v1_3: Reserving budget for instances (50,000 for direct polygons, 50,000 for instances)
[Render] Cell Big_Dipper_v1_3: Direct polygon budget exhausted (50,000/776,458 rendered)
[Render] Cell Big_Dipper_v1_3: Rendering 308 instances at depth 1
[Render] Cell Big_Dipper_v1_3: Rendered 45,000 polygons from instances
[Render] Complete: 95,000 polygons in 2000ms (800 tiles, depth=1)
```

## Second Bug Found: Budget Fragmentation at Deep Hierarchies

### Problem Identified (After First Fix)

After implementing budget reservation, LOD depth increased to 3, but:
- **Total rendered polygons:** Still capped at 99,999
- **Visible polygons:** Only 164 (should be much higher when zoomed in)
- **Console logs showed:** Budget fragmented to 0-1 polygons per cell

**Example:**
```
[Render] Cell bp_HOMF_v1_2: Reserving budget for instances (0 for direct polygons, 1 for instances)
```

### Root Cause

The 100K budget was being split across the entire hierarchy:
1. Top cell (depth 3): 25K direct, 75K for 308 instances
2. Each instance gets ~243 polygons
3. Each instance splits that 243 further...
4. Eventually budget becomes 0-1 polygons per cell

**The budget was too small for deep hierarchies!**

### Solution: Scale Budget with Depth

Implemented dynamic budget scaling based on LOD depth:

| Depth | Budget | Multiplier | Rationale |
|-------|--------|------------|-----------|
| 0 | 100,000 | 1x | Safe baseline (top cell only) |
| 1 | 200,000 | 2x | One level of hierarchy |
| 2 | 400,000 | 4x | Two levels of hierarchy |
| 3+ | 800,000 | 8x | Three+ levels of hierarchy |

**Code change:**
```typescript
const budgetMultiplier = Math.pow(2, Math.min(this.currentRenderDepth, 3));
const scaledBudget = this.maxPolygonsPerRender * budgetMultiplier;
```

**Rationale:** Each level of hierarchy roughly doubles the polygon count, so we need to double the budget.

### Expected Behavior After Second Fix

**At depth 3 (zoomed in):**
```
[Render] Starting render: depth=3, budget=800,000 (8x base)
[Render] Top cell "Big_Dipper_v1_3": 776,458 polygons, 308 instances
[Render] Cell Big_Dipper_v1_3: Reserving budget for instances (200,000 for direct, 600,000 for instances)
[Render] Cell Big_Dipper_v1_3: Rendering 308 instances at depth 3
[Render] Cell Big_Dipper_v1_3: Rendered 500,000 polygons from instances
[Render] Complete: 700,000 polygons in 5000ms
```

**Performance panel should show:**
- Total Polygons: 700,000 (not 99,999!)
- Polygon Budget: 800,000 (scaled)
- Budget Usage: 87.5%

## Third Bug Found: OOM Crash from Aggressive Budget Scaling

### Problem Identified (After Second Fix)

Browser crashed with OOM (Out of Memory) error. Console logs showed:
```
[Render] Cell bp_HOMF_v1_2: Reserving budget for instances (10,901 for direct polygons, 32,705 for instances)
[Render] Cell bp_HOMF_v1_2: Reserving budget for instances (10,899 for direct polygons, 32,698 for instances)
[Render] Cell bp_HOMF_v1_2: Reserving budget for instances (10,897 for direct polygons, 32,691 for instances)
... (hundreds of times)
```

### Root Cause

The same cell was being instantiated **hundreds of times** in the hierarchy. With:
- 800K budget at depth 3
- Deep hierarchy with many repeated instances
- Each polygon creating a Graphics object

**Result:** Millions of Graphics objects created, exhausting browser memory.

### Solution: Conservative Budget Scaling

Reduced budget scaling to prevent OOM:

**Before (too aggressive):**
| Depth | Budget | Multiplier |
|-------|--------|------------|
| 0 | 100K | 1x |
| 1 | 200K | 2x |
| 2 | 400K | 4x |
| 3+ | 800K | 8x |

**After (conservative):**
| Depth | Budget | Multiplier |
|-------|--------|------------|
| 0 | 100K | 1x |
| 1 | 150K | 1.5x |
| 2 | 200K | 2x |
| 3+ | 250K | 2.5x |

**Also reduced instance budget reservation:**
- Before: 50% direct / 50% instances (depth 1), 25% / 75% (depth 2+)
- After: 70% direct / 30% instances (all depths > 0)

**Code changes:**
```typescript
const budgetMultipliers = [1, 1.5, 2, 2.5];
const budgetMultiplier = budgetMultipliers[Math.min(this.currentRenderDepth, 3)] ?? 1;
const scaledBudget = Math.floor(this.maxPolygonsPerRender * budgetMultiplier);

// More conservative instance reservation
if (maxDepth > 0) {
    directPolygonBudget = Math.floor(polygonBudget * 0.7);
}
```

### Expected Behavior After Third Fix

**At depth 3 (zoomed in):**
```
[Render] Starting render: depth=3, budget=250,000 (2.5x base)
[Render] Top cell "Big_Dipper_v1_3": 776,458 polygons, 308 instances
[Render] Cell Big_Dipper_v1_3: Reserving budget for instances (175,000 for direct, 75,000 for instances)
[Render] Cell Big_Dipper_v1_3: Rendering 308 instances at depth 3
[Render] Complete: 250,000 polygons (no OOM crash!)
```

**Performance panel should show:**
- Total Polygons: ~250,000 (safe level)
- Polygon Budget: 250,000 (capped)
- Budget Usage: ~100%
- No browser crash!

## Root Cause Analysis: Instance Explosion

### The Real Problem

The OOM crash wasn't just about budget size - it revealed a **fundamental architectural issue**:

**Current implementation:** Renders each cell's geometry **every time it's instantiated**
**Problem:** In hierarchical designs, cells can be instantiated hundreds or thousands of times

**Example hierarchy:**
```
Top Cell (depth 3)
  └─ Instance A (10 copies)
      └─ Instance B (10 copies)
          └─ Cell bp_HOMF_v1_2
```

**Result:** Cell `bp_HOMF_v1_2` is rendered **10 × 10 = 100 times**!

With your file:
- 196 unique cells
- 557 instances
- At depth 3, some cells rendered **hundreds of times**
- Each render creates new Graphics objects
- Memory explosion → OOM crash

### Proper Solution: Cell Instancing (Future Work)

The correct approach used by professional GDSII viewers:

1. **Render each unique cell ONCE** → Store as a Container
2. **Create instances** → Clone/reference the Container
3. **Apply transformations** → Position, rotate, scale the instance

**Benefits:**
- Each cell rendered once, no matter how many instances
- Massive memory savings
- Much faster rendering
- Scales to any hierarchy depth

**This requires major refactoring** - out of scope for current bug fix.

### Temporary Solution: Limit Max Depth

To prevent OOM crashes until proper cell instancing is implemented:

**Changed `LOD_MAX_DEPTH` from 10 to 2:**
```typescript
export const LOD_MAX_DEPTH = 2; // Limit to 2 to prevent instance explosion
```

**Added cell render tracking:**
```typescript
private cellRenderCounts: Map<string, number> = new Map();
```

**Console will now show:**
```
[Render] Top 10 most rendered cells:
  bp_HOMF_v1_2: 45 times
  bp_single_DBR_1611_pitch_233_v1_2: 32 times
  ...
```

This helps identify which cells are causing instance explosion.

### Expected Behavior After All Fixes

**At depth 2 (max):**
```
[Render] Starting render: depth=2, budget=200,000 (2x base)
[Render] Top cell "Big_Dipper_v1_3": 776,458 polygons, 308 instances
[Render] Complete: 200,000 polygons in 3000ms
[Render] Top 10 most rendered cells:
  bp_HOMF_v1_2: 45 times
  ...
```

**Performance panel:**
- Total Polygons: ~200,000
- Polygon Budget: 200,000
- LOD Depth: 0, 1, or 2 (capped at 2)
- No OOM crash!

## Next Steps

1. Test the application with a GDSII file
2. Zoom in and verify LOD depth increases (0 → 1 → 2, stops at 2)
3. **Check console logs for "Top 10 most rendered cells"** ← Shows instance explosion
4. **Verify no OOM crash** ← Critical!
5. Verify that previously hidden polygons appear when zooming in
6. **Future work:** Implement proper cell instancing to remove depth limit

