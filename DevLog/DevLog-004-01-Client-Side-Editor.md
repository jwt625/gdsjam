# DevLog-004-01: Client-Side Python Code Editor Implementation

**Version:** 1.0
**Date:** 2025-12-14
**Status:** Planning - Ready for Implementation
**Related:** DevLog-004-00-Python-Code-Editor.md

## Overview

This DevLog documents the client-side implementation of the Python code editor feature (Phase 2 of DevLog-004-00). The editor provides an integrated development environment for writing and executing gdsfactory Python code within the gdsjam viewer.

## Design Decisions

### 1. Editor Mode Activation

**Decision:** Hidden mode triggered by holding the 'E' key (500ms hold duration).

**Rationale:**
- Consistent with existing hold-key patterns (F for fullscreen, C for comments)
- Prevents accidental activation
- Keeps UI clean when not in use

**Implementation Reference:**
- Pattern: `src/components/viewer/ViewerCanvas.svelte` lines 56-68 (F key), 62-68 (C key)
- Hold detection: `handleEKeyDown()`, `handleEKeyUp()` with 500ms timer
- State management: `editorModeActive` boolean state

### 2. Layout Architecture

**Decision:** Split-panel layout (editor left, viewer right) with resizable divider.

**Rationale:**
- Similar to Overleaf LaTeX editor (familiar UX)
- Allows simultaneous code editing and result viewing
- Divider enables user-customized workspace

**Layout Specifications:**
- Default split: 50/50
- Minimum panel width: 300px each
- Divider: 4px draggable handle
- Panels remain visible after code execution (no auto-hide)

**Implementation Reference:**
- Split panel pattern: Custom implementation needed
- Resizable divider: CSS resize handle with mouse drag handlers

### 3. Console Output Display

**Decision:** Tab-based viewer panel (GDS Viewer / Console Output tabs).

**Rationale:**
- Similar to Overleaf compilation output
- Keeps console output accessible without cluttering editor
- Allows switching between viewer and console as needed

**Tab Structure:**
- Tab 1: "Viewer" (GDS canvas)
- Tab 2: "Console" (stdout/stderr output)
- Tab switching: Instant transitions (no animations per project standards)

### 4. Monaco Editor Integration

**Decision:** Lazy load Monaco Editor only when editor mode is activated.

**Rationale:**
- Monaco bundle is ~2MB (significant)
- Most users may not use editor feature
- Lazy loading improves initial page load performance

**Implementation:**
- Dynamic import: `const monaco = await import('monaco-editor')`
- Load trigger: First activation of editor mode
- Loading state: Show spinner during Monaco initialization

### 5. Code Persistence

**Decision:** Per-session localStorage with key format `gdsjam_code_{sessionId}`.

**Rationale:**
- Editor creates session by default (server communication required)
- Different code per session enables multi-project workflow
- Survives page refresh within same session

**Storage Keys:**
- Solo mode: `gdsjam_code_solo`
- Session mode: `gdsjam_code_{sessionId}`
- Auto-save: On every code change (debounced 1 second)

### 6. File Upload Integration

**Decision:** Support three code loading methods:
1. Upload .py file
2. Clear code (blank editor)
3. Load default example

**Rationale:**
- Flexibility for different user workflows
- Matches standard IDE patterns
- Default example provides starting point for new users

**UI Elements:**
- "Upload Python File" button
- "Clear Code" button
- "Load Example" dropdown (future: multiple examples)

### 7. Execution Flow

**Decision:** Block GDS viewer during execution, disable run button, show countdown on rate limit.

**Rationale:**
- Prevents confusion from stale viewer state
- Clear visual feedback during execution
- Rate limit countdown informs user when retry is available

**Execution States:**
- Idle: Run button enabled
- Executing: Run button disabled, viewer shows loading overlay
- Rate limited: Run button disabled with countdown timer
- Error: Console tab auto-switches to show error

**Implementation:**
- Disable at execution level (not just button UI)
- Keyboard shortcut (Ctrl/Cmd+Enter) also respects disabled state
- Loading overlay: Reuse existing `LoadingOverlay.svelte` component

### 8. Error Handling

