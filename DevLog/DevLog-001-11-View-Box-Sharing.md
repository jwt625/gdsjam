# View Box Sharing

**Date:** 2025-11-27 (Phase 1), 2025-11-28 (Phase 2), 2025-11-29 (Phase 3)
**Status:** Phase 3 Complete
**Issue:** https://github.com/jwt625/gdsjam/issues/15
**PR:** https://github.com/jwt625/gdsjam/pull/25 (Phase 1)

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
| Animations | **NONE - EVER** | All transitions instant. No animations for viewport navigation, jumps, or any UI transitions. Animation is wasted time. |

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

### Phase 1: Host Broadcast and Follow Sync [COMPLETE]

Core viewport synchronization between host and followers.

**Scope:**
- Host can enable/disable broadcast mode
- Viewers see broadcast status indicator
- Viewers can toggle follow mode on/off
- Following viewers have viewport locked to host
- New joiners default to follow when broadcast is active

**Files Created:**
- `src/lib/collaboration/ViewportSync.ts` - Viewport state sync via Awareness API (275 lines)

**Files Modified:**
- `src/lib/collaboration/types.ts` - Renamed ViewportState to CollaborativeViewportState
- `src/lib/collaboration/SessionManager.ts` - Added ViewportSync integration and facade methods
- `src/stores/collaborationStore.ts` - Added broadcast/follow state, toast management
- `src/components/ui/ParticipantList.svelte` - Added broadcast toggle (host) and follow checkbox (viewers)
- `src/components/viewer/ViewerCanvas.svelte` - Connected viewport sync, viewport locking, toast display
- `src/lib/renderer/PixiRenderer.ts` - Added onViewportChanged, onViewportBlocked callbacks, viewport lock

**Implementation Notes:**
- 200ms throttle on viewport broadcasts
- Coordinate transformation handles Y-flip (scaleY = -scaleX) for GDSII coordinate system
- Toast auto-hides after 2 seconds, re-shows on blocked interaction
- Viewport lock disables: pan, zoom, fit-to-view (F key and mobile button)
- Broadcast state stored in Y.js session map (ephemeral)
- Viewport data stored in Y.js Awareness API (ephemeral)

**Bug Fixes:**

1. **Viewport sync not working when file uploaded before session**
   - Root cause: `setupViewportSync()` only ran once during `onMount` when `isInSession` was `false`
   - Fix: Added reactive `$effect` in ViewerCanvas.svelte to re-call `setupViewportSync()` when `isInSession` becomes true

2. **Late-joining viewers not auto-following host**
   - Root cause: Y.Map observers only fire on changes, not initial state. Previous attempts (calling after sync, rebroadcasting on peer-join) failed due to timing issues.
   - Fix: Implemented priority-based sync system:
     - P0 (Host toggle): Y.Map changes reset all viewer overrides
     - P1 (Viewer toggle): Local override takes precedence over heartbeat
     - P2 (Heartbeat): Host includes `broadcastEnabled: true` in awareness updates
   - Late joiners receive broadcast state via first awareness update, resolving timing issues

**Completed Tasks:**
- [x] Define CollaborativeViewportState interface in types.ts
- [x] Create ViewportSync class with throttled broadcast
- [x] Add onViewportChanged callback to PixiRenderer
- [x] Add onViewportBlocked callback for locked viewport feedback
- [x] Implement broadcast toggle in SessionManager
- [x] Add follow state to collaborationStore
- [x] Update ParticipantList with broadcast/follow UI
- [x] Connect ViewerCanvas to apply received viewport state
- [x] Handle new joiner default follow behavior
- [x] Add error handling in doBroadcast
- [x] Add null checks in setupViewportSync
- [x] fitToView respects viewport lock

**Deferred to Phase 2/3:**
- [ ] Host "reset all to follow" action
- [ ] Optimize awareness listener (filter by added/removed)
- [ ] Improve type safety (reduce `any` usage in Y.js maps)
- [ ] Add test coverage

### Phase 2: Minimap with Own Viewport

