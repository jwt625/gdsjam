# Client-Side File Storage Integration

**Date:** 2025-11-24
**Status:** Implementation Complete - Ready for Testing
**Related:** DevLog-001-08 (Server-Side File Storage)

## Overview

Update client to use server-side file storage instead of Y.js-based P2P file transfer.

**Changes:**
- Remove file chunking logic from FileTransfer.ts
- Replace Y.js file chunk storage with HTTP upload/download
- Store only file metadata in Y.js (fileId, fileName, fileSize, fileHash)
- Add download progress UI

## Client Implementation

### Step 1: Add Environment Variables

**File:** `.env.example`

Add:
```bash
# File Server Configuration
VITE_FILE_SERVER_URL=https://signaling.gdsjam.com
VITE_FILE_SERVER_TOKEN=your-token-here
```

**File:** `.env.production`

Add (use GitHub Secrets for token):
```bash
VITE_FILE_SERVER_URL=https://signaling.gdsjam.com
# VITE_FILE_SERVER_TOKEN=<set-in-github-secrets>
```

### Step 2: Update FileTransfer.ts

**Current behavior:**
- Chunks file into 16KB pieces
- Stores chunks in Y.js Array
- Stores metadata in Y.js Map
- Client polls for chunks to arrive

**New behavior:**
- Upload file to server via POST /api/files/upload
- Store fileId in Y.js Map (no chunks)
- Client downloads file via GET /api/files/:fileId when metadata appears

**Changes to uploadFile():**

1. Remove chunking logic (lines 86-110)
2. Compute SHA-256 hash (keep existing code)
3. Upload file to server:
```typescript
const formData = new FormData();
formData.append('file', new Blob([arrayBuffer]));
formData.append('fileHash', fileHash);

const response = await fetch(`${fileServerUrl}/api/files/upload`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${fileServerToken}`
  },
  body: formData
});

const { fileId } = await response.json();
```
4. Store metadata in Y.js (single transaction):
```typescript
this.ydoc.transact(() => {
  const sessionMap = this.ydoc.getMap<any>("session");
  sessionMap.set("fileId", fileId);
  sessionMap.set("fileName", fileName);
  sessionMap.set("fileSize", arrayBuffer.byteLength);
  sessionMap.set("fileHash", fileHash);
  sessionMap.set("uploadedBy", userId);
  sessionMap.set("uploadedAt", Date.now());
});
```

**Changes to downloadFile():**

1. Remove chunk polling logic (lines 243-290)
2. Wait for fileId in session map
3. Download file from server:
```typescript
const sessionMap = this.ydoc.getMap<any>("session");
const fileId = sessionMap.get("fileId");
const fileHash = sessionMap.get("fileHash");

const response = await fetch(`${fileServerUrl}/api/files/${fileId}`, {
  headers: {
    'Authorization': `Bearer ${fileServerToken}`
  }
});

const arrayBuffer = await response.arrayBuffer();

// Validate hash
const downloadedHash = await computeSHA256(arrayBuffer);
if (downloadedHash !== fileHash) {
  throw new Error("File hash mismatch");
}

return { arrayBuffer, fileName };
```

**Changes to isFileAvailable():**

Replace chunk count check with fileId check:
```typescript
isFileAvailable(): boolean {
  const sessionMap = this.ydoc.getMap<any>("session");
  return sessionMap.has("fileId");
}
```

**Remove:**
- `CHUNK_SIZE` constant
- `waitForChunks()` method
- All chunk-related progress tracking

### Step 3: Update SessionManager.ts

No changes needed. Session creation/joining logic remains the same.

### Step 4: Update YjsProvider.ts

**CRITICAL: NEVER ENABLE BROADCASTCHANNEL**

**DO NOT CHANGE filterBcConns - it must remain `true`**

BroadcastChannel causes issues with file sync and session state management.
Always force WebRTC connections even for same-browser tabs.

```typescript
this.provider = new WebrtcProvider(roomName, this.ydoc, {
  signaling: [signalingServerUrl],
  password: undefined,
  awareness: this.awareness,
  maxConns: 20,
  filterBcConns: true, // NEVER change to false - BroadcastChannel causes issues
  peerOpts: {
    config: {
      iceServers,
      iceTransportPolicy: "all",
    },
  },
});
```

**No changes needed to YjsProvider.ts for this update.**

### Step 5: Update App.svelte

**Current behavior:**
- Polls for file chunks with 20 retries (10 seconds)
- Shows "Waiting for file... (N/20)"

**New behavior:**
- Wait for fileId in session metadata
- Download file from server
- Show download progress

**Changes:**

Replace polling logic (lines 36-76) with:
```typescript
// Wait for file metadata
const fileTransfer = new FileTransfer(
  sessionManager.getYjsProvider(),
  (progress, message) => {
    collaborationStore.updateFileTransferProgress(progress, message);
  }
);