**Decision:** Show full sanitized Python traceback in console tab.

**Rationale:**
- Server already sanitizes paths (DevLog-004-00)
- Full traceback aids debugging
- Console tab provides dedicated space for error output

**Error Display:**
- Auto-switch to Console tab on error
- Syntax highlighting for Python traceback
- Scroll to error location in output

### 9. Mobile Support

**Decision:** Three-tab mobile layout (Code Editor / GDS Viewer / Console Output).

**Rationale:**
- Mobile screen too small for split view
- Tab switching allows full-screen editing and viewing
- Maintains all functionality on mobile

**Mobile Layout:**
- Breakpoint: 1024px (matches existing `MOBILE_BREAKPOINT`)
- Tab bar: Fixed at top of editor area
- Tabs: "Code", "Viewer", "Console"
- FAB menu: Add "Editor Mode" toggle button

**Implementation Reference:**
- Mobile pattern: `src/components/ui/MobileControls.svelte`
- Tab switching: Similar to LayerPanel collapse/expand pattern

### 10. Collaboration Behavior

**Decision:** Only host can execute code (low priority for MVP).

**Rationale:**
- Simplifies initial implementation
- Prevents conflicting executions
- Viewers can still see code and results

**Future Enhancement:**
- Independent code execution per participant
- Optional code sharing via Y.js

### 11. GDS File Auto-Upload

**Decision:** Auto-upload generated GDS to session if user is host.

**Rationale:**
- Server-side execution already generates file on server
- File hash available in execution response
- Simpler than downloading and re-uploading

**Implementation:**
- Execution response includes `fileId` (SHA-256 hash)
- Use existing `FileTransfer` class to store metadata in Y.js
- Skip file upload step (file already on server)

### 12. Comment Handling

**Decision:** Do not clear comments when loading code-generated GDS (exception to file upload behavior).

**Rationale:**
- Code may generate similar layout (iterative development)
- Comments may still be relevant
- User can manually clear if needed

**Fallback:** If implementation is complex, clear comments for MVP (same as file upload).

### 13. Default Example

**Decision:** Use existing 741-line photonics circuit example as-is.

**Rationale:**
- Demonstrates full gdsfactory capabilities
- Shows complex routing, electrical connections, bond pads
- Provides realistic starting point for photonics designers

**File:** `src/components/code/examples/default.py`

### 14. Keyboard Shortcuts

**Decision:**
- Ctrl/Cmd+Enter: Run code
- Ctrl/Cmd+S: Save code to localStorage
- Shortcuts only active when editor has focus

**Rationale:**
- Standard IDE shortcuts
- Prevents conflicts with viewer shortcuts
- Focus-based activation prevents accidental triggers

### 15. Server Configuration

**Decision:** Use same server URL and auth token as file upload/sync.

**Environment Variables:**
- `VITE_FILE_SERVER_URL`: Server base URL
- `VITE_FILE_SERVER_TOKEN`: Bearer token for authentication

**Server Validation:**
- Ping `/api/execute` endpoint when entering editor mode
- Show error message if server unreachable
- Prevent editor activation if server unavailable

## Implementation Plan

### Phase 1: Core Infrastructure

#### Task 1.1: Editor Mode State Management
**Files:**
- `src/stores/editorStore.ts` (new)

**Implementation:**
- Create Svelte store for editor state
- State properties:
  - `editorModeActive: boolean`
  - `code: string`
  - `consoleOutput: string`
  - `isExecuting: boolean`
  - `executionError: string | null`
  - `rateLimitCountdown: number`
  - `activeTab: 'viewer' | 'console'` (for viewer panel)
  - `monacoLoaded: boolean`
- Methods:
  - `enterEditorMode()`
  - `exitEditorMode()`
  - `setCode(code: string)`
  - `setConsoleOutput(output: string)`
  - `setExecuting(executing: boolean)`
  - `setRateLimitCountdown(seconds: number)`
  - `switchTab(tab: 'viewer' | 'console')`
- localStorage integration:
  - Load code on store initialization
  - Auto-save code on change (debounced 1s)
  - Key format: `gdsjam_code_{sessionId}` or `gdsjam_code_solo`

