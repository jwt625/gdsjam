# DevLog-004-00: Python Code Editor

## Metadata
- **Document Version:** 2.1
- **Created:** 2025-12-13
- **Author:** Wentao Jiang
- **Status:** Planning - Ready for Implementation
- **Related Documents:** DevLog-001-mvp-implementation-plan.md

## Changelog
- **v2.1 (2025-12-14):** Refined server-side execution requirements
  - Specified Python 3.12 in virtual environment
  - Updated rate limiting: 10 executions per IP per minute (was per hour)
  - Clarified file size limit: 100MB for generated GDS files
  - Added module whitelist/blacklist enforcement
  - Added server path sanitization in error messages
  - Added partial stdout/stderr return on timeout
  - Documented Python environment setup steps
  - Updated security considerations for MVP scope
- **v2.0 (2025-12-13):** Architecture change from client-side to server-side execution
  - Documented failed Pyodide POC due to native dependencies (gdstk, watchdog)
  - Evaluated WASM compilation effort (1-2 weeks, not viable for MVP)
  - Selected server-side execution approach
  - Designed REST API endpoint for Python code execution
  - Estimated implementation: 4-6 hours
- **v1.1 (2025-12-13):** Refined MVP scope based on stakeholder feedback
  - Removed directory/file management (single file editor only)
  - Added Ctrl/Cmd+Enter keyboard shortcut for code execution
  - Simplified templates: single default example for MVP
  - Removed collaboration features from MVP scope
  - Confirmed lazy loading and timeout features
- **v1.0 (2025-12-13):** Initial planning document

---

## Executive Summary

This document outlines the implementation plan for adding a Python code editor to gdsjam, enabling users to write gdsfactory code and view the generated GDS layouts in real-time. After investigating client-side execution via Pyodide (WebAssembly), we have determined that server-side execution is the most viable approach for MVP due to native dependency constraints in gdsfactory's dependency tree.

## Problem Statement

Current gdsjam is a viewer-only application. Users must:
1. Write gdsfactory code in external editors
2. Execute Python scripts to generate GDS files
3. Upload GDS files to gdsjam for visualization

This creates friction for learning and rapid prototyping workflows, particularly for students and researchers exploring photonics design.

## Solution: Python Code Editor with Server-Side Execution

Enable users to write and execute gdsfactory code with instant visualization of generated layouts.

**Target Users:**
- Students learning photonics/chip design
- Researchers prototyping designs
- Educators teaching GDS layout concepts

**Primary Use Cases:**
- Interactive learning with gdsfactory examples
- Quick experimentation and iteration
- Sharing code snippets with colleagues
- Educational demonstrations

---

## Architecture Decision: Client-Side vs Server-Side Execution

### Investigation: Pyodide (Client-Side Execution)

**Approach:** Use Pyodide (CPython compiled to WebAssembly) to run Python in the browser.

**POC Implementation:** Created `tests/pyodide-poc.html` to validate gdsfactory compatibility.

**POC Results:** Failed due to native dependency constraints.

**Technical Findings:**

1. **gdstk Dependency (Critical Blocker)**
   - gdsfactory requires kfactory >= 2.2
   - kfactory depends on gdstk (C++ library for GDS manipulation)
   - gdstk is distributed as platform-specific binary wheels (not pure Python)
   - gdstk is not available in Pyodide's package repository
   - Error: `ValueError: Can't find a pure Python 3 wheel for 'gdstk'`

2. **Additional Blockers**
   - watchdog: File system monitoring library with native C extensions
   - shapely: Geometry library with C extensions (may be needed)

3. **WASM Compilation Assessment**
   - Compiling gdstk to WebAssembly would require:
     - Setting up Emscripten build environment
     - Creating Pyodide build recipes (`meta.yaml`)
     - Compiling C++ dependencies (qhull, zlib)
     - Testing and debugging WASM-specific issues
   - Estimated effort: 1-2 weeks for experienced developer
   - Risk: Medium-high (WASM debugging, memory management, file I/O)

**Conclusion:** Client-side execution is not viable for MVP timeline.

### Selected Approach: Server-Side Execution

**Architecture:** REST API endpoint that executes Python code on the server and returns generated GDS files.

**Advantages:**
- Full gdsfactory support (no dependency constraints)
- Faster implementation (4-6 hours vs 1-2 weeks)
- No client bundle size impact
- Easier to maintain and update Python environment
- Leverages existing file storage infrastructure
- Can support future features (custom dependencies, longer execution times)

**Trade-offs:**
- Requires server infrastructure (already exists for collaboration features)
- Code is sent to server (acceptable for educational/prototyping use cases)
- Network latency (round-trip + execution time)
- Server resource usage (mitigated by rate limiting and timeouts)

**Security Considerations:**
- Sandboxed execution in isolated temporary directories
- 30-second timeout enforcement
- Rate limiting: 10 executions per IP per minute
- File size limits: 100MB maximum (for generated GDS files)
- Module whitelist/blacklist enforcement before execution
- Server path sanitization in error messages
- Partial stdout/stderr return on timeout
- Future enhancements: Docker containerization, network isolation, CPU/memory limits

---

## Server-Side API Design

### Endpoint: `POST /api/execute`

**Purpose:** Execute Python/gdsfactory code and return generated GDS file.

**Request:**
```json
{
  "code": "import gdsfactory as gf\nc = gf.components.ring_single()\nc.write_gds('output.gds')"
}
```

**Response (Success):**
```json
{
  "success": true,
  "fileId": "abc123...",
  "size": 12345,
  "executionTime": 1.23,
  "stdout": "Component created successfully\n",
  "stderr": ""
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "SyntaxError: invalid syntax",
  "stdout": "",
  "stderr": "Traceback (most recent call last)...",
  "executionTime": 0.05
}
```

### Execution Workflow

1. Client sends Python code to `POST /api/execute`
2. Server creates isolated temporary directory
3. Server writes code to `temp/script.py`
4. Server executes Python script in venv (Python 3.12) with 30s timeout
5. Server captures stdout/stderr
6. Server searches for `*.gds` files in temp directory
7. If GDS file found:
   - Compute SHA-256 hash
   - Save to file storage (`/var/gdsjam/files/<hash>.bin`)
   - Return fileId (hash)
8. If no GDS file found:
   - Return error with stdout/stderr
9. Server cleans up temporary directory

### Client Integration

```typescript
// Execute Python code
const response = await fetch('https://signaling.gdsjam.com/api/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`
  },
  body: JSON.stringify({ code: pythonCode })
});

const result = await response.json();

