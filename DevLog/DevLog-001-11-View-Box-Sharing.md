# View Box Sharing

**Date:** 2025-11-27
**Status:** Planning
**Issue:** https://github.com/jwt625/gdsjam/issues/15

## Problem Statement

Users in a collaborative session need to share viewport state for two use cases:
1. Host presents a specific view to all viewers (broadcast mode)
2. Users see where others are looking and can jump to their view (awareness mode)

## Design Decisions

### Broadcast Mode

| Aspect | Decision |
|--------|----------|
| Default state | Independent navigation; broadcast disabled |
| When host enables broadcast | New joiners follow by default |
| Viewer control | Checkbox to toggle "Follow host" on/off |
| Host control | Can reset all viewers to follow mode |
| Viewport lock | Locked when following; viewers cannot pan/zoom |
| Lock feedback | Non-invasive floating toast: "Host is controlling your view" (disappears quickly) |

### Viewport Lock Implementation

When following host, disable these inputs:
- Arrow key panning
- Mouse wheel zoom
- Pinch-to-zoom (mobile)
- Fit-to-view keyboard shortcut (F key)
- Fit-to-view mobile button
- Touch/mouse pan gestures

### Viewport Sync Details

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Position sync | Apply host's center point and zoom | Viewers see same content; edges differ by screen size |
| Broadcast persistence | Save in host's localStorage + check Y.js on reconnect | Survives host refresh |

### Viewport Visualization

| Aspect | Decision |
|--------|----------|
| Primary display | Minimap with all participants' viewports as colored rectangles |
| Own viewport | Not shown to self |
| Sharing default | Share viewport by default; option to opt-out |
| Click behavior | Click participant viewport on minimap to snap to their view |

### Technical Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Sync mechanism | Y.js Awareness API | Fast, ephemeral, no persistence needed |
| Update throttle | 200ms | Balance between responsiveness and network load |
| Zoom sync | Match zoom level exactly | Simple; same-sized features on all screens |
| File not loaded | Ignore viewport sync | Avoid errors on unready clients |
| Jump animation | Instant | No transition animation |

## Architecture

### Viewport State Structure (Awareness API)

```typescript
// Added to each user's awareness state
{
  viewport: {
    x: number;          // mainContainer.x
    y: number;          // mainContainer.y
    scale: number;      // zoom level
    width: number;      // screen width in pixels
    height: number;     // screen height in pixels
    updatedAt: number;  // timestamp
  } | null;             // null if not sharing
}
```

### Session State Additions (Y.js Map)

```typescript
// Added to session map
{
  broadcastEnabled: boolean;    // host is broadcasting
  broadcastHostId: string;      // userId of broadcaster (usually host)
}
```

## Implementation Phases

### Phase 1: Host Broadcast and Follow Sync

Core viewport synchronization between host and followers.

**Scope:**
- Host can enable/disable broadcast mode
- Viewers see broadcast status indicator
- Viewers can toggle follow mode on/off
- Following viewers have viewport locked to host
- New joiners default to follow when broadcast is active

**Files to Create:**
- `src/lib/collaboration/ViewportSync.ts` - Viewport state sync via Awareness API

**Files to Modify:**
- `src/lib/collaboration/types.ts` - Add ViewportState interface
- `src/lib/collaboration/SessionManager.ts` - Expose viewport sync methods
- `src/lib/collaboration/YjsProvider.ts` - Add viewport to awareness state
- `src/stores/collaborationStore.ts` - Add broadcast/follow state and actions
- `src/components/ui/ParticipantList.svelte` - Add broadcast toggle (host) and follow checkbox (viewers)
- `src/components/viewer/ViewerCanvas.svelte` - Connect viewport sync to renderer
- `src/lib/renderer/PixiRenderer.ts` - Add viewport change callback for sync