#### Task 1.2: E Key Hold Detection
**Files:**
- `src/components/viewer/ViewerCanvas.svelte`

**Implementation:**
- Add E key hold detection (similar to F/C key patterns)
- Constants:
  - `EDITOR_HOLD_DURATION_MS = 500`
- State variables:
  - `eKeyDownTime: number | null`
  - `eKeyHoldTimer: ReturnType<typeof setTimeout> | null`
  - `eKeyTriggeredEditor: boolean`
- Functions:
  - `handleEKeyDown(event: KeyboardEvent)` - Start timer, prevent default
  - `handleEKeyUp(event: KeyboardEvent)` - Clear timer, toggle editor mode if hold threshold met
- Event listeners:
  - `window.addEventListener('keydown', handleEKeyDown)`
  - `window.addEventListener('keyup', handleEKeyUp)`
- Cleanup:
  - Remove listeners in `onDestroy`
  - Clear timer in cleanup

#### Task 1.3: Python Executor API Client
**Files:**
- `src/lib/api/pythonExecutor.ts` (new)

**Implementation:**
- API client class `PythonExecutor`
- Methods:
  - `async execute(code: string): Promise<ExecutionResult>`
  - `async validateServer(): Promise<boolean>`
- Types:
  - `ExecutionResult { success: boolean, stdout: string, stderr: string, fileId?: string, error?: string }`
- Error handling:
  - Network errors
  - Rate limit (429) with retry-after parsing
  - Authentication errors (401)
  - Server errors (500)
- Configuration:
  - Use `VITE_FILE_SERVER_URL` and `VITE_FILE_SERVER_TOKEN`
  - Endpoint: `POST /api/execute`
  - Request body: `{ code: string }`
  - Headers: `Authorization: Bearer {token}`, `Content-Type: application/json`

### Phase 2: Editor UI Components

#### Task 2.1: Monaco Editor Wrapper
**Files:**
- `src/components/code/CodeEditor.svelte` (new)

**Implementation:**
- Props:
  - `code: string`
  - `onChange: (code: string) => void`
  - `onRun: () => void`
  - `disabled: boolean`
- Lazy load Monaco:
  - Dynamic import on component mount
  - Show loading spinner during initialization
  - Set `editorStore.monacoLoaded = true` when ready
- Monaco configuration:
  - Language: Python
  - Theme: vs-dark
  - Options: `{ minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false }`
- Keyboard shortcuts:
  - Ctrl/Cmd+Enter: Call `onRun()` (only if not disabled)
  - Ctrl/Cmd+S: Save to localStorage (preventDefault to avoid browser save dialog)
- Toolbar:
  - "Run Code" button (disabled when executing or rate limited)
  - "Upload .py File" button
  - "Clear Code" button
  - "Load Example" dropdown
- File upload handler:
  - Read .py file as text
  - Call `onChange(fileContent)`
- Clear handler:
  - Confirmation modal: "Clear all code? This cannot be undone."
  - Call `onChange('')` on confirm
- Load example handler:
  - Fetch `src/components/code/examples/default.py`
  - Call `onChange(exampleContent)`

#### Task 2.2: Console Output Component
**Files:**
- `src/components/code/CodeConsole.svelte` (new)

**Implementation:**
- Props:
  - `output: string`
  - `error: string | null`
- Display:
  - Monospace font
  - Syntax highlighting for Python tracebacks (optional for MVP)
  - Auto-scroll to bottom on new output
  - Clear button to reset console
- Styling:
  - Dark background (matches editor theme)
  - Green text for stdout
  - Red text for stderr/errors
  - Scrollable container

#### Task 2.3: Split Panel Layout
**Files:**
- `src/components/code/EditorLayout.svelte` (new)

**Implementation:**
- Desktop layout (>= 1024px):
  - Left panel: `CodeEditor`
  - Divider: 4px draggable handle
  - Right panel: Tabbed viewer (GDS Viewer / Console Output)
- Mobile layout (< 1024px):
  - Three tabs: Code / Viewer / Console
  - Full-screen tab content
  - Tab bar at top
