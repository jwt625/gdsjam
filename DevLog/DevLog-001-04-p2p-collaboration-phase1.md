# DevLog-001-04: P2P Collaboration - Phase 1 Implementation Plan

**Date:** 2024-11-23 (Started), 2024-11-24 (Updated)
**Status:** Phase 1.1 Complete, Phase 1.2 In Progress
**Related:** DevLog-001-mvp-implementation-plan.md (Week 2-3)

## Overview

This document outlines the detailed implementation plan for peer-to-peer collaboration features in GDSJam. The implementation is divided into phases, with Phase 1 focusing on session management, file sharing, and basic state synchronization (layer visibility and viewport awareness). Phase 2 (future work) will address commenting and annotations.

## Implementation Status

### Phase 1.1: Y.js Integration and Session Management (COMPLETE)

**Completed Components:**
- Y.js dependencies installed (yjs@13.6.27, y-webrtc@10.3.0, y-protocols@1.0.6)
- UUID utility extracted to shared module (`src/lib/utils/uuid.ts`)
- Collaboration infrastructure created:
  - `src/lib/collaboration/types.ts`: TypeScript interfaces for collaboration
  - `src/lib/collaboration/YjsProvider.ts`: Y.js and WebRTC provider wrapper
  - `src/lib/collaboration/SessionManager.ts`: High-level session management
  - `src/stores/collaborationStore.ts`: Svelte store for collaboration state
- Session UI integrated into `App.svelte` with create/join/leave controls
- URL-based session handling with `?room=<uuid>` parameter
- User ID persistence in localStorage
- Self-hosted signaling server deployed on OCI instance (146.235.193.141:4444)
- Environment variable configuration for signaling server URL and token
- GitHub Actions workflow updated to use secrets for deployment

**Current Functionality:**
- Users can create collaboration sessions and share session links
- Users can join sessions via URL
- User presence tracking via Y.js Awareness API
- User count displays correctly (2 users when two tabs/browsers join same session)
- Session state persists across page reloads

**Known Limitations:**
- WebRTC peer-to-peer connections not establishing (peers event not firing)
- User count currently relies on Awareness API fallback instead of WebRTC peers
- STUN servers configured but WebRTC connections still failing
- File transfer not yet implemented (Phase 1.2)
- Layer visibility sync not yet implemented (Phase 1.3)
- Viewport awareness not yet implemented (Phase 1.4)

**Technical Notes:**
- Signaling server successfully relays messages between clients
- Y.js Awareness state synchronization working correctly
- WebRTC connection failure likely due to browser restrictions or network configuration
- Awareness-based user tracking provides functional workaround for MVP
- Direct peer-to-peer connections will be required for efficient file transfer in Phase 1.2

**Temporary Workarounds in Code:**
- `src/stores/collaborationStore.ts` (lines 58-70): Awareness change listener updates user count when WebRTC peers event doesn't fire
- `src/lib/collaboration/SessionManager.ts` (lines 162-178): Falls back to Awareness client IDs when WebRTC peer IDs are empty
- These workarounds should be removed once WebRTC peer connections are established
- Workarounds are clearly marked with comments for easy identification and removal

## Architecture Summary

### Technology Stack
- **Y.js**: CRDT library for conflict-free state synchronization
- **y-webrtc**: WebRTC provider for peer-to-peer connections
- **WebRTC**: Direct browser-to-browser data transfer
- **Signaling Server**: Public Y.js signaling server for peer discovery

### Key Principles
- Pure peer-to-peer architecture (no backend required)
- First user to upload file becomes host
- Automatic host migration on disconnect
- File transferred as raw binary (not parsed JSON)
- Future-proof architecture for per-user layer settings

## Phase 1 Scope

Phase 1 implements the foundational collaboration features:

1. **Session Management**: Create and join sessions via shareable URLs
2. **File Sharing**: Transfer GDSII/DXF files between peers
3. **Layer Visibility Sync**: Shared layer state across all users
4. **Viewport Awareness**: Visual indicators of where other users are looking

Phase 1 explicitly excludes:
- Commenting and annotations (Phase 2)
- Per-user layer settings (future enhancement)
- Cursor sharing (future enhancement)
- Chat functionality (future enhancement)