Minimap component showing layout overview for navigation.

**Design Decisions:**

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Renderer | Separate PixiJS Application instance | Clean separation, minor overhead acceptable |
| LOD Culling | Cell-level first, then polygon-level (< 1% of layout extent) | Cell has `boundingBox`, skip all instances of small cells efficiently |
| Colors | Shared layer color scheme via event | Layer visibility also shared; use event-based coordination |
| Position | Bottom-right corner, movable panel (like ParticipantList) | Mobile-friendly, user preference |
| Default size | 30% of canvas | May be adjusted based on feedback |
| Toggle | 'M' key + mobile menu button | Confirmed 'M' key unused |
| Auto-hide | Hide minimap when host broadcast enabled | Everyone shares same view |
| Resize | Free resize by user, min 10% / max ~4K (general cap) | Prevent weird scenarios; no need for strict document boundary |
| Min size behavior | Sizing below 10% triggers **instant** hide | No animations ever |
| Mobile | Visible and functional | Mobile is first citizen |
| Click behavior | Click sets center of main viewport (instant) | No drag-to-pan for MVP |
| Viewport rectangle | Standard panel style (default stroke/fill like other panels) | Nothing fancy or special |
| Animations | **NONE** - all transitions instant | No animations ever in this project |
| Performance | Add minimap stats (follow main canvas pattern, cut redundant/duplicates) | Monitoring |
| Re-render trigger | Only on layer property changes (event-based subscription) | Viewport changes only update outline |
| Panel z-index | Add shared z-index management store | Click to bring to front; needed for multiple panels |

**LOD Culling Algorithm:**
1. Calculate layout extent from document `boundingBox`
2. **On parsing**, mark each `Cell` as "skip in minimap" if:
   - `(cell.boundingBox.maxX - cell.boundingBox.minX) < 0.01 * layoutExtentX` OR
   - `(cell.boundingBox.maxY - cell.boundingBox.minY) < 0.01 * layoutExtentY`
   - **Threshold is 1% of layout extent** (e.g., 10mm chip → skip cells < 100µm)
3. When rendering minimap, skip all instances of marked cells
4. For remaining cells, also skip individual polygons below threshold

**Scope:**
- Resizable minimap overlay (bottom-right, movable panel)
- Simplified render using LOD culling (skip small polygons)
- Click on minimap to navigate main view (instant, no animation)
- Toggle visibility ('M' key, mobile menu)
- Auto-hide when host broadcast is active
- Minimap rendering stats in performance panel

**Files to Create:**
- `src/components/ui/Minimap.svelte` - Minimap component (movable panel pattern)
- `src/lib/renderer/MinimapRenderer.ts` - Lightweight PixiJS renderer with LOD culling
- `src/stores/panelZIndexStore.ts` - Shared z-index management for movable panels

**Files to Modify:**
- `src/components/viewer/ViewerCanvas.svelte` - Integrate minimap component
- `src/lib/renderer/PixiRenderer.ts` - Expose document bounds and layer colors
- `src/components/ui/MobileControls.svelte` - Add minimap toggle button
- `src/components/ui/PerformancePanel.svelte` - Add minimap stats section
- `src/components/ui/ParticipantList.svelte` - Integrate z-index store
- `src/lib/gds/GDSParser.ts` - Add `skipInMinimap` marking during parse
- `src/types/gds.ts` - Add `skipInMinimap: boolean` to Cell type

**COMPLETED (2025-11-28):**
- [x] Add `skipInMinimap: boolean` to Cell type in `src/types/gds.ts`
- [x] Mark cells with `skipInMinimap` during parsing in GDSParser
- [x] Create `src/stores/panelZIndexStore.ts` for shared z-index management
- [x] Update ParticipantList.svelte to use panelZIndexStore
- [x] Create MinimapRenderer (separate Pixi Application)
  - [x] Implement cell-level LOD culling (use `skipInMinimap` flag)
  - [x] Subscribe to layer color/visibility change events via layerStore
  - [x] Expose public API: `getDocumentBoundingBox()`, `getLayerColors()`, `getDocumentUnits()`
