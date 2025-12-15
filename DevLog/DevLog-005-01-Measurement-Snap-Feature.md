# DevLog-005-01: Measurement Snap-to-Axis Feature

**Date**: 2025-12-15  
**Status**: Planning  
**Feature**: Shift-key snap to horizontal/vertical for measurement ruler

## Overview

Add snap-to-horizontal/vertical functionality to the measurement tool. When holding Shift after placing the first point and before placing the second point, the ruler should snap to either horizontal or vertical alignment based on which axis has greater distance.

## Requirements

1. Hold Shift key after first click to enable snapping
2. Snap to horizontal if `abs(dx) > abs(dy)`, otherwise snap to vertical
3. Works on both desktop (mouse) and mobile (touch)
4. Visual feedback: snapped ruler follows cursor with constraint applied
5. Release Shift to disable snapping (free cursor movement)
6. No animations (instant snap)

## Implementation Difficulty

**Difficulty**: Easy  
**Estimated Time**: 1-2 hours  
**Rationale**: Simple coordinate constraint logic, minimal changes to existing code

## Architecture Changes

### Files to Modify

1. **src/lib/measurements/utils.ts** (~20 lines added)
   - Add `snapToAxis()` utility function
   - Takes point1, point2, returns snapped point2
   - Logic: Compare `abs(dx)` vs `abs(dy)`, set smaller axis to point1's value

2. **src/components/viewer/ViewerCanvas.svelte** (~15 lines modified)
   - Track Shift key state in `handleMouseMove()` (line ~709)
   - Track Shift key state in `handleMeasurementTouchMove()` (line ~777)
   - Apply `snapToAxis()` to `cursorWorldPos` when Shift is held and point1 exists
   - Pattern: Similar to existing cursor tracking logic

## Implementation Details

### Snap Logic (utils.ts)

```typescript
/**
 * Snap point2 to horizontal or vertical alignment with point1
 * Snaps to the axis with greater distance
 */
export function snapToAxis(
  point1: MeasurementPoint,
  point2: MeasurementPoint
): MeasurementPoint {
  const dx = Math.abs(point2.worldX - point1.worldX);
  const dy = Math.abs(point2.worldY - point1.worldY);
  
  if (dx > dy) {
    // Snap to horizontal (lock Y to point1.worldY)
    return { worldX: point2.worldX, worldY: point1.worldY };
  } else {
    // Snap to vertical (lock X to point1.worldX)
    return { worldX: point1.worldX, worldY: point2.worldY };
  }
}
```

### ViewerCanvas.svelte Changes

In `handleMouseMove()`:
```typescript
function handleMouseMove(event: MouseEvent): void {
  if (!measurementModeActive || !renderer) {
    cursorWorldPos = null;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;

  const viewportState = renderer.getViewportState();
  const worldX = (screenX - viewportState.x) / viewportState.scale;
  const worldY = -((screenY - viewportState.y) / viewportState.scale);

  let worldPos = { worldX, worldY };
  
  // Apply snap-to-axis if Shift is held and first point exists
  if (event.shiftKey && activeMeasurement?.point1) {
    worldPos = snapToAxis(activeMeasurement.point1, worldPos);
  }

  cursorWorldPos = worldPos;
}
```

Similar changes for `handleMeasurementTouchMove()` - detect Shift via touch event modifiers (though less common on mobile).

## Testing Checklist

### Desktop
- [ ] Click point1, hold Shift, move cursor → ruler snaps to horizontal/vertical
- [ ] Release Shift → ruler follows cursor freely
- [ ] Hold Shift again → ruler snaps again
- [ ] Click point2 while Shift held → measurement completes with snapped coordinates
- [ ] Snap direction changes correctly based on cursor position (horizontal vs vertical)

### Mobile
- [ ] Touch point1, drag → ruler follows touch (no Shift on mobile, so no snap)
- [ ] Alternative: Consider adding snap toggle button in FAB menu for mobile

### Edge Cases
- [ ] Shift held before first click → no effect (only applies after point1)
- [ ] Shift held during cursor tracking → smooth snap transition
- [ ] Snap works correctly with Y-axis flip coordinate system

## Future Enhancements

- Mobile snap toggle button in FAB menu (optional)
- Visual indicator when snap is active (e.g., different line color or icon)
- Snap to 45-degree angles (hold Alt/Option key)

## References

- DevLog-005-00-Measurement-Mode.md: Original measurement implementation
- ViewerCanvas.svelte: Lines 707-726 (handleMouseMove), 773-810 (handleMeasurementTouchMove)
- src/lib/measurements/utils.ts: Coordinate conversion utilities