## Technical Decisions

### Decision 1: File Identification and Validation

**Approach:** Session ID with hash-based validation

**Implementation:**
- User creates session: Generate UUID using existing `generateUUID()` utility (see `src/lib/gds/GDSParser.ts` lines 23-34)
- UUID generation includes Safari iOS fallback (crypto.randomUUID() not supported in older Safari)
- Session URL format: `https://gdsjam.com/?room=<uuid>`
- File hash: SHA-256 of raw file binary (computed asynchronously after upload)
- Hash stored in Y.js for validation when new peers join
- Late joiners compare their file hash before fully joining session

**Note:** The `generateUUID()` function should be extracted from `GDSParser.ts` to a shared utility file `src/lib/utils/uuid.ts` to avoid duplication (currently duplicated in `GDSParser.ts` and `DxfToGdsConverter.ts`).

**Rationale:**
- Session ID provides simple, shareable links
- Hash validation ensures all users view identical files
- Async hashing avoids blocking UI during upload
- Future capability: Track file versions if layout is modified

**Data Structure:**
```typescript
ydoc.getMap('session') = {
  sessionId: string,
  fileHash: string,        // SHA-256 hex string
  fileName: string,
  fileSize: number,
  uploadedBy: string,      // User ID of host
  uploadedAt: number,      // Unix timestamp
  createdAt: number
}
```

### Decision 2: Geometry Transfer Strategy

**Approach:** Transfer raw GDSII/DXF file binary (not parsed GDSDocument)

**Implementation:**
- Host uploads file, stores ArrayBuffer in memory
- Chunk file into 1MB pieces
- Store chunks in Y.js Array: `ydoc.getArray('fileChunks')`
- Y.js automatically syncs chunks to all peers via WebRTC
- Peers download chunks with progress indicator
- Each peer parses file independently after download completes

**Rationale:**
- Smaller transfer size: Compressed GDSII (150MB) vs JSON-serialized GDSDocument (potentially larger)
- Preserves original file perfectly (no serialization artifacts)
- Distributes parsing CPU load across all peers
- Format-agnostic: Works for GDSII, DXF, OASIS, or future formats
- Simpler implementation: Just transfer ArrayBuffer chunks

**Trade-offs:**
- Each peer must parse independently (2-3 seconds per peer)
- Duplicate parsing work across peers
- Acceptable trade-off: Parsing is fast, avoids serialization complexity

**Chunking Strategy:**
- Chunk size: 1MB (balance between transfer efficiency and memory usage)
- Progress tracking: `(chunksReceived / totalChunks) * 100`
- Compression: GDSII files are already compressed, no additional compression needed

### Decision 3: Layer Visibility Synchronization

**MVP Approach:** Shared layer state (all users see same layers)

**Implementation:**
- Single global Y.Map for layer visibility
- Structure: `Y.Map<layerKey, boolean>` where key is `"layer:datatype"`
- Any user can toggle layers
- Changes sync immediately to all peers via Y.js CRDT
- Y.js handles conflict resolution automatically (last write wins with logical timestamps)

**Future-Proof Architecture:**
- Abstract `LayerSyncStrategy` interface
- MVP implements `SharedLayerSync` strategy
- Future implements `PerUserLayerSync` strategy
- Zero changes to UI components when switching strategies

**Data Structure (MVP):**
```typescript
ydoc.getMap('layerVisibility') = {
  "1:0": true,
  "2:0": false,
  "3:0": true,
  // ... all layers
}
```

**Data Structure (Future - Per-User):**
```typescript
ydoc.getMap('layerVisibilityPerUser') = {
  "user-123": Y.Map({ "1:0": true, "2:0": false, ... }),
  "user-456": Y.Map({ "1:0": false, "2:0": true, ... })
}

ydoc.getMap('session') = {
  // ... existing fields
  layerSyncMode: "shared" | "independent"
}
```

**Migration Path:**
- Check `session.layerSyncMode` field
- If undefined or "shared": Use shared layer state (MVP behavior)
- If "independent": Use per-user maps
- Backward compatible: Old sessions continue working

**Rationale:**
- Shared state matches primary use case: Collaborative review
- Simpler MVP implementation
- Interface-based design allows future expansion
- Per-user settings only synced on demand (not continuous broadcast)

### Decision 4: Viewport Awareness

**Approach:** Continuous sync with on-demand navigation

**Implementation:**
- Each user broadcasts viewport state to Y.js (throttled to 200ms)
- Viewport state includes: position (x, y), scale, and screen dimensions
- Render colored rectangles on canvas showing other users' viewports
- User list shows all connected users with assigned colors
- Click viewport rectangle or "Jump to User X" button to navigate to their view
- No automatic follow mode in MVP

**Data Structure:**
```typescript
ydoc.getMap('viewports') = {
  "user-123": {
    x: number,           // Container x position
    y: number,           // Container y position
    scale: number,       // Zoom scale
    width: number,       // Screen width in pixels
    height: number,      // Screen height in pixels
    updatedAt: number    // Timestamp for staleness detection
  },
  "user-456": { ... }
}
```

**UI Components:**
- Viewport rectangles: Thin outline (2px), low opacity fill (0.1), user's assigned color
- User list panel: Shows all users with color indicators
- Each user assigned consistent color from palette
- Stale viewport detection: Fade out if not updated in 5 seconds

**Rationale:**
- Continuous sync provides real-time awareness
- Throttling (200ms) reduces network traffic
- On-demand navigation gives users control
- Visual rectangles provide spatial context
- No auto-follow prevents disorienting viewport jumps

**Future Enhancements:**
- Follow mode: Lock viewport to another user
- Minimap: Show viewport rectangles on minimap overlay
- Viewport history: Breadcrumb trail of where users have looked

### Decision 5: Session Management

**Approach:** URL-based sessions with UUID identifiers

**Implementation:**
- Create session: Generate UUID, navigate to `?room=<uuid>`
- Join session: Open link with `?room=<uuid>` parameter
- Session state persists in URL (shareable, bookmarkable)
- No server-side session storage
- Session exists as long as at least one peer is connected

**User Flow:**

**Host (First User):**
1. Open GDSJam
2. Upload GDSII file
3. Click "Create Session" button
4. UUID generated, URL updates to `?room=<uuid>`
5. Copy shareable link
6. Share link with collaborators

**Peer (Joining User):**
1. Open shared link `?room=<uuid>`
2. Connect to Y.js room via y-webrtc
3. Download file chunks from host
4. Parse file locally
5. Join session, see same layout as host

**Edge Cases:**
- Empty session (no file uploaded): Show "Waiting for host to upload file"
- File hash mismatch: Show warning "Your file differs from session file"
- All users disconnect: Session ends, no persistence

**Rationale:**
- Simple implementation: No backend, no database
- Shareable links: Easy to communicate
- URL persistence: Bookmark to rejoin later (if session still active)
- No name collisions: UUIDs are globally unique

**Future Enhancements:**
- Named sessions: Optional user-friendly names
- Session persistence: Save session state to IndexedDB for offline recovery
- Session history: List of recently joined sessions

### Decision 6: Host Disconnection Handling

**Approach:** Automatic host migration (seamless failover)

**Implementation:**
- Detect host disconnect via WebRTC peer connection close event
- Elect new host: First peer in alphabetically sorted peer ID list
- New host already has file (downloaded when they joined)
- New host takes over geometry ownership
- Show notification: "User A disconnected. User B is now the host."
- Session continues without interruption

**Host Responsibilities:**
- Original host: Uploads file, stores chunks in Y.js
- Migrated host: Already has file, no re-upload needed
- All hosts: Respond to file chunk requests from new peers

**Rationale:**
- Seamless UX: No user intervention required
- Reliable: Works even if host force-quits browser
- Simple implementation: Deterministic election (alphabetical sort)
- No data loss: All peers already have file

**Alternative Considered (Rejected):**
- Prompt host before close: Unreliable due to browser `beforeunload` restrictions
- Session ends on host disconnect: Poor UX, forces restart

**Edge Cases:**
- New host disconnects immediately: Elect next peer in list
- All peers disconnect simultaneously: Session ends (expected behavior)
- Network partition: Each partition elects own host, re-merge when reconnected

**Future Enhancements:**
- Explicit host transfer: "Make User X the host" button
- Host privileges: Only host can upload new file versions
- Host indicators: Crown icon next to host name in user list

## Implementation Phases

### Phase 1.1: Y.js Integration and Session Management (Week 2)

**Goal:** Establish basic P2P connectivity and session creation.

**Tasks:**
1. Install dependencies: `pnpm add yjs y-webrtc`
2. Extract `generateUUID()` from `GDSParser.ts` to `src/lib/utils/uuid.ts` (shared utility)
3. Update `GDSParser.ts` and `DxfToGdsConverter.ts` to import from shared utility
4. Create `YjsProvider` class to wrap Y.js and y-webrtc
5. Implement session creation (UUID generation using shared utility)
6. Implement session joining (read `?room=` parameter)
7. Add user ID generation and persistence (localStorage)
8. Test peer discovery with 2 browser windows

**Deliverables:**
- `src/lib/utils/uuid.ts` (shared UUID utility)
- `src/lib/collaboration/YjsProvider.ts`
- `src/lib/collaboration/SessionManager.ts`
- Session creation UI in App.svelte
- URL parameter handling

**Success Criteria:**
- Two browser windows can connect to same session
- Peer list updates when users join/leave
- Console logs show WebRTC connection established

### Phase 1.2: File Transfer (Week 2-3)

**Goal:** Transfer GDSII files between peers.

**Tasks:**
1. Implement file chunking (1MB chunks)
2. Store chunks in Y.js Array
3. Implement chunk download with progress tracking
4. Compute SHA-256 hash asynchronously
5. Validate file hash on peer join
6. Handle file transfer errors and retries

**Deliverables:**
- `src/lib/collaboration/FileTransfer.ts`
- Progress indicator UI component
- File hash validation logic

**Success Criteria:**
- Host uploads 150MB file, chunks stored in Y.js
- Peer downloads all chunks with progress indicator (0-100%)
- Peer parses file successfully
- File hash matches between host and peer
- Transfer completes in reasonable time (< 30 seconds on good connection)

**Performance Targets:**
- Chunk transfer: 5-10 MB/s (typical WebRTC throughput)
- 150MB file: 15-30 seconds transfer time
- Memory usage: < 500MB during transfer (chunked processing)

### Phase 1.3: Layer Visibility Sync (Week 3)

**Goal:** Synchronize layer visibility across all users.

**Tasks:**
1. Create `LayerSyncStrategy` interface
2. Implement `SharedLayerSync` class
3. Integrate with existing `layerStore`
4. Add Y.js observer for remote layer changes
5. Update LayerPanel to show sync status
6. Test with 3+ users toggling layers simultaneously

**Deliverables:**
- `src/lib/collaboration/LayerSyncStrategy.ts` (interface)
- `src/lib/collaboration/SharedLayerSync.ts` (MVP implementation)
- Updated `src/stores/layerStore.ts` with sync integration
- Sync indicator in LayerPanel UI

**Success Criteria:**
- User A toggles layer, User B sees change within 100ms
- Simultaneous toggles resolve correctly (no conflicts)
- Layer state persists when new user joins
- Sync indicator shows "Synced" or "Syncing" status

**Edge Cases to Test:**
- Rapid toggling (10+ toggles per second)
- Network latency (simulate with Chrome DevTools throttling)
- Conflicting changes (User A shows layer, User B hides simultaneously)

### Phase 1.4: Viewport Awareness (Week 3)

**Goal:** Show where other users are looking.

**Tasks:**
1. Sync viewport state to Y.js (throttled 200ms)
2. Render viewport rectangles for other users
3. Assign colors to users (consistent across session)
4. Implement user list panel with colors
5. Add "Jump to User X's view" functionality
6. Handle viewport staleness (fade out after 5 seconds)

**Deliverables:**
- `src/lib/collaboration/ViewportSync.ts`
- `src/components/ui/UserListPanel.svelte`
- Viewport rectangle rendering in PixiRenderer
- Color assignment logic