- Divider drag handler:
  - Track mouse position during drag
  - Update panel widths (CSS flex-basis)
  - Constrain minimum width: 300px each
  - Save position to localStorage
- Tab switching:
  - Update `editorStore.activeTab`
  - Instant transitions (no animations)
- Props:
  - `fullscreenMode: boolean`
- Integration:
  - Render `ViewerCanvas` in viewer tab
  - Render `CodeConsole` in console tab
  - Render `CodeEditor` in editor panel/tab

### Phase 3: App Integration

#### Task 3.1: App.svelte Integration
**Files:**
- `src/App.svelte`

**Implementation:**
- Import `EditorLayout` component
- Import `editorStore`
- Conditional rendering:
  - If `$editorStore.editorModeActive`: Render `EditorLayout`
  - Else: Render existing viewer/upload UI
- Exit editor mode:
  - ESC key handler (if not in fullscreen)
  - Confirmation modal: "Exit editor mode? Unsaved changes will be lost." (if code changed)
  - Call `editorStore.exitEditorMode()`
- Session integration:
  - Pass session ID to `editorStore` for localStorage key
  - Auto-create session when entering editor mode (if not in session)
- File loading:
  - When code execution generates GDS, call `loadGDSIIFromBuffer()`
  - Do NOT clear comments (exception to file upload behavior)

#### Task 3.2: Mobile Controls Integration
**Files:**
- `src/components/ui/MobileControls.svelte`

**Implementation:**
- Add "Editor Mode" menu item
- Icon: Code brackets `</>` SVG
- Toggle `editorStore.editorModeActive` on click
- Show active state when editor mode enabled

#### Task 3.3: Keyboard Shortcut Registration
**Files:**
- `src/lib/keyboard/KeyboardShortcutManager.ts`

**Implementation:**
- Register editor shortcuts:
  - Ctrl/Cmd+Enter: Run code (context: editor has focus)
  - Ctrl/Cmd+S: Save code (context: editor has focus)
- Focus detection:
  - Check if Monaco editor container has focus
  - Use `document.activeElement` to verify

### Phase 4: Execution Flow

#### Task 4.1: Code Execution Handler
**Files:**
- `src/components/code/EditorLayout.svelte`

**Implementation:**
- Function: `async handleRunCode()`
- Steps:
  1. Validate server availability (call `pythonExecutor.validateServer()`)
  2. Set `editorStore.setExecuting(true)`
  3. Show loading overlay on viewer panel
  4. Call `pythonExecutor.execute(code)`
  5. Handle response:
     - Success: Update console output, load GDS if `fileId` present
     - Error: Update console output with error, switch to console tab
     - Rate limit: Parse retry-after, start countdown timer
  6. Set `editorStore.setExecuting(false)`
- Error handling:
  - Network errors: Show in console
  - Server errors: Show sanitized traceback in console
  - Rate limit: Disable run button, show countdown

#### Task 4.2: GDS File Loading from Execution
**Files:**
- `src/components/code/EditorLayout.svelte`

**Implementation:**
- Function: `async loadGeneratedGDS(fileId: string)`
- Steps:
  1. Download file from server using `fileId`
  2. Call `loadGDSIIFromBuffer(arrayBuffer, 'generated.gds')`
  3. If in session and is host: Store metadata in Y.js (skip file upload, file already on server)
  4. Switch to viewer tab
- Integration with `FileTransfer`:
  - Reuse `FileTransfer` class for Y.js metadata storage
  - Set `fileId`, `fileName`, `fileHash`, `fileSize` in session map
  - Skip `uploadFile()` step (file already on server)

#### Task 4.3: Rate Limit Countdown
**Files:**
- `src/components/code/CodeEditor.svelte`

**Implementation:**
- Display countdown timer on run button when rate limited
- Update every second using `setInterval`
- Button text: "Rate Limited (5s)" → "Rate Limited (4s)" → ... → "Run Code"
- Re-enable button when countdown reaches 0
- Clear interval on component unmount

### Phase 5: Polish and Testing

#### Task 5.1: Loading States
**Files:**
- `src/components/code/CodeEditor.svelte`
- `src/components/code/EditorLayout.svelte`