- [x] Create Minimap.svelte as movable/resizable panel
  - [x] Follow ParticipantList panel pattern
  - [x] Bottom-right default position
  - [x] Default size 30% of canvas
  - [x] Use panelZIndexStore for z-index management
- [x] Implement click-to-navigate (instant jump)
- [x] Draw viewport outline (standard panel style)
- [x] Add 'M' keyboard shortcut to toggle minimap
- [x] Add minimap toggle to mobile menu
- [x] Implement resize with constraints (min 100px, max 400px)
- [x] Persist minimap size/position in localStorage
- [x] Event-based subscription for layer visibility/color changes via layerStore

**Bug Fixes (2025-11-29):**

1. **Panel position not updating on browser resize**
   - Symptom: Minimap could move completely out of view when resizing browser window
   - Fix: Added `constrainPosition()` function and `window.resize` event listener to keep panel within viewport bounds

2. **Touch drag not working on mobile**
   - Symptom: Could not drag minimap panel on touch devices
   - Fix: Added `handleHeaderTouchStart()`, `handleTouchMove()`, and `handleResizeTouchStart()` touch event handlers

3. **Nothing rendering in minimap**
   - Symptom: Grey canvas with no visible layout
   - Root cause: Polygon points are `Point[]` objects with `.x` and `.y` properties, but code was treating them as flat arrays
   - Fix: Updated polygon rendering to access `point.x` and `point.y` correctly

4. **Canvas resize working but layout stretched**
   - Symptom: When resizing minimap panel, the canvas element resized but layout was distorted
   - Fix: Added explicit `canvas.width` and `canvas.height` updates in `resize()` function before calling PixiJS resize

5. **Viewport outline not visible**
   - Symptom: Red viewport rectangle never appeared on minimap
   - Root cause: `setOnViewportChanged()` callback was only set up inside `setupViewportSync()` which only runs when in a collaboration session
   - Fix: Moved viewport callback setup to main `$effect` so it runs regardless of session state; also initialize `viewportBounds` immediately after setting up callback

**Known Issues:**

1. **Minimap layout resize scaling** - FIXED (2025-11-29)
   - Symptom: Minimap layout does not scale to fill canvas when panel is resized
   - Root cause: `minimapRenderer` was not reactive, so the resize effect wasn't tracking it properly
   - Fix: Made `minimapRenderer` use `$state()` and ensured the resize effect reads `panelSize` at top level for Svelte 5 dependency tracking

2. **Minimap toggle (M key) breaks rendering** - FIXED (2025-11-29)
   - Symptom: After hiding and showing minimap with M key, canvas and rendering disappeared
   - Root cause: `{#if visible}` removed the entire panel from DOM, destroying the canvas element
   - Fix: Changed to use CSS `display: none` instead of conditional rendering to preserve DOM element

3. **Binding error with canvasElement** - FIXED (2025-11-29)
   - Symptom: `Cannot bind to constant` error
   - Root cause: Biome linter was changing `let canvasElement` to `const canvasElement` during pre-commit
   - Fix: Removed `.svelte` from `.lintstagedrc.json` so biome doesn't run on Svelte files during commits (Svelte `bind:this` requires `let`)

4. **Initial viewport box has zero size** - FIXED (2025-11-29)
   - Symptom: When a new file is uploaded and rendered, the viewport rectangle in minimap shows ~0.017 pixel width instead of filling the minimap
   - Debug findings:
     - Minimap scale: `0.000014466666666666667`
     - Document bounds: 10,000,000 units wide (from -5M to +5M)
     - Initial viewport width in pixels: `0.017` → world units = ~1,200 units (should be ~10M after fitToView)
     - After manual zoom, viewport width becomes correct (~316 pixels, ~21M world units)
   - Root cause investigation:
     - `fitToView()` sets correct scale on `mainContainer`, then calls `performViewportUpdate()`
     - `performViewportUpdate()` triggers LOD depth increase check via `lodManager.checkAndTriggerRerender()`
     - `increaseDepthAndRerender()` **synchronously** replaces `this.mainContainer` with a NEW container (scale=1) before its first `await`
     - Then `fitToView()` continues and calls `notifyViewportChanged()` - but now `this.mainContainer` is the NEW one with wrong scale=1!
   - Fix in `PixiRenderer.ts`:
     - Skip `notifyViewportChanged()` when `isRerendering` is true (line 305-307)
     - Call `notifyViewportChanged()` at the END of `increaseDepthAndRerender()` after `isRerendering = false` (line 522)
   - This ensures the minimap always receives correct viewport bounds after fitToView and LOD re-render complete

