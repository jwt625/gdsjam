# DevLog 001-07: P2P File Sync Debugging

**Date:** 2024-11-24  
**Status:** In Progress  
**Related:** DevLog-001-04, DevLog-001-05, DevLog-001-06

## Problem Statement

File synchronization between peers in different browsers was failing. Symptoms:
- Same browser, different tabs: File transfer worked
- Different browsers: File transfer failed
- Console showed repeated `0/1 chunks` messages
- WebRTC peer connections established successfully
- Y.js Awareness API syncing correctly (user count, metadata)
- Y.js Document sync failing (file chunks not arriving)

## Root Cause Analysis

### Initial Hypothesis: BroadcastChannel vs WebRTC

Y.js uses two mechanisms for syncing:
1. **BroadcastChannel API**: Browser-native communication for same-browser tabs
2. **WebRTC Data Channels**: Peer-to-peer network connections for cross-browser sync

Configuration parameter `filterBcConns` controls this behavior:
- `filterBcConns: false` (default): Use BroadcastChannel for same-browser, WebRTC for different browsers
- `filterBcConns: true`: Force WebRTC for all connections

**Finding:** Changed `filterBcConns: false` to `filterBcConns: true` in `src/lib/collaboration/YjsProvider.ts` line 116.

**Result:** After hard refresh (Cmd+Shift+R), same-browser file transfer also failed, confirming WebRTC was now being used but not working correctly.

### WebRTC Connection Verification

Created test page `test-webrtc-simple.html` to verify WebRTC infrastructure:
- Signaling server: Working
- TURN server: Working
- WebRTC peer connections: Establishing successfully
- Data channels: Opening successfully
- File chunks: Syncing correctly in test environment

**Conclusion:** WebRTC infrastructure is functional. Issue is in application code.

### File Upload Flow Analysis

Traced file upload path:
1. `FileUpload.svelte` line 38-44: Checks `isInSession && isHost`
2. `collaborationStore.uploadFile()`: Calls SessionManager
3. `SessionManager.uploadFile()`: Creates FileTransfer instance
4. `FileTransfer.uploadFile()`: Chunks file and stores in Y.js

Console logs from host browser:
```
[FileUpload] Uploading file to collaboration session...
[FileTransfer] Created 1 chunks
[FileTransfer] Pushed chunk 1/1, array length now: 1
[FileTransfer] Final chunks array length: 1
[FileTransfer] File chunks count: 1
```

**Finding:** File chunks ARE being added to Y.js document on host side.

### Y.js Document State Investigation

Added debug logging to verify Y.js state after upload:

**Host side (after upload):**
- Session map: Contains all metadata (fileHash, fileName, fileSize, uploadedBy, uploadedAt)
- File chunks array: Length = 1 (correct)
- Y.js broadcast messages: Sent for session map updates
- Y.js broadcast messages: Sent for chunks array update (line 91)

**Peer side (after connection):**
- Session map: Empty `[]`
- File chunks array: Length = 0
- WebRTC peer connections: Established (2 peers connected)
- Y.js Awareness: Working (3 clients visible)

Console logs from peer browser:
```
y-webrtc: connected to 1832cbe1-1412-468c-a211-0820d580322b
y-webrtc: connected to 1c59b5b5-c914-43d2-8981-e68654f5bdbf
- Session map keys: []
- File chunks count: 0
```

## Current Status

**Confirmed:**
- File chunks are stored in Y.js document on host
- WebRTC connections establish between peers
- Y.js broadcasts chunk updates
- Chunks do not arrive on peer side

**Hypothesis:**
Y.js document synchronization is not occurring despite WebRTC connections being established. Possible causes:
1. Y.js provider not properly syncing document state
2. WebRTC data channels not fully opened when chunks are sent
3. Initial document state not being synced to new peers
4. Timing issue: chunks added before peer connects

## Next Steps

1. Verify peer receives Y.js document updates by checking peer-side console logs
2. Check if initial document state is synced when peer joins
3. Investigate Y.js provider sync events and timing
4. Consider adding explicit sync trigger after peer connection
5. Review y-webrtc provider initialization and sync behavior

## Technical Details

### File Transfer Architecture

**Chunking:**
- Chunk size: 1MB (`CHUNK_SIZE = 1024 * 1024`)
- Storage: Y.js Array `ydoc.getArray('fileChunks')`
- Metadata: Y.js Map `ydoc.getMap('session')`

**Upload Process:**
```typescript
const chunksArray = this.ydoc.getArray<Uint8Array>("fileChunks");
chunksArray.delete(0, chunksArray.length); // Clear existing
for (let i = 0; i < chunks.length; i++) {
    chunksArray.push([chunks[i]]);
}
```

**Download Process:**
```typescript
const chunksArray = this.ydoc.getArray<Uint8Array>("fileChunks");
// Poll every 100ms waiting for chunks to arrive
await this.waitForChunks(chunksArray, expectedChunks);
```

### Y.js Provider Configuration

```typescript
this.provider = new WebrtcProvider(roomName, this.ydoc, {
    signaling: [signalingServerUrl],
    password: undefined,
    awareness: this.awareness,
    maxConns: 20,
    filterBcConns: true, // Force WebRTC
    peerOpts: {
        config: {
            iceServers,
            iceTransportPolicy: "all",
        },
    },
});
```

## References

- y-webrtc documentation: https://github.com/yjs/y-webrtc
- Y.js documentation: https://docs.yjs.dev/
- WebRTC Data Channels: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels
- BroadcastChannel API: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel

