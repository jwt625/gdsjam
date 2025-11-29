# Layer Visibility Sync

**Date:** 2025-11-29
**Status:** Complete
**Issue:** https://github.com/jwt625/gdsjam/issues/16

## Problem Statement

Users in a collaborative session need to share layer visibility state. When the host toggles layer visibility, all synced viewers should see the same layers hidden/shown.

## Design Decisions

### Sync Model

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Model | Host-only broadcast (same as viewport sync) | Consistent with existing pattern |
| Priority system | P0/P1/P2 (same as viewport sync) | Viewers can locally override |
| Default state | Sync disabled; viewers must opt-in | Independent viewing by default |

### Priority System (Reusing Viewport Sync Pattern)

- **P0 (Host toggle in Y.Map):** Host enables/disables layer broadcast; resets all viewer overrides
- **P1 (Viewer local override):** Viewer disables sync locally; ignores host broadcasts
- **P2 (Heartbeat via Awareness):** Host includes layer state in awareness for late joiners

### Behavior Matrix

| Host Sync | Viewer Sync | Behavior |
|-----------|-------------|----------|
| ON | ON | Host changes propagate to viewer |
| ON | OFF | Viewer has local control (P1 override) |
| OFF | ON | No sync (requires host participation) |
| OFF | OFF | No sync, everyone independent |

### Scope

| Aspect | Decision |
|--------|----------|
| Visibility sync | Yes |
| Color sync | No |
| Bulk actions (Show All/Hide All) | Yes, also synced |
| Minimap layer visibility | No (always shows all layers for performance) |
| Visual indicator | Follow viewport broadcast pattern (toast/checkbox) |
| Conflict resolution | Not needed (host-only broadcast) |

## Architecture

### Layer Visibility State Structure (Awareness API)

```typescript
// Added to AwarenessState
{
  layerVisibility?: {
    visibility: { [layerKey: string]: boolean };
    updatedAt: number;
  } | null;
}
```

### Session State Additions (Y.js Map)

```typescript
// Added to session map (YjsSessionData)
{
  layerBroadcastEnabled?: boolean;
  layerBroadcastHostId?: string;
}
```

### LayerSyncCallbacks Interface

```typescript
interface LayerSyncCallbacks {
  onHostLayerVisibilityChanged: (visibility: { [key: string]: boolean }) => void;
  onBroadcastStateChanged: (enabled: boolean, hostId: string | null) => void;
}
```

## Implementation Plan

### Files to Create

1. **`src/lib/collaboration/LayerSync.ts`** - Layer visibility sync class (follows ViewportSync pattern)

### Files to Modify

1. **`src/lib/collaboration/types.ts`**
   - Add `layerVisibility` field to `AwarenessState`
   - Add `layerBroadcastEnabled` and `layerBroadcastHostId` to `YjsSessionData`
   - Add `LayerSyncCallbacks` interface

2. **`src/lib/collaboration/SessionManager.ts`**
   - Add `layerSync: LayerSync | null` field
   - Add `initializeLayerSync()` method
   - Add facade methods: `enableLayerBroadcast()`, `disableLayerBroadcast()`, `broadcastLayerVisibility()`
   - Add `setLayerSyncCallbacks()` method

3. **`src/stores/collaborationStore.ts`**
   - Add `isLayerBroadcasting` and `isLayerFollowing` state fields
   - Add layer sync actions: `enableLayerBroadcast()`, `disableLayerBroadcast()`, `toggleLayerFollowing()`
   - Add `handleLayerBroadcastStateChanged()` callback handler

4. **`src/stores/layerStore.ts`**
   - Add `applyRemoteVisibility(visibility: { [key: string]: boolean })` method
   - Method applies visibility changes from remote without triggering re-broadcast

5. **`src/components/ui/LayerPanel.svelte`**
   - Replace TODO comment with actual Y.js sync logic
   - Call `sessionManager.broadcastLayerVisibility()` when sync enabled and layers change
   - Subscribe to remote layer changes and apply to store

6. **`src/components/viewer/ViewerCanvas.svelte`**
   - Set up layer sync callbacks (similar to viewport sync callbacks)
   - Call `layerStore.applyRemoteVisibility()` when receiving remote changes

## Implementation Notes

- Throttle layer broadcasts (200ms) to avoid excessive network traffic
- Use `gdsStore.toggleLayerVisibility()` for applying changes
- Dispatch `layer-visibility-changed` event after applying remote changes for renderer update
- Late joiners receive layer state via P2 awareness heartbeat (same as viewport sync)

## Implementation Summary

### Created Files

1. **`src/lib/collaboration/LayerSync.ts`** (182 lines)
   - P0/P1/P2 priority system matching ViewportSync
   - 200ms throttled broadcasts
   - Awareness and session map listeners

### Modified Files

1. **`src/lib/collaboration/types.ts`** - Added `CollaborativeLayerVisibility`, layer fields to `AwarenessState` and `YjsSessionData`
2. **`src/lib/collaboration/SessionManager.ts`** - Added LayerSync integration and facade methods
3. **`src/stores/collaborationStore.ts`** - Added `isLayerBroadcasting`, `isLayerFollowing` state and actions
4. **`src/stores/layerStore.ts`** - Added `applyRemoteVisibility()` method
5. **`src/components/ui/LayerPanel.svelte`** - Connected to collaboration sync with role-based UI
6. **`src/components/viewer/ViewerCanvas.svelte`** - Set up layer sync callbacks

### UI Pattern

LayerPanel now matches the viewport broadcast pattern in ParticipantList:
- **Host sees:** "Broadcast layers" checkbox
- **Viewer sees:** "Follow host" checkbox
- Only displayed when in a collaboration session
- Viewer checkbox auto-syncs when host enables/disables broadcast

## Success Criteria

- Host enables layer broadcast; all synced viewers see layer changes within 300ms
- Viewer with sync disabled can toggle layers independently
- Bulk actions (Show All/Hide All) propagate to synced viewers
- New joiner with broadcast active receives current layer visibility state
- Minimap unaffected (continues showing all layers)

## Deferred

- [ ] Layer color sync
- [ ] Visual indicator distinguishing synced vs local layer state
- [ ] Per-layer sync toggle (all-or-nothing for MVP)