**Deferred:**
- [ ] Polygon-level LOD culling (cell-level is sufficient for MVP)
- [ ] Instant hide when resized below minimum (current min is 100px)
- [ ] Auto-hide when host broadcast enabled
- [ ] Add minimap stats to PerformancePanel (can be added via shared store if needed)

**Notes:**
- Cell has `boundingBox: BoundingBox` for extent calculation
- Minimap shares layout bounds from main PixiRenderer
- Layer color/visibility coordination is event-based (minimap subscribes)
- Max size cap is general (e.g., 4K equivalent) rather than document-specific

**Implementation Q&A (2025-11-28):**

| Question | Decision |
|----------|----------|
| When to calculate `skipInMinimap`? | Second pass in parser, after global bbox is known (line ~666) |
| Separate PIXI Application vs shared? | Separate Application - acceptable since minimap only renders on load and layer changes |
| Event system for layer changes? | Svelte stores (Option B) - fits existing architecture, no new infrastructure |

**Implementation Steps:**

1. **Types + Parser** - Add `skipInMinimap` to Cell type, mark cells in parser
2. **Panel Z-Index Store** - Create `panelZIndexStore.ts`, update ParticipantList
3. **Layer Store** - Create `layerStore.ts` for layer visibility/color tracking
4. **PixiRenderer API** - Add `getDocumentBoundingBox()`, `getLayerColors()`, `getDocumentUnits()`
5. **MinimapRenderer** - Create renderer with LOD culling, viewport outline
6. **Minimap.svelte** - Movable panel component with click-to-navigate
7. **ViewerCanvas Integration** - Wire up minimap, track viewport bounds
8. **Keyboard + Mobile** - 'M' key shortcut, mobile menu toggle
9. **Performance Panel** - Add minimap stats section

### Phase 3: Participant Viewports on Minimap

Display all participants' viewports on minimap with interaction.

**Scope:**
- Show all participants' viewports as colored rectangles on minimap
- Label with participant name (top-left corner, similar to object detection labels)
- Click viewport to snap main view to that exact position and zoom
- Respect "not sharing" preference (hide those viewports)
- Highlight followed user's viewport with subtle glow effect

**Design Decisions (2025-11-29):**

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Default sharing | All users share viewport by default on join | Opt-out toggle deferred for later (potential paid feature) |
| Own viewport | Remain visible on minimap | User sees their own rectangle alongside others |
| Multi-participant | Show all, no limit | Performance acceptable for typical session sizes |
| Label position | Top-left corner of rectangle | Follows object detection label convention |
| Label visibility | Always visible | Toggle for hiding labels deferred for later |
| Click action | Jump to exact view (center + zoom) | Match host broadcast follow behavior |
| Followed highlight | Subtle glow effect | Not too obvious, just subtle difference |
| Overlap click | Pick topmost (last rendered) | Viewport is cheap, not critical |
| Share toggle location | Deferred | Will decide UI placement later |

**Files to Modify:**
- `src/lib/collaboration/types.ts` - Add `ParticipantViewport` interface
- `src/lib/collaboration/ViewportSync.ts` - Add `getParticipantViewports()`, extend broadcasting to all users
- `src/lib/renderer/MinimapRenderer.ts` - Render participant viewports, labels, click detection
- `src/components/ui/Minimap.svelte` - Accept and pass participant viewport data
- `src/components/viewer/ViewerCanvas.svelte` - Wire up participant viewports from ViewportSync

