# DevLog-001-14: Floating Comments Feature

**Issue**: #49  
**Status**: Planning  
**Date**: 2025-12-09

## Overview

Implement a floating comment system that allows users to annotate GDS layouts with text comments tied to world coordinates. Comments persist in localStorage for solo use and sync via Y.js in collaboration sessions.

## Requirements

### Core Features
- Toggle comment mode with keyboard shortcut `c`
- Click canvas to place comment at world coordinates
- Simple text input modal (center screen, no animation)
- Display comments as user initial bubbles (both initials, e.g., "AA" for "Anonymous Aardvark")
- Initial state: preview (showing first 140 characters)
- Click bubble once: expand to full content (max 1000 characters)
- Click again: collapse to minimal (showing only commenter name initials)
- Click anywhere else when fully expanded: toggle to preview
- Hold `c` to show/hide all comments (temporary peek while held, similar to fullscreen `f` key)
- Touch control button for mobile

### Comment Panel
- Right-side panel (hidden by default)
- Double-click `c` or mobile button to toggle
- Chronological list of all comments
- Click comment to recenter viewport (respects viewport sync priority - LOWEST tier, same as viewer manual viewport adjustment)
  - If host is broadcasting viewport, show same prompt as when viewer tries to adjust viewport manually
  - Implementation priority: LAST / LOW PRIORITY
- Independent visibility from canvas comment bubbles
- Host controls: enable/disable viewer comments, clear all, delete individual
- Author controls: delete own comments (no confirmation unless >140 characters)

### Display Specifications
- User initial bubble: small icon size (24px)
- Color: canvas background grey with light white outline
- Text: light white, matching scale bar styling
- Font size: match page footnote
- Timestamp format:
  - Absolute: ISO format (2025-12-09 14:30:00)
  - Relative: proper units (e.g., "2 minutes ago", "5 hours ago") - NO "just now"
  - Click to toggle between absolute and relative
- Dark theme throughout
- NO ANIMATIONS - instant transitions only
- Comment bubble positioning: bottom-left corner at world coordinate point

### Permissions & Limits
- Viewer commenting: OFF by default
- Host can enable/disable viewer commenting
- Host can delete any comment
- Comment author can delete own comments (no confirmation unless >140 characters)
- Host can clear all comments
- Max 100 comments per session
- Rate limiting: viewer 1/min, host 1/10s
  - Enforcement: Both UI (disable button/show message) AND store validation (safety)
  - Show toast/notification when rate limit is hit

### Storage & Persistence
- Solo mode: localStorage with file hash key
  - Key format: `gdsjam_comments_<fileHash>`
  - File hash computed for solo mode uploads (same as collaboration)
- Collaboration: Y.js session-specific (cleared on session end)
- Comments tied to world/database coordinates (exact click position, no snapping)
- Survive page refresh (localStorage for solo, Y.js for collab)
- Cleared on file change (all comments cleared immediately, no retention across files/sessions)
- Persist through host transfer (new host inherits controls)

### Desktop Interaction
- Cursor change when in comment mode
- Keyboard `c`: toggle comment mode
- Hold `c`: show/hide all comments (similar to layer panel show/hide all layers)
- Double-click `c`: toggle comment panel (replaces single click if detected within interval)
- ESC: cancel comment mode at any step
- Click outside modal: cancel comment placement

### Mobile Interaction
- Comment button in FAB menu
- Toggle button to show/hide comments
- Button to open comment panel
- Comment placement: tap to enter mode, then tap canvas OR drag to align center crosshair

## Design Intent

Follow Figma-style comment pattern: minimal visual footprint with progressive disclosure. Comments should not clutter the layout view but remain easily accessible. Prioritize performance and instant feedback (no animations per project requirements).

**Future Enhancement**: Auto-toggle between minimal and preview states based on viewport zoom level to reduce clutter at zoomed-out views.

## Technical Specifications

### Data Model
```typescript
interface Comment {
  id: string;              // UUID
  userId: string;          // Author user ID
  displayName: string;     // Author display name
  content: string;         // Comment text (max 1000 chars)
  worldX: number;          // World/database coordinate X
  worldY: number;          // World/database coordinate Y
  timestamp: number;       // Unix timestamp
  createdAt: number;       // Unix timestamp
}

interface CommentPermissions {
  viewersCanComment: boolean;  // Default: false
}

interface CommentRateLimit {
  userId: string;
  lastCommentTime: number;
}
```