if (result.success) {
  // Load GDS using existing file loading routine
  const gdsUrl = `https://signaling.gdsjam.com/api/files/${result.fileId}`;
  await loadGdsFromUrl(gdsUrl);
} else {
  console.error('Execution failed:', result.error);
  console.log('stderr:', result.stderr);
}
```

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     GDSJam Client                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │  Code Editor │         │ File Upload  │                 │
│  │  (Monaco)    │         │  (.gds)      │                 │
│  └──────┬───────┘         └──────┬───────┘                 │
│         │                        │                          │
│         │ Python code            │ Binary GDS               │
│         ▼                        ▼                          │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ POST /api/   │         │ gdsii parser │                 │
│  │   execute    │         │ (JavaScript) │                 │
│  └──────┬───────┘         └──────┬───────┘                 │
│         │                        │                          │
│         │ fileId                 │ GDSDocument              │
│         ▼                        ▼                          │
│  ┌──────────────────────────────────────┐                  │
│  │         GDS Renderer (Pixi.js)       │                  │
│  └──────────────────────────────────────┘                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  GDSJam Server (Node.js)                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  POST /api/execute                                           │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────┐                                       │
│  │ Python Executor  │                                       │
│  │ - Create temp dir│                                       │
│  │ - Write script   │                                       │
│  │ - Execute Python │                                       │
│  │ - Capture output │                                       │
│  │ - Find GDS files │                                       │
│  │ - Cleanup        │                                       │
│  └──────┬───────────┘                                       │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────┐                                       │
│  │  File Storage    │                                       │
│  │  (SHA-256 hash)  │                                       │
│  └──────────────────┘                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Components:**
1. **Monaco Editor**: VS Code's editor component for code editing
2. **Python Executor**: Server-side Python code execution with sandboxing
3. **File Storage**: Existing infrastructure for GDS file storage
4. **Existing GDS Parser**: JavaScript parser for GDSII files
5. **Existing Renderer**: Pixi.js-based WebGL2 renderer

---

## MVP Feature Set (Revised for Server-Side Execution)

### Core Features

1. **Code Editor**
   - Monaco Editor (VS Code editor component)
   - Python syntax highlighting
   - Basic autocomplete for Python keywords
   - Line numbers and error indicators
   - Single-file editor (no directory/file management)

2. **Code Execution**
   - "Run" button to execute Python code
   - Keyboard shortcut: Ctrl/Cmd+Enter to run
   - Send code to server via `POST /api/execute`
   - Display execution progress indicator
   - Load generated GDS file via existing file loading routine
   - Error display in console panel (stdout/stderr from server)

3. **Default Example**
   - Single default example loaded on first open
   - Example file: `src/components/code/examples/default.py`
   - Complex photonics circuit demonstrating gdsfactory capabilities
   - No template selector for MVP (can be added later)

4. **Code Persistence**
   - Save code to localStorage (survives page refresh)
   - Clear/reset functionality

5. **UI Integration**
   - Hidden mode triggered by holding 'E' key (500ms hold duration)
   - Desktop: Split-panel layout (editor left, viewer right) with resizable divider
   - Mobile: Three-tab layout (Code / Viewer / Console) with full editing capability

### Performance Features

6. **Execution Safety**
   - Server-side timeout: 30 seconds
   - Rate limiting: 10 executions per IP per minute
   - File size limits: 100MB maximum (for generated GDS files)
   - Module whitelist/blacklist enforcement
   - Server path sanitization in error output

### Deferred to Post-MVP

- Directory and file management (multi-file projects)
- Template selector with multiple examples
- Code collaboration/sync in sessions
- Docker containerization for stronger isolation
- Custom Python package installation
- Advanced autocomplete for gdsfactory API
- Syntax validation before execution
- Code sharing via URL parameters

---

## Python Environment Setup

**Server Requirements:**
- Python 3.12 (latest stable version)
- Virtual environment for isolation
- Pre-installed packages:
  - gdsfactory (latest stable version)
  - gdstk (gdsfactory dependency)
  - kfactory (gdsfactory dependency)
  - numpy, scipy, matplotlib (common dependencies)
  - Other gdsfactory dependencies as needed

**Installation Steps:**
```bash
# On OCI instance
sudo apt update
sudo apt install python3.12 python3.12-venv python3.12-dev

# Create virtual environment
mkdir -p /opt/gdsjam
python3.12 -m venv /opt/gdsjam/venv

# Activate and install packages
source /opt/gdsjam/venv/bin/activate
pip install --upgrade pip
pip install gdsfactory numpy scipy matplotlib