if (await fileTransfer.isFileAvailable()) {
  const { arrayBuffer, fileName } = await fileTransfer.downloadFile();
  await loadGDSIIFromBuffer(arrayBuffer, fileName);
} else {
  // Wait for metadata to appear
  const sessionMap = sessionManager.getYjsProvider().getMap("session");
  sessionMap.observe(() => {
    if (fileTransfer.isFileAvailable()) {
      fileTransfer.downloadFile().then(({ arrayBuffer, fileName }) => {
        loadGDSIIFromBuffer(arrayBuffer, fileName);
      });
    }
  });
}
```

### Step 6: Add Download Progress UI

**File:** `src/components/ui/FileUpload.svelte`

Add progress indicator for downloads (similar to upload progress).

**File:** `src/stores/collaborationStore.ts`

Update `fileTransferProgress` to show download progress:
- "Downloading file... (X MB / Y MB)"
- Progress percentage based on fetch response

### Step 7: Error Handling

Add error handling for:
- Network failures (retry with exponential backoff)
- Server errors (show user-friendly message)
- Hash mismatch (re-download or show error)
- File not found (host may have left session)

**Retry logic:**
```typescript
async function downloadWithRetry(url: string, maxRetries = 3): Promise<ArrayBuffer> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}
```

## Testing

### Local Testing

1. Start dev server: `pnpm run dev`
2. Create session and upload file (host)
3. Join session in new tab (client)
4. Verify file downloads and renders correctly
5. Check browser console for errors
6. Verify hash validation works

### Production Testing

1. Deploy to GitHub Pages
2. Test with production file server (signaling.gdsjam.com)
3. Test with large files (50+ MB)
4. Test with slow network (throttle in DevTools)
5. Test error cases (server down, invalid fileId)

## Migration Notes

**Breaking Changes:**
- Old sessions with Y.js chunks will not work with new client
- Need to clear Y.js document or create new sessions

**Backward Compatibility:**
- Not required for MVP (no production users yet)
- If needed, add fallback to check for chunks array

## Deployment Checklist

- [x] Update .env.example and .env.production
- [x] Refactor FileTransfer.ts (remove chunking)
- [x] Verify YjsProvider.ts (filterBcConns MUST remain true - NEVER enable BroadcastChannel)
- [x] Update App.svelte (new download logic)
- [x] Add download progress UI (via collaborationStore.updateFileTransferProgress)
- [x] Add error handling and retry logic (downloadWithRetry with exponential backoff)
- [ ] Test locally with dev server (USER will test)
- [ ] Update GitHub Secrets (VITE_FILE_SERVER_TOKEN)
- [ ] Deploy to GitHub Pages
- [ ] Test production deployment
- [ ] Monitor browser console for errors

## Performance Considerations

**Upload:**
- No chunking needed (browser handles large FormData)
- Show upload progress with XMLHttpRequest or fetch + ReadableStream

**Download:**
- Stream large files with fetch + ReadableStream
- Show progress based on Content-Length header
- Consider caching downloaded files in IndexedDB (future optimization)

**Y.js Sync:**
- Metadata-only sync is fast (< 1KB)
- No more RTCDataChannel buffer issues
- **BroadcastChannel is DISABLED** - WebRTC is used even for same-browser tabs (filterBcConns: true)

## Next Steps

1. Implement server-side changes (DevLog-001-08)
2. Implement client-side changes (this document)
3. Test end-to-end file upload/download
4. Monitor server bandwidth and storage usage
5. Consider future optimizations (IndexedDB caching, CDN)