### Storage Architecture
- **Solo mode**: `localStorage.setItem('gdsjam_comments_<fileHash>', JSON.stringify(comments))`
- **Collaboration**: Y.js shared array `ydoc.getArray<Comment>('comments')`
- **Permissions**: Y.js shared map `sessionMap.get('commentPermissions')`
- **Rate limiting**: In-memory map, reset on session change

### Coordinate System
Store comments in database units (same as GDS coordinates) for consistency with existing architecture. Transform to screen coordinates for rendering using existing viewport transformation utilities.

**Positioning**: Exact click position in world coordinates (no snapping to grid/vertices). Comment bubble bottom-left corner positioned at the world coordinate point.

## Implementation Plan

### Phase 1: Data Model & Storage (Foundation)
1. Create `src/lib/comments/types.ts` - Comment interfaces
2. Create `src/stores/commentStore.ts` - Svelte store for comment state
3. Add comment storage to localStorage (solo mode)
4. Add Y.js shared array for comments in `SessionManager.ts`
5. Add comment permissions to Y.js session map
6. Implement rate limiting logic in comment store

**Reference**: 
- `src/stores/layerStore.ts` for store pattern
- `src/lib/collaboration/SessionManager.ts` for Y.js integration
- `src/lib/collaboration/types.ts` for data structure patterns

### Phase 2: Comment Creation (Core Feature)
1. Register keyboard shortcuts in `KeyboardShortcutManager`:
   - Single `c`: toggle comment mode (with double-click detection)
   - Double `c`: toggle comment panel
   - Hold `c`: show/hide all comments (similar to `f` fullscreen logic)
   - ESC: cancel comment mode
2. Implement comment mode state (cursor change on desktop, visual indicator on mobile)
3. Add canvas click handler for comment placement (exact world coordinates)
4. Mobile: implement tap-to-place OR drag-to-align-crosshair interaction
5. Create `CommentInputModal.svelte` - text input UI (center screen, no animation)
   - Click outside modal to cancel
   - ESC to cancel
   - Enter to submit
6. Implement character limit validation (140 preview, 1000 max)
7. Save comment to store (localStorage with file hash or Y.js based on session state)
8. Auto-disable comment mode after submission or cancel
9. Enforce rate limiting (UI + store validation) and permissions
10. Show toast notification on rate limit hit

**Reference**:
- `src/lib/keyboard/KeyboardShortcutManager.ts` for keyboard shortcuts
- `src/components/ui/ErrorToast.svelte` for modal pattern
- `src/lib/renderer/PixiRenderer.ts` for coordinate transformation

### Phase 3: Comment Display on Canvas
1. Create `CommentBubble.svelte` - user initial bubble component (both initials)
2. Render comment bubbles on canvas overlay (not in WebGL)
3. Transform world coordinates to screen coordinates (bottom-left corner at coordinate point)
4. Implement three display states:
   - **Minimal**: User initials only (24px bubble)
   - **Preview**: First 140 characters visible (initial state)
   - **Full**: All content up to 1000 characters
5. Implement click handlers:
   - First click on preview: expand to full
   - Second click on full: collapse to minimal
   - Click anywhere else when full: toggle to preview
6. Implement timestamp display:
   - ISO format for absolute (2025-12-09 14:30:00)
   - Proper units for relative (e.g., "2 minutes ago", "5 hours ago")
   - Click timestamp to toggle between absolute and relative
7. Implement hold `c` to show/hide all comments (temporary peek, similar to fullscreen `f`)
8. Update bubbles on viewport pan/zoom

**Reference**:
- `src/components/ui/Minimap.svelte` for overlay rendering pattern
- `src/components/ui/ParticipantList.svelte` for user display pattern
- Viewport transformation from `PixiRenderer`

### Phase 4: Comment Panel (LOW PRIORITY - implement last)
1. Create `CommentPanel.svelte` - right-side panel component
2. Display chronological list of comments
3. Implement double-click `c` to toggle panel
4. Add mobile button to toggle panel
5. Implement click-to-recenter viewport:
   - **LOWEST priority tier** (same as viewer manual viewport adjustment)
   - If host is broadcasting viewport, show same prompt as manual viewport adjustment
   - Respect viewport sync priority system