# Verify installation
python -c "import gdsfactory as gf; print(gf.__version__)"
```

**Environment Variables:**
- `PYTHON_VENV_PATH`: Path to Python virtual environment (default: `/opt/gdsjam/venv`)
- `PYTHON_TIMEOUT`: Execution timeout in seconds (default: `30`)
- `PYTHON_RATE_LIMIT_WINDOW`: Rate limit window in milliseconds (default: `60000` = 1 minute)
- `PYTHON_RATE_LIMIT_MAX`: Max executions per IP per window (default: `10`)

## Implementation Plan

### Phase 1: Server-Side Python Executor (4-6 hours)

**Goal:** Implement REST API endpoint for Python code execution

**Tasks:**
1. Create `server/pythonExecutor.js`
   - `executePythonCode(code)` function using `child_process.spawn`
   - Temporary directory management using `tmp` package
   - Timeout enforcement (30 seconds)
   - Module whitelist/blacklist validation before execution
     - Whitelist: gdsfactory, numpy, scipy, matplotlib, math, itertools, functools, etc.
     - Blacklist: os, subprocess, sys, socket, urllib, requests, etc.
     - Check import statements with regex before execution
   - GDS file detection and storage
   - Path sanitization in error messages (remove /opt/gdsjam/, /tmp/, etc.)
   - Partial stdout/stderr capture on timeout
   - Rate limiting middleware (10 per IP per minute)
   - `setupPythonRoutes(app)` to configure Express routes

2. Update `server/server.js`
   - Import and setup Python routes

3. Update `server/package.json`
   - Add `tmp` dependency

4. Update `server/.env.example`
   - Add Python execution configuration:
     - PYTHON_VENV_PATH
     - PYTHON_TIMEOUT
     - PYTHON_RATE_LIMIT_WINDOW
     - PYTHON_RATE_LIMIT_MAX

5. Test endpoint with curl/Postman
   - Verify successful execution with gdsfactory code
   - Verify error handling (syntax errors, runtime errors)
   - Verify module whitelist/blacklist enforcement
   - Verify path sanitization in error messages
   - Verify rate limiting (10 per minute)
   - Verify timeout enforcement (30 seconds)
   - Verify partial output on timeout

**Files to Create:**
- `server/pythonExecutor.js` (~200 lines)

**Files to Modify:**
- `server/server.js` (~5 lines)
- `server/package.json` (~2 lines)
- `server/.env.example` (~5 lines)

**Success Criteria:**
- `POST /api/execute` endpoint accepts Python code
- Server executes code in isolated temp directory using Python 3.12 venv
- Module whitelist/blacklist prevents dangerous imports
- Generated GDS files are saved to file storage (SHA-256 hash)
- Returns fileId for client to download
- Error messages have sanitized paths (no server directory info)
- Timeout returns partial stdout/stderr
- Proper error handling and timeout enforcement
- Rate limiting prevents abuse (10 per IP per minute)

**Deliverable:** Working API endpoint with tests

### Phase 2: Client-Side Integration (1 week)

**Tasks:**
1. Add Monaco Editor dependency
2. Create CodeEditor component (Svelte)
3. Create CodeConsole component for output display
4. Create API client for `/api/execute` endpoint
5. Add "Code" tab to main UI
6. Wire up code execution pipeline
7. Integrate with existing GDS file loading routine
8. Add error handling and console output

**Files to Create:**
- `src/components/code/CodeEditor.svelte`
- `src/components/code/CodeConsole.svelte`
- `src/lib/api/pythonExecutor.ts`
- `src/components/code/examples/default.py` (already created)

**Files to Modify:**
- `src/App.svelte` (add tab switching)
- `package.json` (add monaco-editor)

**Success Criteria:**
- Code editor displays with syntax highlighting
- Run button executes code on server
- Generated GDS file loads in viewer
- Errors display in console panel
- Code persists in localStorage

### Phase 3: Polish & Optimization (2-3 days)

**Tasks:**
1. Implement Ctrl/Cmd+Enter keyboard shortcut
2. Add execution progress indicator
3. Improve error messages and stack traces
4. Mobile UI (read-only view with desktop prompt)
5. Add code reset functionality (restore default example)
6. Update documentation
7. Add server deployment instructions

---

## Technical Decisions

### Decision 1: Client-Side (Pyodide) vs Server-Side Execution

**Choice:** Server-side execution

**Rationale:**
- gdsfactory requires gdstk (C++ library) which is not available in Pyodide
- Compiling gdstk to WebAssembly would require 1-2 weeks of effort
- Server-side execution provides full gdsfactory support
- Faster implementation timeline (4-6 hours vs 1-2 weeks)
- Can leverage existing file storage infrastructure
- Server already exists for collaboration features

**Trade-offs:**
- Code is sent to server (acceptable for educational use cases)
- Network latency (mitigated by fast execution times)
- Requires server infrastructure (already exists)

**POC Results:**
- Created `tests/pyodide-poc.html` to validate Pyodide approach
- Failed due to gdstk native dependency
- Documented findings in this DevLog

### Decision 2: Monaco Editor vs CodeMirror

**Choice:** Monaco Editor

**Rationale:**
- Industry standard (powers VS Code)
- Excellent TypeScript support
- Built-in Python language support
- Better autocomplete and IntelliSense
- Larger community and ecosystem

**Trade-off:** Larger bundle size (~2MB) vs CodeMirror (~500KB)

### Decision 3: Code Sync Strategy

**Choice:** No code sync for MVP

**Rationale:**
- Simplifies implementation significantly
- Code collaboration is complex (operational transform, conflict resolution)
- Focus on single-user experience first
- Can add in v2 if there's demand

**Future:** Could add Y.Text sync in post-MVP

### Decision 4: Mobile Support

**Choice:** Three-tab layout (Code / Viewer / Console) with full editing capability

**Rationale:**
- Mobile is first citizen for this project
- Tab switching allows full-screen editing and viewing
- Maintains all functionality on mobile
- Consistent with DevLog-004-01 specification

**Implementation:**
- Breakpoint: 1024px (matches existing `MOBILE_BREAKPOINT`)
- Tab bar: Fixed at top of editor area
- Tabs: "Code", "Viewer", "Console"
- FAB menu: Add "Editor Mode" toggle button

### Decision 5: Default Example

**Choice:** Single default example file for MVP

**Rationale:**
- Simplifies UI (no template selector needed)
- Reduces implementation time
- Default example demonstrates gdsfactory capabilities
- Users can modify the example or clear it

**Implementation:** Load `default.py` from examples directory on first open

**Future:** Could add template gallery in v2

---

## Success Criteria

1. Server endpoint `POST /api/execute` accepts Python code
2. Server executes code in isolated environment with 30s timeout
3. Generated GDS files are saved to file storage
4. Client receives fileId and loads GDS via existing routine
5. Default example runs successfully and renders correctly
6. Code persists across page refreshes (localStorage)
7. Ctrl/Cmd+Enter keyboard shortcut executes code
8. Error messages are clear and actionable (stdout/stderr displayed)
9. Rate limiting prevents abuse (10 executions per IP per minute)
10. No regressions in existing upload/render functionality
11. Mobile shows three-tab layout with full editing capability
12. Generated GDS auto-uploads to session (host only), with warning for files >10MB

## Estimated Timeline

- **Phase 1 (Server):** 4-6 hours
- **Phase 2 (Client):** 1 week
- **Phase 3 (Polish):** 2-3 days
- **Total:** 1.5-2 weeks

## Future Enhancements (Post-MVP)

- Template selector with multiple examples
- Code collaboration/sync in sessions (Y.js)
- Directory and file management (multi-file projects)
- Advanced autocomplete for gdsfactory API
- Inline documentation and tooltips
- Code snippets library
- Export code as .py file
- Import .py files
- Package version selector
- Docker containerization for stronger isolation
- Custom Python package installation
- User-submitted template gallery
- Code diff view for session participants
- Integrated Python debugger
- Syntax validation before execution
- Code sharing via URL parameters

## References

- Pyodide Documentation: https://pyodide.org/
- gdsfactory Documentation: https://gdsfactory.github.io/
- Monaco Editor: https://microsoft.github.io/monaco-editor/
- Y.js Text Type: https://docs.yjs.dev/api/shared-types/y.text

## Open Questions

1. **gdsfactory Dependencies:** Are all gdsfactory dependencies available in Pyodide?
   - Action: Test in Phase 1 POC

2. **Performance:** What is acceptable execution time for typical designs?
   - Action: Benchmark in Phase 1, gather user feedback

3. **Memory Limits:** What is the practical memory limit for browser execution?
   - Action: Test with progressively larger designs

4. **Version Compatibility:** Which gdsfactory version should we target?
   - Action: Use latest stable version, document in UI

5. **Error Handling:** How to present Python tracebacks in user-friendly way?
   - Action: Design in Phase 2, iterate based on testing

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| gdsfactory incompatible with Pyodide | Medium | High | Phase 1 POC validates before full implementation |
| Bundle size too large | Low | Medium | Lazy loading + caching, acceptable for desktop |
| Execution too slow | Medium | Medium | Set expectations, add server option in v2 |
| Memory issues on large designs | Medium | Medium | Add warnings, document limitations |
| User confusion (code vs upload) | Low | Low | Clear UI tabs, onboarding tooltips |
| Collaboration conflicts | Low | Medium | Host as ground truth, clear ownership model |

## Implementation Status

**Status: Phase 1 In Progress (Server-Side Implementation)**

### Phase 1 Progress (2025-12-14)

#### Completed Tasks

1. **Created `server/pythonExecutor.js`** (~350 lines)
   - `POST /api/execute` endpoint accepting `{ code: string }`
   - Module whitelist/blacklist validation before execution
   - Isolated temp directory per execution
   - 30-second timeout with partial stdout/stderr on timeout
   - GDS file detection and storage to existing file storage (SHA-256 hash)
   - Path sanitization in error messages
   - Rate limiting: 10 executions per IP per minute
   - Bearer token authentication (same as file upload API)

2. **Updated `server/server.js`**
   - Added import for `pythonExecutor.js`
   - Added `setupPythonRoutes(app)` call

3. **Updated `server/.env.example`**
   - Added Python execution configuration variables:
     - `PYTHON_VENV_PATH`
     - `PYTHON_TIMEOUT`
     - `PYTHON_RATE_LIMIT_WINDOW`
     - `PYTHON_RATE_LIMIT_MAX`
     - `MAX_GDS_SIZE_MB`

4. **Set up Python environment on server**
   - Used `uv` for virtual environment management
   - Python 3.12.12 installed via uv
   - gdsfactory 9.25.2 installed with all dependencies
   - Virtual environment location: `/opt/gdsjam/venv`

#### Python Environment Setup (using uv)

```bash
# Install uv (fast Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.local/bin/env

# Create virtual environment with Python 3.12
sudo mkdir -p /opt/gdsjam && sudo chown $USER:$USER /opt/gdsjam
uv venv /opt/gdsjam/venv --python 3.12

# Install gdsfactory and dependencies
uv pip install gdsfactory numpy scipy matplotlib --python /opt/gdsjam/venv/bin/python

# Verify installation
/opt/gdsjam/venv/bin/python -c "import gdsfactory as gf; print(gf.__version__)"
```

#### Testing Results (2025-12-14)

All 5 test cases passed:

| Test | Description | Result |
|------|-------------|--------|
| 1 | Basic gdsfactory execution | SUCCESS - Generated GDS (12KB), fileId returned, ~10s execution |
| 2 | Missing auth token | PASS - HTTP 401, proper error message |
| 3 | Blocked module import (`os`) | PASS - Security error, blocked before execution |
| 4 | No GDS file generated | PASS - Helpful error message, stdout captured |
| 5 | Syntax error | PASS - Python traceback with sanitized server paths |

**Phase 1 Status: COMPLETE**

### Next Steps

1. Deploy to production server (copy pythonExecutor.js, set up Python venv)
2. Begin Phase 2: Client-side integration (Monaco Editor)