**Success Criteria:**
- User A pans/zooms, User B sees rectangle update within 200ms
- Rectangles render correctly with Y-axis flip
- Click rectangle animates to that viewport
- User list shows all connected users with colors
- Stale viewports fade out after 5 seconds of inactivity

**UI Design:**
- Viewport rectangles: 2px stroke, 10% fill opacity
- User colors: Palette of 8 distinct colors (cycle if > 8 users)
- User list: Fixed panel, top-right, collapsible
- Animation: Smooth zoom/pan transition (500ms ease-out)

## Data Flow Diagrams

### Session Creation and File Transfer

```
Host (User A):
1. Upload GDSII file (150MB)
2. Generate session UUID
3. Update URL: ?room=abc-123
4. Chunk file into 1MB pieces (150 chunks)
5. Store chunks in ydoc.getArray('fileChunks')
6. Compute SHA-256 hash (async)
7. Store hash in ydoc.getMap('session')
8. Share URL with peers

Peer (User B):
1. Open URL: ?room=abc-123
2. Connect to Y.js room via y-webrtc
3. Discover User A via signaling server
4. Establish WebRTC connection to User A
5. Y.js syncs fileChunks array (150 chunks)
6. Progress: (chunksReceived / 150) * 100%
7. All chunks received
8. Reassemble ArrayBuffer
9. Parse GDSII file (2-3 seconds)
10. Compute SHA-256 hash
11. Validate hash matches session.fileHash
12. Render layout
13. Join session (ready to collaborate)
```

### Layer Visibility Sync

```
User A toggles layer "1:0" to hidden:
1. User A clicks checkbox in LayerPanel
2. layerStore.toggleLayer("1:0")
3. SharedLayerSync.syncLayerToggle("1:0", false)
4. Y.js: ydoc.getMap('layerVisibility').set("1:0", false)
5. Y.js CRDT: Broadcast change to all peers via WebRTC
6. User B receives Y.js update event
7. SharedLayerSync observer fires
8. layerStore.setLayerVisibility("1:0", false)
9. LayerPanel re-renders (checkbox unchecked)
10. gdsStore.toggleLayerVisibility("1:0")
11. PixiRenderer updates visibility
12. Layer "1:0" hidden on User B's screen

Total latency: 50-100ms (typical WebRTC)
```

### Viewport Awareness

```
User A pans viewport:
1. User A drags canvas (mouse move)
2. InputController updates mainContainer.position
3. PixiRenderer detects viewport change
4. Throttled update (200ms): ViewportSync.updateViewport()
5. Y.js: ydoc.getMap('viewports').set('user-A', { x, y, scale, ... })
6. Y.js broadcasts to all peers
7. User B receives viewport update
8. ViewportSync observer fires
9. Calculate rectangle bounds in world coordinates
10. Render rectangle on User B's canvas
11. User B sees colored rectangle showing User A's view

User B clicks "Jump to User A":
1. User B clicks button in UserListPanel
2. Read User A's viewport from Y.js
3. Animate mainContainer to User A's position/scale
4. Animation: 500ms ease-out transition
5. User B now sees same view as User A
```

## Testing Strategy

### Unit Tests
- `YjsProvider`: Session creation, peer connection, disconnect handling
- `FileTransfer`: Chunking, reassembly, hash computation, validation
- `SharedLayerSync`: Toggle sync, conflict resolution, observer callbacks
- `ViewportSync`: Throttling, coordinate conversion, staleness detection

### Integration Tests
- End-to-end session creation and join
- File transfer with progress tracking
- Layer visibility sync with multiple users
- Viewport sync with rapid pan/zoom

### Manual Testing Scenarios
1. **Two-user collaboration**: Host uploads file, peer joins, both toggle layers
2. **Three-user collaboration**: Test conflict resolution with simultaneous changes
3. **Host disconnect**: Verify automatic host migration
4. **Network interruption**: Disconnect WiFi, reconnect, verify state recovery
5. **Large file transfer**: 150MB file, verify progress and completion
6. **Viewport awareness**: Pan/zoom, verify rectangles update correctly