6. Add host controls: enable/disable viewer comments, clear all
7. Add delete button for individual comments:
   - Host can delete any comment
   - Author can delete own comments
   - Confirmation dialog only if comment >140 characters
8. Panel visibility independent of canvas comment visibility

**Reference**:
- `src/components/ui/LayerPanel.svelte` for panel structure and styling
- `src/components/ui/ParticipantList.svelte` for list rendering
- `src/stores/panelZIndexStore.ts` for panel z-index management

### Phase 5: Mobile Support
1. Add comment button to `MobileControls.svelte` FAB menu
2. Add toggle button for comment visibility
3. Add button to open comment panel
4. Implement mobile comment placement:
   - Tap to enter comment mode
   - Next tap on canvas places comment at that location
   - OR drag to align center crosshair for precise positioning
   - Both methods should be supported
5. Ensure touch-friendly comment interaction (bubble tap, panel interaction)

**Reference**:
- `src/components/ui/MobileControls.svelte` for FAB menu pattern

### Phase 6: Integration & Polish
1. Handle file change: clear all comments immediately (no retention across files/sessions)
2. Ensure file hash computation for solo mode uploads (same as collaboration)
3. Handle host transfer: preserve comments, transfer controls
4. Handle page refresh: reload from localStorage (solo) or Y.js (collab)
5. Enforce 100 comment limit per session
6. Test coordinate transformation accuracy (exact position, bottom-left corner alignment)
7. Test collaboration sync
8. Performance optimization for many comments

**Reference**:
- `src/lib/collaboration/HostManager.ts` for host transfer logic
- `src/App.svelte` for file change handling

## Files to Create
- `src/lib/comments/types.ts`
- `src/stores/commentStore.ts`
- `src/components/ui/CommentInputModal.svelte`
- `src/components/ui/CommentBubble.svelte`
- `src/components/ui/CommentPanel.svelte`

## Files to Modify
- `src/lib/keyboard/KeyboardShortcutManager.ts` - Add `c` shortcut
- `src/components/viewer/ViewerCanvas.svelte` - Render comment bubbles, handle click
- `src/components/ui/MobileControls.svelte` - Add comment buttons
- `src/lib/collaboration/SessionManager.ts` - Add comment Y.js integration
- `src/lib/collaboration/types.ts` - Add comment types to Y.js session data
- `src/App.svelte` - Handle file change comment clearing

## Success Criteria
- Comments appear at correct world coordinates regardless of zoom/pan
- Comments persist across page refresh (localStorage for solo, Y.js for collab)
- Host controls work correctly (enable/disable, delete, clear all)
- Author can delete own comments
- Rate limiting enforced (1/min viewer, 1/10s host) with UI + store validation
- No animations anywhere in comment system
- Mobile touch controls functional (tap-to-place and drag-to-align-crosshair)
- Comment panel displays chronological list with viewport recentering
- Performance remains smooth with 100 comments
- Three display states work correctly (minimal, preview, full)
- Timestamp toggle works (ISO absolute ↔ relative with proper units)

## Design Clarifications (2025-12-09)

### Interaction Flow
1. **Comment Mode Activation**: `c` → popup non-invasive hint about comment mode → click on layout → comment modal popup
2. **Cancellation**: ESC cancels at any step, click outside modal cancels placement
3. **Auto-exit**: Comment mode auto-disables after comment submission or cancellation

### Display State Transitions
- **Initial state**: Preview (showing first 140 characters)
- **Click once**: Expand to full content (up to 1000 characters)
- **Click again**: Collapse to minimal (user initials only)
- **Click anywhere else when full**: Toggle to preview

### Hold `c` Behavior
- Similar to `f` fullscreen key logic
- While holding `c`: show all comments (even if individually collapsed)
- When released: return to previous state
- Similar to layer panel show/hide all layers button

### Double-click `c` Detection
- Single tap: toggle comment mode
- Double tap (within interval): toggle comment panel
- Double-click replaces single-click behavior if detected within interval