**TODO:**
- [ ] Define ViewportState interface in types.ts
- [ ] Create ViewportSync class with throttled broadcast
- [ ] Add setViewportAwareness() to YjsProvider
- [ ] Add onViewportChanged callback to PixiRenderer
- [ ] Implement broadcast toggle in SessionManager
- [ ] Add follow state to collaborationStore
- [ ] Update ParticipantList with broadcast/follow UI
- [ ] Connect ViewerCanvas to apply received viewport state
- [ ] Handle new joiner default follow behavior
- [ ] Add host "reset all to follow" action

### Phase 2: Minimap with Own Viewport

Minimap component showing layout overview and current viewport.

**Scope:**
- Resizable minimap overlay (corner of screen)
- Simplified render of full layout bounds
- Current viewport shown as rectangle
- Click/drag on minimap to navigate main view
- Toggle visibility (keyboard shortcut or button)

**Files to Create:**
- `src/components/ui/Minimap.svelte` - Minimap component
- `src/lib/renderer/MinimapRenderer.ts` - Lightweight canvas renderer for minimap

**Files to Modify:**
- `src/components/viewer/ViewerCanvas.svelte` - Integrate minimap component
- `src/lib/renderer/PixiRenderer.ts` - Expose bounds and viewport for minimap

**TODO:**
- [ ] Create MinimapRenderer with simplified drawing (outlines only, no fill)
- [ ] Create Minimap.svelte component with resize handle
- [ ] Render layout bounds from GDSDocument bounding box
- [ ] Draw current viewport as rectangle
- [ ] Implement click-to-navigate on minimap
- [ ] Implement drag-to-pan on minimap
- [ ] Add keyboard shortcut to toggle minimap (M key)
- [ ] Persist minimap size preference in localStorage

### Phase 3: Participant Viewports on Minimap

Display all participants' viewports on minimap with interaction.

**Scope:**
- Show all participants' viewports as colored rectangles on minimap
- Label with participant name
- Click viewport to snap main view to that position
- Respect "not sharing" preference (hide those viewports)
- Highlight followed user's viewport differently

**Files to Modify:**
- `src/components/ui/Minimap.svelte` - Render participant viewports
- `src/lib/collaboration/ViewportSync.ts` - Provide all participants' viewport state
- `src/lib/collaboration/ParticipantManager.ts` - Add viewport sharing preference

**TODO:**
- [ ] Subscribe to all awareness states in ViewportSync
- [ ] Add getParticipantViewports() method returning userId, viewport, color, name
- [ ] Render participant viewports on minimap with assigned colors
- [ ] Add name labels to viewport rectangles
- [ ] Implement click-on-viewport to snap main view
- [ ] Add "share my viewport" toggle to settings
- [ ] Filter out non-sharing participants
- [ ] Highlight currently followed user's viewport (if in follow mode)

## Risk Analysis

### 1. Awareness API Conflict: LOW RISK

**Current Usage:** `ParticipantManager.setLocalAwarenessState()` sets `{ userId, displayName, color, isHost }`.

**Addition:** Viewport field is additive, no conflict with existing fields.

**Concern:** `collaborationStore` has a blanket awareness listener (lines 65-79) that calls `getConnectedUsers()` on every change. With 200ms viewport updates (5/sec per user), this causes excessive store updates.

**Mitigation:** Filter awareness changes or debounce user list updates. Viewport changes should not trigger user list refresh.

### 2. Separation of Concerns: MODERATE CONCERN

`ParticipantManager` currently owns `setLocalAwarenessState()`. If `ViewportSync` also writes to awareness, two modules write to same state.

**Options:**
- A: `ViewportSync` calls `ParticipantManager.setLocalAwarenessState()` with viewport data (single writer)
- B: `ViewportSync` writes directly, coordinates with `ParticipantManager`
- C: Create shared `AwarenessManager`

**Recommendation:** Option A for MVP. Extend `ParticipantManager.setLocalAwarenessState()` to accept optional viewport.

### 3. File Transfer Interference: VERY LOW RISK

File transfer uses Y.js document (persistent CRDT). Viewport sync uses Awareness (ephemeral). Separate data paths, no interference.

### 4. Host State Interference: LOW RISK

`hostBroadcastEnabled` is a new session map field, no conflict with existing `currentHostId` or `hostLastSeen`.

