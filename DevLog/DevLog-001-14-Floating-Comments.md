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
- Every user has a name (check existing user name handling code)

### Comment Deletion
- Host: can delete any comment
- Author: can delete own comments
- Confirmation: only if comment >140 characters
- Comments are cheap, no need for excessive confirmation

### File Hash for Solo Mode
- Use file hash for localStorage key (same as collaboration)
- File hash should be computed for solo mode uploads (verify implementation)

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

### Future Enhancements
- Auto-toggle between minimal and preview states based on viewport zoom level to reduce clutter at zoomed-out views