### Mobile Comment Placement
- Both methods supported:
  1. Tap to enter mode → tap canvas to place at that location
  2. Tap to enter mode → drag to align center crosshair for precise positioning

### User Initials Display
- Use both initials from display name (e.g., "AA" for "Anonymous Aardvark")
- Every user has a name (Anonymous Animal pattern in ParticipantManager)
- **Decision**: Extract first letter of each word, ignore numeric suffixes
  - "Anonymous Aardvark" → "AA"
  - "Clever Koala 2" → "CK" (ignore the "2")
  - "Swift Fox" → "SF"

### Comment Deletion
- Host: can delete any comment
- Author: can delete own comments
- Confirmation: only if comment >140 characters
- Comments are cheap, no need for excessive confirmation

### File Hash for Solo Mode
- **Decision**: Use `fileName + fileSize` as localStorage key for solo mode (simpler than computing hash)
- Collaboration mode: Use file hash from server (already computed during upload)
- Solo mode: Use `gdsjam_comments_${fileName}_${fileSize}` as localStorage key
- File hash computation for solo mode is unnecessary complexity

### Viewport Recentering Priority
- Click comment in panel to recenter viewport
- **LOWEST priority tier** (same as viewer manual viewport adjustment)
- If host is broadcasting viewport: show same prompt as when viewer tries to adjust manually
- Implementation priority: **LAST / LOW PRIORITY**

### File Change Behavior
- All comments cleared immediately on file upload
- No retention across files or sessions
- No confirmation needed (comments are session/file-specific)

### Rate Limiting Enforcement
- **UI level**: Disable button, show message
- **Store level**: Validate and reject (safety layer)
- **Notification**: Show toast when rate limit is hit

### Coordinate Positioning
- Exact click position in world coordinates (no snapping)
- Comment bubble bottom-left corner positioned at the world coordinate point

---

## Technical Implementation Details (2025-12-09)

### Hold `c` Key Behavior
- **Trigger mechanism**: Same as `f` key (keydown/keyup with 500ms timer)
- **Show/hide logic**: Similar to layer panel "show all / hide all" toggle
  - If some comments are hidden: hold `c` shows all comments temporarily
  - If all comments are visible: hold `c` hides all comments temporarily
  - On key release: return to previous visibility state
- Implementation: Track previous visibility state, restore on keyup

### Comment Mode Cursor
- **Decision**: `cursor: crosshair` when comment mode is active on desktop
- Clear visual indication that user is in placement mode

### Mobile Crosshair Placement
- **Decision**: Fixed crosshair at viewport center (Option A)
- User pans viewport to position crosshair at desired location
- Tap "Place Comment" button to confirm placement at crosshair position
- Simpler UX than draggable crosshair

### Double-click Detection
- **Decision**: 300ms interval (standard double-click timing)
- Single tap `c`: toggle comment mode on/off
- Double tap `c` (within 300ms): toggle comment panel visibility
- If double-click detected, cancel single-click action

### Implementation Order
1. Phase 1: Data model & storage - COMPLETE
2. Phase 2: Comment creation (mode, modal, save) - COMPLETE
3. Phase 3: Comment display on canvas (bubbles, states, hold `c`) - COMPLETE
4. Phase 5: Mobile support (FAB buttons, placement) - NEXT
5. Phase 6: Integration & polish
6. **Phase 4 LAST**: Comment panel (list, recenter, host controls)

---

## Implementation Progress

### Phase 1: Data Model & Storage - COMPLETE (2025-12-09)

**Files Created:**
- `src/lib/comments/types.ts` - Type definitions for comment feature
- `src/lib/comments/utils.ts` - Utility functions (initials extraction, timestamp formatting)
- `src/stores/commentStore.ts` - Svelte store for comment state management
- `src/lib/collaboration/types.ts` (updated) - Added Comment and CommentPermissions interfaces

**Key Features Implemented:**
- Comment data model with display states (minimal/preview/full)
- Comment store with CRUD operations
- Rate limiting logic (viewer 1/min, host 1/10s)
- localStorage persistence for solo mode (key: `gdsjam_comments_${fileName}_${fileSize}`)
- Y.js sync preparation for collaboration mode
- Utility functions for user initials extraction and timestamp formatting