**Consideration:** When host transfers, decide whether new host inherits broadcast state or starts fresh. Recommend: clear broadcast on transfer (new host starts fresh).

### 5. Race Condition on Refresh: LOW RISK

`broadcastEnabled` is in Y.js session map, not localStorage. After host refresh, broadcast state may be lost.

**Mitigation for Phase 1 MVP:** Accept that broadcast state is lost on refresh. Host can re-enable. Low impact - viewport/broadcast state is cheap and non-critical.

### 6. Performance: MODERATE RISK

With 5 users at 200ms throttle: 25 awareness updates/sec. Current blanket awareness listener will fire excessively.

**Mitigation:** Debounce user list update in `collaborationStore`, or filter by changed fields.

### 7. Existing PR #24 Issues: LOW RISK

PR #24 feedback notes race condition in heartbeat updates and aggressive stale threshold. These are pre-existing issues in `ParticipantManager`, not caused by viewport sync.

**Recommendation:** Address PR #24 feedback before or alongside viewport sync.

### Risk Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Awareness API conflict | Low | Additive field, no conflict |
| Separation of concerns | Moderate | Extend `ParticipantManager.setLocalAwarenessState()` |
| File transfer interference | Very Low | Separate data paths |
| Host state interference | Low | Clear broadcast on host transfer |
| Race condition (refresh) | Low | Accept loss on refresh for MVP |
| Performance | Moderate | Debounce/filter awareness listener |
| Existing PR #24 bugs | Low | Address in parallel |

**Overall:** Existing architecture is well-suited for viewport sync. Main concerns are performance (awareness listener optimization) and separation of concerns (ViewportSync interaction with ParticipantManager). No fundamental architectural changes needed.

## Pre-Implementation Decisions (Resolved)

### 1. Duplicate ViewportState Interface - RESOLVED

**Decision:** Rename collaboration type to `CollaborativeViewportState` before starting implementation.

- `src/lib/renderer/PixiRenderer.ts`: Keep as `ViewportState` (internal renderer state)
- `src/lib/collaboration/types.ts`: Rename to `CollaborativeViewportState` (sync metadata)

### 2. Awareness Listener Optimization - RESOLVED

**Decision:** Accept for MVP. No optimization needed.

Rationale: ~250 awareness updates/sec with 50 participants is trivial for modern JS. Can optimize later if profiling shows issues.

### 3. Viewport Callback in PixiRenderer - RESOLVED

**Decision:** Add `onViewportChanged` callback to PixiRenderer.

- Call from `handleZoom()` and `handlePan()`
- Throttle at the caller (ViewportSync), not in PixiRenderer

### 4. Toast Timing for "Host is controlling your view" - RESOLVED

**Decision:** Show toast in both cases:
- Once when follow mode is first enabled (or user joins with broadcast active)
- Again when user tries to interact while locked (click, drag, scroll, keyboard)

### 5. Single Writer Pattern for Awareness - RESOLVED

**Decision for Phase 1:** Use `awareness.setLocalStateField('viewport', data)` which merges with existing fields. Keep ViewportSync separate from ParticipantManager.

This approach:
- Avoids coupling ViewportSync to ParticipantManager
- Uses Y.js's built-in field merging
- Does not affect Phase 3 implementation (can revisit pattern then)

### 6. Broadcast/Viewport State Persistence on Refresh - RESOLVED

**Decision:** Accept state loss on host refresh for Phase 1 MVP.

- Viewport position (x, y, scale) is cheap/non-critical
- broadcastEnabled flag loss is acceptable - host can re-enable
- Simplifies implementation; no localStorage needed for this feature

## Success Criteria

### Phase 1
- Host enables broadcast; all followers' views update within 300ms
- Viewer toggles follow off; can navigate independently
- New joiner with broadcast active starts in follow mode

### Phase 2
- Minimap renders within 100ms of layout load
- Click on minimap navigates main view correctly
- Minimap resize persists across page reload

### Phase 3
- All participant viewports visible on minimap with correct colors
- Click participant viewport snaps to their view instantly
- Non-sharing participants not visible on minimap