**Implementation Plan:**

1. **Update Types**
   - Add `ParticipantViewport` interface to `types.ts`: `{ userId, displayName, color, viewport, isFollowed }`

2. **Extend ViewportSync for All Users**
   - Modify `doBroadcast()` to allow any user (not just host) to broadcast their viewport
   - All users broadcast by default when in session
   - Add throttled `broadcastOwnViewport()` that runs on every local viewport change

3. **Add getParticipantViewports() Method**
   - Iterate all awareness states
   - Filter out self (current user)
   - Extract userId, displayName, color, viewport from each
   - Mark `isFollowed: true` for the user being followed (if any)
   - Return array of `ParticipantViewport`

4. **Render Participant Viewports in MinimapRenderer**
   - Create new Graphics layer for participant rectangles (separate from own viewport outline)
   - Add `updateParticipantViewports(viewports: ParticipantViewport[])` method
   - Draw colored rectangle stroke for each participant using their assigned color
   - Apply subtle glow filter to followed user's rectangle

5. **Add Name Labels**
   - Use PixiJS Text objects for labels
   - Position at top-left corner of each rectangle
   - Add semi-transparent background for readability
   - Pool/reuse Text objects to avoid allocation churn

6. **Implement Click-on-Viewport Navigation**
   - Track participant viewport bounds in screen coordinates
   - On minimap click, check if click falls inside any participant rectangle
   - If hit, calculate world center and scale from that participant's viewport
   - Call `onNavigate` callback with exact center and zoom (not just center)

7. **Wire Up ViewerCanvas**
   - Get ViewportSync instance from SessionManager
   - Subscribe to awareness changes
   - On each change, call `getParticipantViewports()` and pass to Minimap
   - Pass followed user ID to MinimapRenderer for highlight

8. **Update Minimap Component**
   - Add `participantViewports` prop
   - Pass to MinimapRenderer on each update
   - Update `onNavigate` callback signature to include optional zoom

**TODO:** (Completed 2025-11-29)
- [x] Add `ParticipantViewport` interface to types.ts
- [x] Extend ViewportSync to broadcast all users' viewports
- [x] Add `getParticipantViewports()` method to ViewportSync
- [x] Add participant viewport rendering to MinimapRenderer
- [x] Add name labels (top-left, with background)
- [x] Add glow effect for followed user's viewport
- [x] Implement click-on-viewport detection and navigation
- [x] Wire up ViewerCanvas to pass participant viewports to Minimap
- [x] Update Minimap component to accept and forward participant data

**Implementation Notes:**
- Self viewport excluded from participant list (own viewport already shown as white outline)
- Viewport coordinate conversion uses same logic as `ViewportManager.getViewportBounds()` to ensure alignment
- Added `setViewportCenterAndScale()` to PixiRenderer for click-to-navigate with exact zoom
- Added `broadcastOwnViewport()` to SessionManager/ViewportSync for all users to share position
- Label pool pattern used in MinimapRenderer for efficient text rendering

**Deferred:**
- [ ] "Share my viewport" toggle in settings UI
- [ ] Toggle to hide/show participant name labels
- [ ] Limit on rendered viewports (if performance becomes issue)

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
- Click on minimap navigates main view instantly (no animation)
- Minimap resize persists across page reload
- Minimap auto-hides when host broadcast is enabled
- 'M' key toggles minimap visibility
- Minimap toggle accessible in mobile menu
- Minimap stats visible in performance panel when enabled
- LOD culling correctly skips small polygons (< 1% of layout extent)

### Phase 3
- All participant viewports visible on minimap with correct assigned colors
- Own viewport visible alongside other participants
- Name labels displayed at top-left corner of each viewport rectangle
- Click participant viewport snaps to their exact view (center + zoom) instantly
- Followed user's viewport shows subtle glow highlight
- All users broadcast viewport by default on session join
- Non-sharing participants not visible on minimap (when opt-out is implemented)