### Phase 2: Comment Creation - COMPLETE (2025-12-09)

**Files Created:**
- `src/components/comments/CommentInputModal.svelte` - Modal for creating comments

**Files Modified:**
- `src/components/viewer/ViewerCanvas.svelte` - Added comment mode, keyboard shortcuts, canvas click handler

**Key Features Implemented:**
- Comment mode toggle with `c` key
- Hold `c` (500ms) to temporarily show/hide all comments
- Double-click `c` (300ms) to toggle comment panel (TODO: implement panel in Phase 4)
- ESC key to cancel comment mode at any step
- Canvas click handler to place comments at world coordinates
- CommentInputModal with 1000 character limit
- Enter to submit, Shift+Enter for newline, ESC or click outside to cancel
- Crosshair cursor when comment mode is active
- Comment creation with UUID generation and user info
- Rate limiting enforcement before comment creation
- File initialization hook to initialize commentStore when file loads
  - Solo mode: uses fileName + fileSize
  - Collaboration mode: uses fileHash from session metadata

**Keyboard Shortcuts:**
- Single press `c`: toggle comment mode on/off
- Double press `c` (within 300ms): toggle comment panel (TODO)
- Hold `c` (500ms): temporarily show/hide all comments
- ESC: cancel comment mode or close modal

**Coordinate Transformation:**
- Screen coordinates → world coordinates using viewport state
- Y-axis flip handling (mainContainer.scale.y = -1)

**User Identity:**
- Solo mode: userId from localStorage or generate new UUID, displayName "You", color "#4ECDC4"
- Collaboration mode: userId, displayName, color from SessionManager

### Phase 3: Comment Display on Canvas - COMPLETE (2025-12-09)

**Files Created:**
- `src/components/comments/CommentBubble.svelte` - Comment bubble component

**Files Modified:**
- `src/components/viewer/ViewerCanvas.svelte` - Added comment bubble rendering
- `src/stores/commentStore.ts` - Added `cycleDisplayState()` method

**Key Features Implemented:**
- CommentBubble component with three display states:
  - **Minimal**: 24px circle with user initials (both initials, e.g., "AA")
  - **Preview**: Expanded bubble showing author name + first 140 characters
  - **Full**: Expanded bubble showing author name + full content (max 1000 chars)
- Click bubble to cycle through states: minimal → preview → full → minimal
- World coordinate → screen coordinate transformation for rendering
- Y-axis flip handling for correct positioning
- Comment bubbles positioned with bottom-left corner at world coordinate point
- Visibility controlled by `commentStore.allCommentsVisible`
- Dark theme styling matching scale bar (grey background, white outline, white text)
- NO animations - instant state transitions
- Keyboard accessibility (Enter key to activate)

**Display Styling:**
- Background: `rgba(60, 60, 60, 0.95)`
- Border: `1px solid rgba(255, 255, 255, 0.3)`
- Text color: `rgba(255, 255, 255, 0.9)` for author, `rgba(255, 255, 255, 0.8)` for content
- Font size: 11px (matching page footnote)
- Minimal state: 24px circle, 10px font, uppercase initials
- Preview/Full state: max-width 300px, 8px padding

**Bug Fixes (2025-12-09):**
1. **Comment bubbles not updating with viewport changes**
   - Added `viewportVersion` state that increments on every viewport change
   - Updated comment bubble rendering to use `viewportVersion` in the key
   - This forces re-evaluation of `worldToScreen()` on every viewport change
   - Comment bubbles now correctly follow viewport pan/zoom

2. **Text input modal not supporting space and keyboard shortcuts**
   - Added `event.stopPropagation()` in textarea keydown handler
   - Prevents global keyboard shortcuts from interfering with text input
   - Space, Ctrl+C, Ctrl+V, and all other text editing shortcuts now work correctly
   - ESC still works to cancel from both textarea and backdrop

**Next Steps for Phase 5 (Mobile Support):**
- Add comment button to FAB menu
- Add toggle button to show/hide comments
- Add button to open comment panel (Phase 4)
- Implement mobile comment placement (tap or drag crosshair)

---

### Future Enhancements
- Auto-toggle between minimal and preview states based on viewport zoom level to reduce clutter at zoomed-out views