**Implementation:**
- Monaco loading spinner
- Execution loading overlay on viewer
- Server validation loading state
- Disable all controls during loading

#### Task 5.2: Error Messages
**Files:**
- `src/components/code/CodeConsole.svelte`

**Implementation:**
- Format Python tracebacks for readability
- Highlight error lines
- Show execution time and exit code
- Clear button to reset console

#### Task 5.3: Confirmation Modals
**Files:**
- `src/components/code/ConfirmationModal.svelte` (new)

**Implementation:**
- Generic confirmation modal component
- Props: `message: string`, `onConfirm: () => void`, `onCancel: () => void`
- Use cases:
  - Exit editor mode with unsaved changes
  - Clear code
  - Load example (overwrite current code)

#### Task 5.4: Server Validation
**Files:**
- `src/lib/api/pythonExecutor.ts`

**Implementation:**
- Ping server on editor mode activation
- Show error toast if server unreachable
- Prevent editor activation if validation fails
- Retry logic: 3 attempts with exponential backoff

#### Task 5.5: Package Installation
**Files:**
- `package.json`

**Implementation:**
- Install Monaco Editor: `pnpm add monaco-editor`
- Install Monaco types: `pnpm add -D @types/monaco-editor`
- Update Vite config if needed for Monaco worker files

## File Structure

```
src/
├── components/
│   └── code/
│       ├── CodeEditor.svelte (new)
│       ├── CodeConsole.svelte (new)
│       ├── EditorLayout.svelte (new)
│       ├── ConfirmationModal.svelte (new)
│       └── examples/
│           └── default.py (existing)
├── lib/
│   └── api/
│       └── pythonExecutor.ts (new)
└── stores/
    └── editorStore.ts (new)
```

## Testing Checklist

### Desktop Testing
- [ ] E key hold activates editor mode
- [ ] Split panel layout renders correctly
- [ ] Divider drag resizes panels
- [ ] Monaco editor loads and displays code
- [ ] Code execution works (success case)
- [ ] Error handling displays in console
- [ ] Rate limit countdown works
- [ ] GDS file loads after execution
- [ ] Tab switching (Viewer/Console) works
- [ ] Keyboard shortcuts work (Ctrl/Cmd+Enter, Ctrl/Cmd+S)
- [ ] File upload (.py) works
- [ ] Clear code works with confirmation
- [ ] Load example works
- [ ] Code persists in localStorage
- [ ] Exit editor mode works with confirmation

### Mobile Testing
- [ ] Three-tab layout renders correctly
- [ ] Tab switching works (Code/Viewer/Console)
- [ ] Editor mode toggle in FAB menu works
- [ ] Code execution works on mobile
- [ ] Console output readable on mobile
- [ ] Touch-friendly controls

### Collaboration Testing
- [ ] Host can execute code
- [ ] Generated GDS auto-uploads to session
- [ ] Viewers receive GDS file
- [ ] Comments not cleared on code execution

### Error Testing
- [ ] Server unreachable error
- [ ] Rate limit error (429)
- [ ] Python syntax error
- [ ] Python runtime error
- [ ] Module import error (blacklisted)
- [ ] Network timeout

## Success Criteria

1. Editor mode activates via E key hold
2. Split panel layout works on desktop
3. Three-tab layout works on mobile
4. Monaco editor loads and functions correctly
5. Code execution succeeds with default example
6. Console output displays stdout/stderr
7. Error messages display in console
8. Rate limiting works with countdown
9. Generated GDS files load in viewer
10. Code persists across page refresh
11. Keyboard shortcuts work as expected
12. Server validation prevents editor activation when server down

## Dependencies

- monaco-editor: ^0.45.0 (or latest stable)
- @types/monaco-editor: ^0.45.0 (dev dependency)

## Notes

- All transitions must be instant (no animations per project standards)
- Mobile breakpoint: 1024px (matches existing `MOBILE_BREAKPOINT`)
- Server endpoint: `POST /api/execute` (already implemented in DevLog-004-00)
- Authentication: Bearer token from `VITE_FILE_SERVER_TOKEN`
- Default example: 741 lines, complex photonics circuit
- Comments NOT cleared on code execution (exception to file upload behavior)