### Performance Benchmarks
- File transfer throughput: Target 5-10 MB/s
- Layer toggle latency: Target < 100ms peer-to-peer
- Viewport update latency: Target < 200ms (throttled)
- Memory usage during transfer: Target < 500MB
- Y.js document size: Target < 200MB (file + metadata)

## Security and Privacy Considerations

### Data Privacy
- All data transferred peer-to-peer (no server storage)
- Files never leave users' browsers
- Signaling server only sees connection metadata (not file content)
- Session ends when all users disconnect (no persistence)

### Access Control
- Sessions are private by default (UUID is secret)
- Anyone with session URL can join (no authentication in MVP)
- No user verification (trust-based model)

### Future Security Enhancements
- Password-protected sessions
- User authentication (GitHub OAuth)
- End-to-end encryption (encrypt file chunks before Y.js sync)
- Session expiration (auto-close after 24 hours)
- Rate limiting (prevent spam joins)

## Known Limitations and Future Work

### MVP Limitations
1. **No persistence**: Session lost when all users disconnect
2. **No version control**: Cannot track file changes over time
3. **No access control**: Anyone with URL can join
4. **WebRTC reliability**: May fail behind restrictive firewalls (20% of users)
5. **Large file transfer**: 150MB takes 15-30 seconds (acceptable but not instant)

### Post-MVP Enhancements (Phase 2+)
1. **Commenting system**: Pin comments to specific coordinates
2. **Cursor sharing**: See other users' mouse cursors in real-time
3. **Per-user layer settings**: Independent layer visibility with sharing
4. **Measurement tools**: Collaborative rulers and annotations
5. **Session persistence**: Save to IndexedDB, restore on rejoin
6. **TURN server**: Fallback for restrictive networks (requires hosting)
7. **WebRTC connection debugging**: Investigate and resolve peer connection failures

## Next Steps

### Immediate (Phase 1.2)
1. Debug WebRTC peer connection failures
2. Implement file transfer using Y.js shared types
3. Add file hash validation
4. Create file transfer progress UI

### Short-term (Phase 1.3-1.4)
1. Implement layer visibility synchronization
2. Add viewport awareness indicators
3. Complete Phase 1 testing and documentation

### Configuration Required
- Add GitHub Secrets for deployment:
  - `VITE_SIGNALING_SERVER_URL`: ws://146.235.193.141:4444
  - `VITE_SIGNALING_SERVER_TOKEN`: (authentication token)
- Make OCI instance firewall rule persistent:
  ```bash
  sudo apt install iptables-persistent
  # Save current rules when prompted
  ```

## Success Metrics

### Phase 1 Completion Criteria
- [ ] Two users can create and join sessions via URL
- [ ] File transfer works for 150MB GDSII files
- [ ] Layer visibility syncs across all users within 100ms
- [ ] Viewport rectangles show where other users are looking
- [ ] Host migration works seamlessly on disconnect
- [ ] All unit tests pass
- [ ] Manual testing scenarios complete successfully
- [ ] Performance benchmarks meet targets

### User Experience Goals
- Session creation: < 5 seconds (UUID generation + URL update)
- File transfer: < 30 seconds for 150MB file
- Layer toggle latency: < 100ms perceived delay
- Viewport awareness: Real-time updates (< 200ms)
- Zero configuration: No server setup required
- Intuitive UI: No collaboration training needed

## Timeline

**Week 2 (5 days):**
- Days 1-2: Y.js integration and session management
- Days 3-5: File transfer implementation

**Week 3 (5 days):**
- Days 1-2: Layer visibility sync
- Days 3-4: Viewport awareness
- Day 5: Testing and bug fixes

**Total: 10 days for Phase 1 completion**

## Conclusion

Phase 1 establishes the foundation for real-time collaboration in GDSJam. By focusing on session management, file sharing, and basic state synchronization, we enable multiple users to view and discuss GDSII layouts together. The architecture is designed to be extensible, with clear paths for adding per-user settings, commenting, and other advanced features in future phases.

The peer-to-peer approach eliminates backend costs and complexity while providing low-latency collaboration. Automatic host migration ensures sessions remain stable even as users join and leave. The implementation prioritizes simplicity and reliability for the MVP while maintaining flexibility for future enhancements.


