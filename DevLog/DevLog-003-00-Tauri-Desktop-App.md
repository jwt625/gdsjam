# DevLog-003-00: Tauri Desktop App Implementation

## Metadata
- **Document Version:** 1.0
- **Created:** 2025-11-30
- **Author:** Wentao Jiang
- **Status:** Planning
- **Related Issues:** #41 (watch local file and update automatically)
- **Related Documents:** DevLog-001-mvp-implementation-plan.md

## Changelog
- **v1.0 (2025-11-30):** Initial planning document

---

## Executive Summary

This document outlines the implementation plan for converting gdsjam from a web-only application to a hybrid web/desktop application using Tauri. The primary motivation is to enable local file watching and automatic refresh functionality (Issue #41), which is not possible in web browsers due to security restrictions.

## Problem Statement

**Issue #41: Watch local file and update automatically**

In the current web-only implementation:
- Users upload files via `<input type="file">` or drag-and-drop
- Browser security prevents saving file paths or re-accessing files
- No automatic file watching is possible
- Users must manually re-upload files after external changes

This creates friction for iterative design workflows where users frequently modify GDS files in external tools and want to see updates in gdsjam immediately.

## Solution: Tauri Desktop App

### Why Tauri Over Alternatives

| Framework | Bundle Size | Memory | Backend | Maturity | Verdict |
|-----------|-------------|--------|---------|----------|---------|
| **Tauri** | 3-5 MB | System WebView | Rust | Mature (v1.0+) | **SELECTED** |
| Electron | 50-100 MB | Bundled Chromium | Node.js | Very Mature | Too heavy |
| Neutralinojs | 1-2 MB | System browser | C++ | Less mature | Limited APIs |

**Decision: Tauri**

Rationale:
1. **Minimal bundle size** (3-5 MB vs Electron's 50-100 MB)
2. **Low memory footprint** (uses system WebView instead of bundling browser)
3. **Zero changes to existing codebase** (Vite + Svelte + TypeScript work as-is)
4. **Native file system APIs** (file watching, path persistence, dialog pickers)
5. **Cross-platform** (macOS, Windows, Linux with single codebase)
6. **Modern architecture** (Rust backend is fast, safe, and actively maintained)
7. **Active development** (Tauri 2.0 recently released with improved APIs)

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri Desktop App                        │
├─────────────────────────────────────────────────────────────┤
│  Frontend (Unchanged)                                        │
│  ├─ Svelte 5 + TypeScript                                   │
│  ├─ Vite build system                                       │
│  ├─ Pixi.js renderer                                        │
│  ├─ Y.js collaboration (still works for web version)       │
│  └─ All existing UI components                             │
├─────────────────────────────────────────────────────────────┤
│  Tauri Bridge (New)                                         │
│  ├─ @tauri-apps/api (TypeScript bindings)                  │
│  └─ IPC commands for file operations                       │
├─────────────────────────────────────────────────────────────┤
│  Rust Backend (New)                                         │
│  ├─ File system watcher (notify crate)                     │
│  ├─ File dialog picker                                     │
│  ├─ Path persistence (app data storage)                    │
│  └─ Event emitter for file changes                         │
└─────────────────────────────────────────────────────────────┘
```

### Hybrid Deployment Strategy

The application will support **both web and desktop** modes:

1. **Web version** (existing): Deployed at gdsjam.com
   - File upload via browser APIs
   - No file watching (browser limitation)
   - Full collaboration features

2. **Desktop version** (new): Downloadable app
   - Native file picker with path persistence
   - Automatic file watching and refresh
   - Full collaboration features (WebRTC still works)
   - Optional: Can still load files from URLs

### Feature Additions for Desktop

1. **File Path Persistence**
   - Save last opened file path in app data
   - Restore on app launch
   - "Recent Files" menu (future enhancement)

2. **File Watching**
   - Watch currently opened file for changes
   - Automatic reload on file modification
   - Debounced updates (avoid reload spam during saves)
   - Visual indicator when file changes detected

3. **Native File Dialogs**
   - System file picker (better UX than web file input)
   - Remembers last directory
   - File type filters (.gds, .gdsii, .dxf)

4. **Refresh Button**
   - Manual refresh option (in addition to auto-watch)
   - Useful when auto-watch is disabled
   - Keyboard shortcut: Cmd/Ctrl+R

5. **Desktop-Specific UI**
   - Menu bar (File > Open, File > Refresh, etc.)
   - Window title shows current file name
   - System tray icon (optional, future)

## Implementation Plan

### Phase 1: Tauri Setup (1 hour)

**Tasks:**
1. Install Tauri CLI and dependencies
2. Initialize Tauri project structure
3. Configure Tauri for Vite integration
4. Update build scripts
5. Test basic desktop app launch

**Files to create:**
- `src-tauri/Cargo.toml` (Rust dependencies)
- `src-tauri/tauri.conf.json` (Tauri configuration)
- `src-tauri/src/main.rs` (Rust entry point)
- `src-tauri/build.rs` (Build script)

**Files to modify:**
- `package.json` (add Tauri scripts)
- `.gitignore` (ignore Tauri build artifacts)

### Phase 2: File Operations (1 hour)

**Tasks:**
1. Implement file picker command
2. Implement file watcher
3. Add path persistence
4. Create TypeScript bindings

**Rust commands to implement:**
- `open_file_dialog()` → Returns file path
- `watch_file(path)` → Starts watching, emits events
- `unwatch_file()` → Stops watching
- `get_last_file_path()` → Retrieves saved path
- `save_last_file_path(path)` → Persists path

**Frontend integration:**
- Detect Tauri environment (`window.__TAURI__`)
- Conditional UI (show "Open File" button in desktop mode)
- Event listeners for file change notifications

### Phase 3: UI Integration (30 minutes)

**Tasks:**
1. Add "Open File" button to HeaderBar (desktop only)
2. Add "Refresh" button (desktop only)
3. Add file watcher toggle (auto-refresh on/off)
4. Update window title with file name
5. Add visual indicator for file changes

**Components to modify:**
- `src/components/ui/HeaderBar.svelte`
- `src/App.svelte`

### Phase 4: Testing & Polish (30 minutes)

**Tasks:**
1. Test file picker on macOS
2. Test file watcher (modify file externally, verify reload)
3. Test path persistence (close/reopen app)
4. Test web version still works (no regressions)
5. Update README with desktop app instructions

## Technical Decisions

### Decision 1: Keep Web Version Functional

**Rationale:** Many users prefer web apps (no installation, cross-platform, easy sharing). The desktop app is an optional enhancement, not a replacement.

**Implementation:** Use feature detection (`window.__TAURI__`) to conditionally enable desktop-only features.

### Decision 2: File Watcher Debouncing

**Rationale:** Text editors often save files multiple times in quick succession. Reloading on every save event would cause UI flicker and performance issues.

**Implementation:** Debounce file change events with 500ms delay. Only reload if no additional changes occur within the debounce window.

### Decision 3: Rust Backend Minimal

**Rationale:** Keep Rust code simple and focused on file system operations only. All business logic remains in TypeScript.

**Implementation:** Rust backend only handles:
- File dialogs
- File watching
- Path persistence
- Event emission

All GDS parsing, rendering, and collaboration logic stays in frontend.

## Success Criteria

1. Desktop app launches successfully on macOS
2. File picker opens and loads GDS files
3. File watcher detects external changes and reloads automatically
4. Path persistence works across app restarts
5. Web version continues to work without regressions
6. Bundle size < 10 MB
7. App startup time < 2 seconds

## Future Enhancements (Post-MVP)

- Windows and Linux builds
- Recent files menu
- System tray integration
- Auto-update mechanism
- File association (.gds files open in gdsjam)
- Drag-and-drop files onto app icon

## References

- Tauri Documentation: https://tauri.app/
- Tauri File System API: https://tauri.app/v1/api/js/fs
- Tauri Dialog API: https://tauri.app/v1/api/js/dialog
- Rust notify crate: https://docs.rs/notify/

## Implementation Status

Status: Completed (Phases 1-3)

### Phase 1: Tauri Setup (Completed)

1. Installed Tauri dependencies
   - Added `@tauri-apps/cli` as dev dependency
   - Added `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs` as dependencies
   - Verified Rust installation (rustc 1.86.0)

2. Initialized Tauri project
   - Created `src-tauri` directory with Cargo.toml and tauri.conf.json
   - Configured build settings and window properties
   - Updated .gitignore to exclude Tauri build artifacts

3. Fixed configuration issues
   - Updated frontendDist path from `../public` to `../dist`
   - Set window size to 1400x900 with minimum 800x600
   - Configured app identifier as `com.gdsjam.app`
   - Removed conflicting `macos-private-api` feature from Cargo.toml

### Phase 2: File Operations (Completed)

1. Implemented file watching system in `src-tauri/src/lib.rs`
   - Added `notify` and `notify-debouncer-full` dependencies
   - Created 5 Tauri commands:
     - `open_file_dialog()` - Native file picker with GDS file filters
     - `watch_file(path)` - File watcher with 500ms debounce
     - `unwatch_file()` - Stop watching current file
     - `get_last_file_path()` - Retrieve saved file path from app data
     - `save_last_file_path(path)` - Persist file path to app data
   - Implemented event emission for file changes
   - Added WatchedFile state management with Arc<Mutex>

2. Fixed compilation issues
   - Resolved Result type conflicts with notify crate (used std::result::Result)
   - Added missing Emitter trait import
   - Added missing Watcher trait import
   - Fixed file path extraction from dialog result

3. Configured permissions in `src-tauri/capabilities/default.json`
   - Added dialog plugin permissions (open)
   - Added fs plugin permissions (read-file, write-file, exists, create, mkdir)

### Phase 3: UI Integration (Completed)

1. Created TypeScript utilities in `src/lib/tauri/index.ts`
   - Feature detection with `isTauri()`
   - Wrapper functions for all Tauri commands
   - Graceful degradation for web mode
   - Event listener setup for file changes

2. Created desktop controls component `src/components/ui/DesktopFileControls.svelte`
   - Open button with native file dialog
   - Refresh button to reload current file
   - Watch toggle for auto-refresh on file changes
   - Proper cleanup on component unmount
   - Only renders in Tauri environment

3. Integrated into HeaderBar
   - Added DesktopFileControls to session controls area
   - Maintains existing web functionality

4. Updated package.json scripts
   - Added `tauri` command for CLI access
   - Added `tauri:dev` for development mode
   - Added `tauri:build` for production builds

### Build Results

Successfully compiled Rust backend with all dependencies:
- tauri 2.9.4
- tauri-plugin-dialog 2
- tauri-plugin-fs 2
- notify 6.1
- notify-debouncer-full 0.3

Desktop app launches successfully in development mode with:
- Vite dev server running on http://localhost:5173/
- Tauri window displaying the application
- Hot reload enabled for both frontend and backend

### Known Issues

1. Svelte reactivity warning in FileUpload.svelte (pre-existing, not related to Tauri)
   - Warning: `fileInputElement` not declared with `$state(...)`
   - Does not affect functionality

### Phase 4: Testing & Polish (In Progress)

Completed:
1. Updated root README.md with desktop app information
   - Added desktop app overview
   - Added desktop features to feature list
   - Added Tauri to technology stack
   - Added desktop development commands
   - Referenced src-tauri/README.md for details

2. Created src-tauri/README.md
   - Comprehensive desktop app documentation
   - Architecture overview
   - Dependencies listing (Rust and frontend)
   - Development workflow
   - Tauri commands reference
   - Configuration details
   - Build instructions
   - Troubleshooting guide

3. Replaced default Tauri icons with gdsjam branding
   - Generated 2048x2048 PNG from SVG at high density (-density 2400 -background none)
   - Scaled down to all required sizes (16x16 through 1024x1024)
   - Created platform-specific bundles: icon.icns (macOS), icon.ico (Windows)
   - All icons have transparent backgrounds and crisp edges

Pending manual testing:
1. Test file dialog opening
2. Test file loading from dialog
3. Test file watching (modify file externally, verify auto-reload)
4. Test path persistence (close/reopen app)
5. Verify web version still works without regressions
6. Production build testing with `pnpm tauri:build`

