# DevLog-001: MVP Implementation Plan

---
**⚠️ CRITICAL CONSTRAINT: NEVER ENABLE BROADCASTCHANNEL**
- `filterBcConns` MUST always be `true` in y-webrtc configuration
- BroadcastChannel causes issues with file sync and session state
- Always force WebRTC connections even for same-browser tabs
---

## Metadata
- **Document Version:** 1.4
- **Created:** 2025-11-18
- **Last Updated:** 2025-11-19
- **Author:** Wentao Jiang
- **Status:** Active - Week 1 In Progress
- **Target Completion:** 12 weeks (3 months)
- **Related Documents:** DevLog-000-planning.md

## Changelog
- **v1.4 (2025-11-19):** UI/UX improvements and performance optimizations
  - Fixed Y-axis flip for correct GDSII coordinate system display
  - Added grid overlay with automatic spacing based on zoom level
  - Added scale bar with correct unit conversion (database units → µm/mm/nm)
  - Added mouse cursor coordinates display (bottom-right, nm precision)
  - Added keyboard controls: Arrow keys (pan), Enter (zoom in), Shift+Enter (zoom out)
  - Fixed progress bar updates during file loading and rendering
  - Implemented async rendering with periodic yielding (every 10K polygons)
  - Added debouncing for grid/scale bar updates during panning (50ms delay)
  - Improved rendering progress granularity (polygon-based instead of cell-based)
  - Updated control notes in UI to document all keyboard shortcuts
- **v1.3 (2025-11-18):** Code cleanup and parser clarification
  - **IMPORTANT:** Clarified parser implementation - using JavaScript `gdsii` library instead of Pyodide
  - Centralized DEBUG flag and configuration constants
  - Fixed TypeScript issues (removed unused code)
  - Created CI pipeline for linting and type-checking
  - Fixed Vite base path for multi-environment deployment
  - Removed empty placeholder directories
- **v1.2 (2025-11-18):** Week 1 progress update
  - Completed project initialization and setup
  - Completed rendering prototype with FPS counter
  - Completed spatial indexing implementation
  - Updated task completion status
- **v1.1 (2025-11-18):** Technical review and refinement
  - Added Service Worker caching for Pyodide and offline support
  - Clarified hybrid rendering strategy (Container instancing + viewport culling)
  - Specified dark mode only (no light mode)
  - Added comprehensive keyboard shortcuts (arrows, Enter, Shift+Enter, F, Space+Drag)
  - Clarified session ID format (long UUID, no password)
  - Added chunked geometry transfer with compression and validation
  - Specified FPS counter always visible (top-right)
  - Added grid overlay toggle to MVP scope
  - Removed screenshot export (use OS tools)
  - Removed geometry export (no editing in MVP)
  - Deferred measurement sharing to post-MVP
  - Deferred "Jump to Cell" to post-MVP
  - Added unit testing requirements
  - Added comprehensive error handling requirements
  - Added Technical Decisions & Rationale section
  - Added Appendix with technical concept explanations
- **v1.0 (2025-11-18):** Initial implementation plan

---

## Progress Summary

### Week 1 Status: In Progress (Day 1 Complete)

**Completed:**
- Project infrastructure setup (Svelte + TypeScript + Vite)
- Development tooling (Biome, Tailwind CSS v4, Husky, lint-staged)
- Core type definitions for GDSII data structures
- Pixi.js rendering engine with WebGL2 initialization
- FPS counter (always visible, top-right corner)
- Zoom controls (mouse wheel)
- Pan controls (middle mouse + Space + drag)
- R-tree spatial indexing infrastructure
- Test geometry renderer (1K polygons)
- Dark mode UI with header and controls info
- Git repository initialization with first commit
- **GDSII Parser using JavaScript `gdsii` library (NOT Pyodide - see Technical Note below)**
- File upload with drag-and-drop support
- Centralized configuration (DEBUG flag, constants)
- CI/CD pipeline for linting and type-checking
- Environment-dependent Vite base path

**In Progress:**
- Performance testing with larger datasets (10K, 100K, 1M polygons)
- Viewport culling implementation
- Hybrid rendering strategy (Container instancing)
- Additional keyboard shortcuts (arrows, Enter, F)

**Technical Note - Parser Implementation:**
The current implementation uses the JavaScript `gdsii` library (npm package) for parsing GDSII files, NOT Pyodide + gdstk as originally planned. This decision was made to accelerate prototyping. The Pyodide approach may be revisited in Week 2 if the JavaScript parser proves insufficient for:
- Complex GDSII features (PATH, TEXT, AREF elements)
- Parse performance with large files (>100MB)
- Compatibility with diverse GDSII variants

**Current Parser Limitations (JavaScript `gdsii` library):**
- Only supports basic elements: BOUNDARY (polygons), SREF (cell instances)
- Missing support for: PATH, TEXT, AREF, BOX, property records
- Parse time for 150MB file: ~2-3 seconds (acceptable for MVP)

**Blocked:**
- None

**Next Steps:**
- Complete performance benchmarking
- Implement viewport culling using spatial index
- Add remaining keyboard shortcuts
- Set up CI/CD pipeline
- Configure Service Worker for Pyodide caching

---

## Executive Summary

This document outlines the detailed implementation plan for GDSJam MVP: a peer-to-peer, view-only collaborative GDSII viewer. The MVP will be delivered in 12 weeks across 4 phases: Technical Validation (2 weeks), Core Development (6 weeks), Polish & Testing (3 weeks), and Launch (1 week).

---

## Technical Stack

### Frontend
- **Framework:** Svelte + TypeScript + Vite
- **Rendering:** Pixi.js (WebGL2)
- **GDSII Parsing:** Pyodide + gdstk (WebAssembly)
- **Collaboration:** Y.js + y-webrtc (peer-to-peer)
- **Spatial Indexing:** rbush (R-tree for hit-testing and culling)
- **Styling:** Tailwind CSS (dark mode only)
- **Package Manager:** pnpm
- **Linting & Formatting:** Biome (unified linter/formatter), Prettier (fallback), svelte-check
- **Type Checking:** TypeScript strict mode, svelte-check
- **Caching:** Service Worker for Pyodide caching and offline support
- **Coordinate System:** Micrometers (µm) as internal unit

### Backend (Future Only)
- **Language:** Python 3.11+
- **Package Manager:** uv
- **Linting:** Ruff
- **Type Checking:** mypy (strict mode)
- **Note:** No backend required for MVP

### Deployment
- **Hosting:** Vercel or Netlify (static site)
- **Signaling:** Public y-webrtc signaling servers (MVP), self-hosted option post-MVP
- **Session IDs:** Long UUID format for security (no password protection in MVP)

---

## Project Structure

```
gdsjam/
├── .github/
│   └── workflows/          # CI/CD pipelines
├── src/
│   ├── lib/
│   │   ├── gds/           # GDSII parsing (Pyodide + gdstk)
│   │   ├── renderer/      # Pixi.js rendering engine
│   │   ├── collaboration/ # Y.js + WebRTC integration
│   │   ├── spatial/       # R-tree spatial indexing
│   │   └── utils/         # Shared utilities
│   ├── components/
│   │   ├── viewer/        # Main canvas component
│   │   ├── panels/        # Layer panel, hierarchy panel
│   │   ├── tools/         # Measurement, annotation tools
│   │   └── ui/            # Reusable UI components
│   ├── stores/            # Svelte stores for state management
│   ├── types/             # TypeScript type definitions
│   ├── App.svelte         # Root component
│   └── main.ts            # Entry point
├── public/                # Static assets
├── tests/                 # Unit and integration tests
├── docs/                  # User documentation
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── biome.json             # Biome configuration
├── tailwind.config.js
└── README.md
```

---

## Development Standards

### Code Quality Requirements
1. **TypeScript:** Strict mode enabled, no `any` types without justification
2. **Linting:** Biome for unified linting and formatting (replaces ESLint + Prettier)
3. **Type Checking:** Run `svelte-check` before commits
4. **Testing:** Vitest for unit tests, Playwright for E2E (post-MVP)
5. **Git Hooks:** Husky + lint-staged for pre-commit checks
6. **Commit Messages:** Conventional Commits format

### Performance Requirements
1. **Bundle Size:** Target < 2MB (excluding Pyodide, which loads separately)
2. **Initial Load:** < 3 seconds on 4G connection (Service Worker caching for subsequent loads)
3. **Rendering:** 60fps for 100MB GDSII files (500K-1M polygons)
4. **Memory:** Up to 1GB RAM usage acceptable for 100MB files
5. **FPS Display:** Always visible in top-right corner for performance monitoring

---

## Phase 1: Technical Validation (Week 1-2)

### Objectives
- Validate core technical assumptions
- Prove rendering performance with real GDSII files
- Confirm Pyodide + gdstk works in browser
- Test Y.js + WebRTC peer-to-peer connection

### Deliverables
1. Minimal WebGL renderer displaying GDSII geometry
2. Pyodide + gdstk parsing demo
3. Y.js + WebRTC cursor sharing demo
4. Performance benchmarks documented

---

### Week 1: Project Setup & Rendering Prototype

#### Project Initialization
- [x] Create monorepo with `pnpm create vite@latest gdsjam -- --template svelte-ts`
- [x] Initialize git repository
- [x] Configure pnpm workspace
- [x] Set up TypeScript strict mode in `tsconfig.json`
- [x] Install and configure Biome: `pnpm add -D @biomejs/biome`
- [x] Create `biome.json` with strict rules (no unused vars, consistent formatting)
- [x] Install Tailwind CSS: `pnpm add -D tailwindcss postcss autoprefixer @tailwindcss/postcss`
- [x] Configure Tailwind v4 with dark mode only
- [x] Set up Husky + lint-staged for pre-commit hooks
- [x] Create `.github/workflows/ci.yml` for automated checks (linting, type-checking, build)
- [x] Add `svelte-check` to CI pipeline
- [x] Centralize DEBUG flag in `src/lib/config.ts`
- [x] Fix Vite base path for environment-dependent deployment
- [ ] Set up Service Worker for Pyodide caching and offline support (deferred)
- [ ] Configure Vite for Service Worker registration (deferred)

#### Rendering Prototype
- [x] Install Pixi.js: `pnpm add pixi.js`
- [x] Create `src/lib/renderer/PixiRenderer.ts` class
- [x] Implement basic WebGL canvas initialization
- [x] Add zoom controls (mouse wheel)
- [x] Add pan controls (middle mouse + Space + drag)
- [x] Render simple test geometry (1K rectangles, polygons)
- [x] Implement viewport culling (only render visible geometry and instances)
- [x] Implement hybrid rendering strategy (batched rendering by layer)
- [x] Add FPS counter (always visible, top-right corner)
- [x] Add debug mode toggle to reduce console logs
- [x] **Implement LOD (Level of Detail) rendering with polygon budget (100K limit)**
- [x] **Successfully render 150MB file (1.8M polygons) without OOM crash**
- [ ] **TODO: Implement dynamic LOD updates on zoom (increase depth when zooming in)**
- [ ] Test with synthetic data (10K, 100K, 1M polygons)
- [ ] Measure FPS and memory usage
- [ ] Document performance benchmarks in `docs/benchmarks.md`

#### Spatial Indexing
- [x] Install rbush: `pnpm add rbush`
- [x] Create `src/lib/spatial/RTree.ts` wrapper
- [x] Implement geometry insertion and query methods
- [x] Integrate with renderer for viewport culling
- [ ] Test hit-testing performance (click to select polygon)

#### Additional Tasks Completed
- [x] Created comprehensive GDSII type definitions (`src/types/gds.ts`)
- [x] Created ViewerCanvas Svelte component
- [x] Updated App.svelte with dark mode UI
- [x] Configured pre-commit hooks with Biome linting
- [x] Updated README.md with project information
- [x] First git commit completed

---

### Week 2: GDSII Parsing & P2P Demo

#### TODO: Pyodide + gdstk Integration
- [ ] Install Pyodide: `pnpm add pyodide`
- [ ] Create `src/lib/gds/PyodideLoader.ts` for lazy loading
- [ ] Load Pyodide runtime (async, show loading indicator)
- [ ] Install gdstk in Pyodide: `await pyodide.loadPackage('micropip')` then `micropip.install('gdstk')`
- [ ] Create `src/lib/gds/GDSParser.ts` wrapper
- [ ] Implement GDSII file parsing (return polygons, layers, cells)
- [ ] Test with real GDSII files (download from KLayout examples, GDSFactory gallery)
- [ ] Measure parse time for 1MB, 10MB, 100MB files
- [ ] Convert parsed data to Pixi.js-compatible format
- [ ] Integrate parser with renderer

#### TODO: Y.js + WebRTC Demo
- [ ] Install Y.js: `pnpm add yjs y-webrtc`
- [ ] Create `src/lib/collaboration/YjsProvider.ts`
- [ ] Initialize Y.Doc and y-webrtc provider
- [ ] Create shared Y.Map for cursor positions
- [ ] Implement cursor position broadcasting
- [ ] Create simple UI to display remote cursors
- [ ] Test with 2 browser windows (localhost)
- [ ] Test with 2 devices on same network
- [ ] Test with 2 devices on different networks (via public signaling)
- [ ] Measure sync latency (cursor movement delay)
- [ ] Document WebRTC connection flow

#### TODO: Validation Checkpoint
- [ ] Review performance benchmarks (must hit 60fps for 100MB files)
- [ ] Review Pyodide load time (must be < 5 seconds)
- [ ] Review P2P connection reliability (must work across networks)
- [ ] Document findings in `docs/phase1-validation.md`
- [ ] GO/NO-GO decision: Proceed to Phase 2 if all benchmarks pass

---

## Phase 2: Core Development (Week 3-8)

### Objectives
- Build complete viewer functionality
- Implement collaboration features
- Create essential UI components
- Integrate all systems

### Deliverables
1. Functional GDSII viewer with zoom, pan, layer controls
2. Multi-user sessions with presence indicators
3. Comment/annotation system
4. Layer panel and hierarchy navigation
5. Measurement tools

---

### Week 3-4: Core Viewer Implementation

#### TODO: GDSII Data Model
- [ ] Create `src/types/gds.ts` with TypeScript interfaces (Layer, Cell, Polygon, Instance)
- [ ] Create `src/lib/gds/GDSDocument.ts` class to hold parsed data
- [ ] Implement cell hierarchy tree structure
- [ ] Implement layer metadata (name, color, visibility)
- [ ] Create Svelte store `src/stores/gdsStore.ts` for document state
- [ ] Add file upload handler in `src/components/FileUpload.svelte`
- [ ] Integrate parser with store (upload → parse → update store)

#### TODO: Renderer Enhancement
- [x] Refactor renderer to consume GDSDocument from store
- [x] Implement layer-based rendering (different colors per layer)
- [ ] Add layer visibility toggling
- [x] Implement cell instance rendering (handle transformations: translation, rotation, mirroring)
- [x] Add grid overlay (optional, toggleable)
- [x] Implement coordinate display (show mouse position in GDS units)
- [x] Add zoom-to-fit functionality
- [x] Optimize rendering for large polygon counts (batching, instancing)

#### TODO: Navigation Controls
- [ ] Create `src/components/viewer/ViewportControls.svelte` (optional - controls work without UI buttons)
- [x] Implement mouse wheel zoom (zoom to cursor position)
- [x] Implement pan (middle mouse drag or Space + drag)
- [ ] Add zoom in/out buttons (optional - keyboard shortcuts work)
- [x] Add reset view button (zoom to fit all geometry)
- [x] Implement keyboard shortcuts:
  - [x] Arrow keys: Pan viewport
  - [x] Enter: Zoom in
  - [x] Shift+Enter: Zoom out
  - [x] F: Fit view (zoom to fit all geometry)
  - [x] Space+Drag: Pan (alternative to middle mouse)
  - [x] Mouse wheel: Zoom to cursor position

#### TODO: Layer Panel
- [ ] Create `src/components/panels/LayerPanel.svelte`
- [ ] Display list of all layers with names and colors
- [ ] Add visibility toggle checkboxes
- [ ] Implement "show all" / "hide all" buttons
- [ ] Add layer search/filter
- [ ] Persist layer visibility state in Y.js shared map (sync across users)
- [ ] Sync layer colors across users by default (store in Y.js)
- [ ] Add grid overlay toggle option (sync across users)

---

### Week 5-6: Collaboration Features

#### TODO: Session Management
- [ ] Create `src/lib/collaboration/SessionManager.ts`
- [ ] Generate unique room IDs using long UUID format (crypto.randomUUID())
- [ ] Implement "Create Session" flow (upload file → create room → get shareable link)
- [ ] Implement "Join Session" flow (paste link → connect to room)
- [ ] Display connection status (connecting, connected, disconnected)
- [ ] Handle host disconnect (show "Host disconnected, session ended" message)
- [ ] Store session state in Y.js (full geometry data, metadata, layer visibility, grid visibility, comments, cursors/FOV)

#### TODO: User Presence
- [ ] Create `src/lib/collaboration/PresenceManager.ts`
- [ ] Implement user awareness (Y.js Awareness API)
- [ ] Assign random colors to users
- [ ] Broadcast cursor position (throttle to 60Hz)
- [ ] Render remote cursors on canvas
- [ ] Display username labels next to cursors
- [ ] Show user list in sidebar (who's online)
- [ ] Add "you" indicator for local user

#### TODO: Geometry Transfer (Host to Peers)
- [ ] Implement geometry serialization (GDSDocument → JSON)
- [ ] Transfer geometry via Y.js shared map (chunked for large files)
- [ ] Implement chunked transfer with progress indicator
- [ ] Add transfer resume capability (handle interruptions)
- [ ] Compress geometry data before transfer (gzip/brotli)
- [ ] Validate data integrity after transfer (checksum)
- [ ] Show progress indicator for peers receiving data
- [ ] Implement geometry deserialization (JSON → GDSDocument)
- [ ] Handle transfer errors (timeout, connection drop)

#### TODO: Comments & Annotations
- [ ] Create `src/types/comment.ts` interface (id, author, text, position, timestamp)
- [ ] Create Y.js shared array for comments
- [ ] Create `src/components/tools/CommentTool.svelte`
- [ ] Implement "Add Comment" mode (click on canvas to pin comment)
- [ ] Render comment markers on canvas (small icons at pinned positions)
- [ ] Create `src/components/panels/CommentPanel.svelte` sidebar
- [ ] Display all comments in chronological order
- [ ] Implement single-threaded replies (reply to comment, no nested threads)
- [ ] Add delete comment functionality (author only)
- [ ] Sync comments via Y.js CRDT

---

### Week 7-8: UI Polish & Additional Features

#### TODO: Hierarchy Navigation
- [ ] Create `src/components/panels/HierarchyPanel.svelte`
- [ ] Display cell tree (root cells and their instances)
- [ ] Implement expand/collapse for cell instances
- [ ] Show instance count for each cell
- [ ] Highlight selected cell in viewer
- [ ] Note: "Jump to Cell" functionality deferred to post-MVP

#### TODO: Measurement Tools
- [ ] Create `src/components/tools/MeasureTool.svelte`
- [ ] Implement ruler tool (click two points → show distance)
- [ ] Display distance in micrometers (µm)
- [ ] Implement area measurement (click polygon → show area)
- [ ] Add measurement overlay on canvas
- [ ] Allow deleting measurements
- [ ] Store measurements in local state (not synced for MVP)
- [ ] Note: Measurement sharing deferred to post-MVP

#### TODO: Export Features
- [ ] Implement comment export (comments → JSON file)
- [ ] Add "Export Comments" button
- [ ] Add "Download Original GDS" button (re-download uploaded file)
- [ ] Note: Screenshot export removed from MVP (users can use OS screenshot tools)
- [ ] Note: Geometry export removed from MVP (no editing, so no modified geometry)

#### TODO: UI/UX Refinement
- [ ] Create responsive layout (sidebar + main canvas)
- [ ] Add loading states for all async operations
- [ ] Implement comprehensive error handling:
  - [ ] Malformed GDSII files
  - [ ] Parsing failures
  - [ ] WebRTC connection failures
  - [ ] Out-of-memory errors
  - [ ] User-friendly error messages for all scenarios
- [ ] Add tooltips for all buttons and controls
- [ ] Create keyboard shortcut help modal
- [ ] Implement dark mode only (no light mode)
- [ ] Add app logo and branding
- [ ] Create onboarding flow (first-time user guide)

---

## Phase 3: Testing & Polish (Week 9-11)

### Objectives
- Comprehensive testing with real GDSII files
- Performance optimization
- Bug fixes and stability improvements
- Documentation

### Deliverables
1. Tested with 20+ real-world GDSII files
2. Performance optimizations applied
3. User documentation complete
4. CI/CD pipeline operational

---

### Week 9: Testing & Bug Fixes

#### TODO: Unit Testing
- [ ] Set up Vitest for unit tests
- [ ] Write tests for critical paths:
  - [ ] GDSII parser (parsing, serialization, deserialization)
  - [ ] Renderer (viewport culling, instance rendering)
  - [ ] Spatial indexing (R-tree queries, hit-testing)
  - [ ] Y.js integration (comment sync, cursor sync, layer visibility sync)
- [ ] Add test coverage reporting
- [ ] Target: >70% coverage for core libraries

#### TODO: Real-World Testing
- [ ] Collect 20+ GDSII files from various sources (KLayout, GDSFactory, academic labs)
- [ ] Test parsing for each file (document any failures)
- [ ] Test rendering performance (measure FPS, memory usage)
- [ ] Test with different file sizes (1MB, 10MB, 50MB, 100MB)
- [ ] Test with different layer counts (10, 50, 100+ layers)
- [ ] Test with deep cell hierarchies (10+ levels)
- [ ] Document compatibility issues in `docs/compatibility.md`

#### TODO: Cross-Browser Testing
- [ ] Test on Chrome (primary target)
- [ ] Test on Firefox
- [ ] Test on Safari (macOS and iOS)
- [ ] Test on Edge
- [ ] Document browser-specific issues
- [ ] Add browser compatibility warnings if needed

#### TODO: Collaboration Testing
- [ ] Test with 2 users (same network)
- [ ] Test with 2 users (different networks)
- [ ] Test with 5 users (max concurrent users)
- [ ] Test host disconnect scenario
- [ ] Test network interruption and reconnection
- [ ] Test with slow connections (throttle to 3G)
- [ ] Measure sync latency under various conditions

#### TODO: Bug Fixes
- [ ] Triage all discovered issues (critical, high, medium, low)
- [ ] Fix all critical bugs (crashes, data loss)
- [ ] Fix high-priority bugs (major UX issues)
- [ ] Document known issues for medium/low priority bugs

---

### Week 10: Performance Optimization

#### TODO: Rendering Optimization
- [ ] Profile rendering performance (Chrome DevTools)
- [ ] Optimize polygon batching (reduce draw calls)
- [ ] Implement geometry simplification for zoomed-out views (optional)
- [ ] Optimize R-tree queries (tune parameters)
- [ ] Reduce garbage collection (object pooling for frequently created objects)
- [ ] Test optimizations with 100MB files (target 60fps)

#### TODO: Bundle Optimization
- [ ] Analyze bundle size with `vite-bundle-visualizer`
- [ ] Code-split Pyodide loading (lazy load only when needed)
- [ ] Tree-shake unused dependencies
- [ ] Optimize Tailwind CSS (purge unused classes)
- [ ] Compress assets (images, fonts)
- [ ] Target bundle size < 2MB (excluding Pyodide)

#### TODO: Load Time Optimization
- [ ] Implement progressive loading (show UI before Pyodide loads)
- [ ] Add loading progress indicators
- [ ] Implement Service Worker caching for Pyodide runtime
- [ ] Cache Pyodide in Service Worker after first load (instant subsequent loads)
- [ ] Cache app bundle and static assets
- [ ] Store parsed GDS data in IndexedDB for offline viewing
- [ ] Preload critical resources
- [ ] Test on slow connections (3G, 4G)
- [ ] Target initial load < 3 seconds on 4G (first visit)
- [ ] Target instant load on subsequent visits (Service Worker cache)

---

### Week 11: Documentation & CI/CD

#### TODO: User Documentation
- [ ] Write `README.md` with project overview and quick start
- [ ] Create `docs/user-guide.md` with feature walkthrough
- [ ] Document keyboard shortcuts in `docs/shortcuts.md`
- [ ] Create FAQ document `docs/faq.md`
- [ ] Add troubleshooting guide `docs/troubleshooting.md`
- [ ] Record demo video (2-3 minutes, upload to YouTube)
- [ ] Create screenshot gallery for README

#### TODO: Developer Documentation
- [ ] Document architecture in `docs/architecture.md`
- [ ] Document GDSII parsing flow in `docs/gds-parsing.md`
- [ ] Document rendering pipeline in `docs/rendering.md`
- [ ] Document collaboration system in `docs/collaboration.md`
- [ ] Add code comments for complex logic
- [ ] Create contribution guide `CONTRIBUTING.md`

#### TODO: CI/CD Pipeline
- [ ] Set up GitHub Actions workflow for CI
- [ ] Add automated linting (Biome)
- [ ] Add automated type checking (svelte-check, tsc)
- [ ] Add automated tests (Vitest)
- [ ] Add build verification
- [ ] Set up automated deployment to Vercel/Netlify (on main branch)
- [ ] Add PR preview deployments
- [ ] Configure branch protection rules (require CI pass)

---

## Phase 4: Launch (Week 12)

### Objectives
- Deploy to production
- Announce to target communities
- Gather initial feedback

### Deliverables
1. Production deployment live
2. Launch announcement published
3. Feedback collection system in place

---

### Week 12: Deployment & Launch

#### TODO: Production Deployment
- [ ] Create production build (`pnpm build`)
- [ ] Test production build locally
- [ ] Deploy to Vercel or Netlify
- [ ] Configure custom domain (optional)
- [ ] Set up analytics (Plausible or similar, privacy-focused)
- [ ] Set up error tracking (Sentry or similar)
- [ ] Test production deployment thoroughly
- [ ] Create rollback plan

#### TODO: Launch Preparation
- [ ] Prepare launch announcement (blog post, social media)
- [ ] Create demo GDSII files for users to try
- [ ] Set up feedback collection (GitHub Discussions or Discord)
- [ ] Prepare FAQ based on beta testing
- [ ] Create social media assets (screenshots, demo GIFs)

#### TODO: Community Outreach
- [ ] Post to GDSFactory community (GitHub Discussions, Slack)
- [ ] Post to r/chipdesign, r/FPGA, r/ECE on Reddit
- [ ] Share on Hacker News (Show HN)
- [ ] Email academic labs and photonics groups
- [ ] Post to Tiny Tapeout community
- [ ] Share on LinkedIn, Twitter/X
- [ ] Reach out to KLayout community

#### TODO: Post-Launch Monitoring
- [ ] Monitor analytics (user count, session duration)
- [ ] Monitor error tracking (fix critical issues immediately)
- [ ] Respond to user feedback and questions
- [ ] Triage feature requests for Phase 1
- [ ] Document lessons learned in `docs/post-mortem.md`

---

## Success Metrics

### Technical Metrics (Must Achieve)
- Render 100MB GDSII file at 60fps on mid-range laptop
- P2P connection established within 5 seconds
- Comment sync latency < 100ms
- Support 5+ concurrent users without performance degradation
- Initial load time < 3 seconds on 4G
- Bundle size < 2MB (excluding Pyodide)

### Adoption Metrics (6 Months Post-Launch)
- 100+ weekly active users
- 500+ layouts viewed
- 50+ collaborative sessions
- 10+ GitHub stars per week
- 20%+ user retention (return within 7 days)

### Qualitative Metrics
- Positive feedback from beta testers
- Feature requests indicating product-market fit
- Community contributions (bug reports, PRs)

---

## Technical Decisions & Rationale

### Confirmed Design Decisions (2025-11-18)

#### Rendering Strategy
- **Decision:** Hybrid rendering approach
  - Keep cell hierarchy intact for navigation
  - Use Pixi.js Container instancing for repeated cells
  - Implement viewport culling for instances and polygons
- **Rationale:** Balances memory efficiency with rendering performance while preserving hierarchy information

#### Coordinate System
- **Decision:** Micrometers (µm) as internal unit
- **Rationale:** Standard unit in GDSII files, matches industry conventions

#### UI/UX Decisions
- **Dark Mode Only:** No light mode in MVP (simplifies development, matches EDA tool conventions)
- **FPS Counter:** Always visible in top-right corner (performance transparency)
- **Grid Overlay:** Toggle option included in MVP (easy to implement, useful for alignment)
- **Keyboard Shortcuts:** Comprehensive set including arrows (pan), Enter (zoom in), Shift+Enter (zoom out), F (fit view), Space+Drag (pan)

#### Collaboration Architecture
- **Session IDs:** Long UUID format (crypto.randomUUID()) for security, no password protection in MVP
- **Signaling Server:** Public y-webrtc servers for MVP, self-hosted option post-MVP
- **Y.js Shared State:** Full geometry data, metadata, comments, cursors/FOV, layer visibility, grid visibility
- **Layer Colors:** Synced across users by default (stored in Y.js)
- **Comment Threading:** Single-threaded replies only (no nested threads)

#### Data Transfer
- **Geometry Transfer:** Chunked transfer with progress indicator, resume capability, compression (gzip/brotli), integrity validation (checksum)
- **Rationale:** Ensures reliable transfer of large files (100MB+) over WebRTC

#### Performance & Caching
- **Service Worker:** Cache Pyodide runtime and app bundle for instant subsequent loads
- **Offline Support:** Store parsed GDS data in IndexedDB for offline viewing
- **Memory Budget:** Up to 1GB RAM acceptable for 100MB files (modern browsers handle this well)

#### GDSII Parsing
- **Parser Choice:** Pyodide + gdstk
- **Rationale:** Full GDSII compatibility and generality, leverages mature library

### Deferred to Post-MVP

#### Features Explicitly Removed from MVP
- **Measurement Sharing:** Local-only measurements in MVP, sharing deferred to post-MVP
- **Jump to Cell:** Cell navigation deferred to post-MVP
- **Minimap:** Deferred to post-MVP
- **Screenshot Export:** Removed (users can use OS screenshot tools)
- **Geometry Export:** Removed (no editing in MVP, just re-download original file)
- **Custom Layer Colors:** Deferred to post-MVP (sync default colors only in MVP)
- **Light Mode:** Dark mode only in MVP

#### Known Concerns for Future Consideration
- **WebRTC Reliability:** Corporate firewalls may block WebRTC (note for testing, fallback to relay server post-MVP)
- **Coordinate Precision:** JavaScript Number precision limits for very large layouts (>10mm) - acceptable for MVP target files
- **Safari Compatibility:** Historical WebRTC issues on Safari (note for cross-browser testing in Week 9)
- **Host Migration:** y-webrtc doesn't provide built-in host migration (accept limitation for MVP, custom implementation post-MVP)

---

## Risk Mitigation

### High-Risk Items
1. **Rendering performance**: Mitigated by early prototyping in Phase 1
2. **Pyodide load time**: Mitigated by lazy loading and progress indicators
3. **WebRTC reliability**: Mitigated by testing across networks, fallback messaging
4. **GDSII compatibility**: Mitigated by testing with diverse real-world files

### Contingency Plans
- **If rendering performance fails**: Consider WebGPU or tiling strategy
- **If Pyodide too slow**: Implement pure JS parser for common GDSII subset
- **If WebRTC unreliable**: Deploy self-hosted signaling server or relay server
- **If timeline slips**: Cut scope (remove measurement tools, hierarchy panel)

---

## Dependencies & Prerequisites

### Development Environment
- Node.js 18+ (for Vite and pnpm)
- pnpm 8+ (package manager)
- Git (version control)
- Modern browser (Chrome, Firefox, Safari)
- Code editor (VS Code recommended with Svelte extension)

### External Services
- GitHub (code hosting, CI/CD)
- Vercel or Netlify (deployment)
- y-webrtc public signaling servers (P2P connection)

### Test Data Sources
- KLayout example files
- GDSFactory gallery
- SkyWater PDK layouts
- Academic lab layouts (with permission)

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Set up development environment** (Week 1, Day 1)
3. **Begin Phase 1 execution** (Week 1, Day 2)
4. **Weekly progress reviews** (every Friday)
5. **Phase gate reviews** (end of each phase, GO/NO-GO decision)

---

## Appendix: Package Installation Commands

### Initial Setup
```bash
# Create project
pnpm create vite@latest gdsjam -- --template svelte-ts
cd gdsjam

# Install dependencies
pnpm install

# Install development tools
pnpm add -D @biomejs/biome husky lint-staged

# Install core libraries
pnpm add pixi.js yjs y-webrtc pyodide rbush nanoid

# Install UI libraries
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Install testing (optional for MVP)
pnpm add -D vitest @testing-library/svelte

# Initialize git hooks
npx husky init
```

### Biome Configuration
```bash
# Initialize Biome
npx @biomejs/biome init

# Run linting
pnpm biome check --write ./src

# Run formatting
pnpm biome format --write ./src
```

### Type Checking
```bash
# Install svelte-check
pnpm add -D svelte-check

# Run type checking
pnpm svelte-check
```

---

## Appendix: Technical Concepts

### Service Worker for Performance Optimization

**What is a Service Worker?**
- JavaScript worker that runs in the background, separate from the web page
- Acts as a programmable network proxy between the app and the network
- Enables caching, offline support, and background sync

**How it improves load time for GDSJam:**
1. **First Visit:** Download Pyodide (~10-15MB) and app bundle → slow initial load
2. **Service Worker Caches:** Pyodide runtime, gdstk package, app bundle, static assets
3. **Subsequent Visits:** Load from cache → instant startup (no network requests)
4. **Offline Viewing:** Previously loaded GDS files stored in IndexedDB → view offline

**Implementation Strategy:**
- Cache Pyodide runtime after first successful load
- Cache app bundle and static assets (HTML, CSS, JS)
- Store parsed GDS data in IndexedDB for offline access
- Update cache in background when new versions available

### R-tree Spatial Indexing

**What is an R-tree?**
- Spatial indexing data structure for organizing 2D/3D rectangles
- Similar to binary search tree, but for bounding boxes
- Enables fast spatial queries: "Which objects are in this region?"

**How it works:**
- Organizes bounding boxes in a tree structure
- Each node contains the bounding box of all its children
- Query traverses tree, pruning branches that don't intersect query region

**Performance Benefits:**
- **Without R-tree:** Check all 1M polygons → 1M comparisons per query
- **With R-tree:** Check tree nodes → ~log(1M) ≈ 20 comparisons per query
- **50,000x speedup** for typical viewport culling queries

**Use Cases in GDSJam:**
1. **Viewport Culling:** "Which polygons are visible in current viewport?" → Only render those
2. **Hit Testing:** "User clicked at (x, y), which polygon?" → Fast lookup
3. **Bounding Box Queries:** "What's the extent of this cell?" → Quick calculation

**Library:** `rbush` - high-performance JavaScript R-tree implementation

### Hybrid Rendering Strategy

**Three Rendering Approaches:**

**Option A: Flatten Hierarchy**
- Convert all cell instances into absolute polygons
- Example: Cell A with 100 instances of Cell B (50 polygons each) → 5,000 polygons
- **Pros:** Simple rendering, fast draw calls
- **Cons:** Massive memory usage (100x increase), loses hierarchy, slow parsing

**Option B: Render Instances Individually**
- Store cell definitions once, render instances with transformations
- Example: Store Cell B once (50 polygons), render 100 times with transforms
- **Pros:** Memory efficient, preserves hierarchy, fast parsing
- **Cons:** Transformation overhead per instance

**Option C: Hybrid (Selected for MVP)**
- Keep hierarchy for navigation and memory efficiency
- Use Pixi.js Container instancing for repeated cells (GPU instancing)
- Apply viewport culling to instances (don't render off-screen instances)
- Future: Flatten only when zoomed out (LOD optimization)

**Why Hybrid?**
- Balances memory efficiency (store geometry once) with rendering performance (GPU instancing)
- Preserves hierarchy for navigation (cell tree, instance count)
- Enables future optimizations (LOD, progressive loading)

### Y.js CRDT for Collaboration

**What is Y.js?**
- Conflict-free Replicated Data Type (CRDT) library for real-time collaboration
- Automatically resolves conflicts when multiple users edit simultaneously
- 100-1000x faster than other CRDT implementations

**What goes into Y.js shared state?**
1. **Full Geometry Data:** Parsed GDSII structure (polygons, cells, instances)
2. **User Metadata:** User names, colors, connection status
3. **Comments:** Pinned comments with position, author, text, timestamp
4. **Cursors/FOV:** Real-time cursor positions and viewport (field of view)
5. **Rendering Settings:** Layer visibility, layer colors, grid visibility

**Why store full geometry in Y.js?**
- Ensures all peers have identical geometry data
- Enables host migration (any peer can become new host)
- Simplifies sync logic (single source of truth)

**Performance Considerations:**
- Y.js can handle large documents (100MB+ geometry data)
- Initial sync transfers full document (chunked with progress indicator)
- Subsequent updates are incremental (only changes synced)

---

## Week 1 Implementation Notes (2025-11-18)

### LOD (Level of Detail) Rendering - CRITICAL FIX

**Problem:** Browser OOM crash when loading 150MB GDSII file (1.8M polygons)

**Root Cause Analysis:**
1. Initial approach: Batched rendering (one Graphics per layer) reduced objects from 1.8M to 3,879
2. Still crashed because `fitToView()` zooms out to show entire layout
3. Viewport culling sees everything as "visible" → tries to render all 1.8M polygons → OOM

**Solution: Polygon Budget + Hierarchy Depth Limiting**
- **Polygon Budget:** Cap rendering at 100K polygons per render
- **Hierarchy Depth:** Start with `depth=0` (only top cell polygons, skip instances)
- **Progressive Rendering:** Increase depth when user zooms in (NOT YET IMPLEMENTED)

**Implementation Details:**
```typescript
// src/lib/renderer/PixiRenderer.ts
private maxPolygonsPerRender = 100000;  // Polygon budget
private currentRenderDepth = 0;         // Start shallow

renderGDSDocument(document: GDSDocument): void {
    // Render with budget and depth limits
    this.renderCellGeometry(cell, document, 0, 0, 0, false, 1,
        this.currentRenderDepth,  // depth=0 initially
        polygonBudget             // 100K max
    );
}

renderCellGeometry(..., maxDepth: number, polygonBudget: number): number {
    // Render this cell's polygons
    // ...

    // Only render instances if depth > 0
    if (maxDepth > 0 && remainingBudget > 0) {
        for (const instance of cell.instances) {
            this.renderCellGeometry(..., maxDepth - 1, remainingBudget);
        }
    }
}
```

**Results:**
- ✅ 150MB file (1.8M polygons) loads successfully without crash
- ✅ Renders ~100K polygons in ~500ms
- ✅ Browser memory usage stays under 1GB

**Known Issues:**
- ⚠️ **LOD not updated on zoom:** Currently renders at depth=0 once, never increases depth when zooming in
- ⚠️ **Missing detail:** Users can't see instance hierarchy until dynamic LOD is implemented

**Next Steps:**
1. Implement zoom-based LOD updates:
   - Listen to zoom events
   - Calculate appropriate depth based on zoom level
   - Re-render with increased depth when zoomed in
   - Cache rendered cells to avoid re-rendering
2. Add progressive rendering:
   - Render in chunks with `requestIdleCallback()`
   - Show loading indicator during progressive render
3. Implement proper Container instancing:
   - Render each unique cell once
   - Reuse via Pixi.js Container instances
   - Reduce memory further (target: 56 Graphics objects globally)

---

## Week 1 Day 2 Implementation Notes (2025-11-19)

### UI/UX Improvements & Performance Optimizations

This session focused on fixing critical UX issues and optimizing rendering performance for large GDSII files.

---

### Issue 1: Y-Axis Coordinate System Flip

**Problem:** GDSII uses Cartesian coordinates (Y-up), but Pixi.js uses screen coordinates (Y-down), causing layouts to appear upside-down.

**Solution:**
```typescript
// src/lib/renderer/PixiRenderer.ts
this.mainContainer.scale.y = -1;  // Flip Y-axis
```

**Impact:** Layouts now display correctly with proper orientation.

---

### Issue 2: Grid Overlay Implementation

**Problem:** No visual reference for scale and alignment.

**Solution:**
- Implemented automatic grid spacing based on zoom level
- Grid lines drawn in world coordinates (not screen space)
- Toggleable via `toggleGrid()` method
- Grid updates on pan/zoom with debouncing (50ms)

**Implementation:**
```typescript
private performGridUpdate(): void {
    const viewportBounds = this.getViewportBounds();
    const viewportWidth = viewportBounds.maxX - viewportBounds.minX;

    // Calculate grid spacing (powers of 10)
    const targetGridLines = 10;
    const rawSpacing = viewportWidth / targetGridLines;
    const gridSpacing = Math.pow(10, Math.floor(Math.log10(rawSpacing)));

    // Draw grid lines...
}
```

**Impact:** Users can now see scale and align features visually.

---

### Issue 3: Scale Bar with Unit Conversion

**Problem:** Scale bar showed incorrect units and values (>1e10 mm).

**Root Cause:** Incorrect conversion formula from database units to physical units.

**Solution:**
```typescript
// WRONG: dbToMicrometers = (user / database) * 1e6  → 1e9 multiplier
// CORRECT: dbToUserUnits = database / user  → 0.001 multiplier

const dbToUserUnits = this.documentUnits.database / this.documentUnits.user;
// For typical GDSII: 1e-9 / 1e-6 = 0.001
// So 1000 database units = 1 µm ✓
```

**Smart Unit Formatting:**
- Shows **mm** for values ≥ 1000 µm
- Shows **µm** for values ≥ 1 µm
- Shows **nm** for values < 1 µm

**Impact:** Scale bar now shows correct physical dimensions.

---

### Issue 4: Mouse Cursor Coordinates Display

**Problem:** No way to see exact coordinates while navigating.

**Solution:**
- Added text display at bottom-right of canvas
- Converts screen coordinates → world coordinates → physical units (µm)
- Shows 3 decimal places (nanometer precision)
- Updates in real-time on mouse move

**Implementation:**
```typescript
this.app.canvas.addEventListener("mousemove", (e) => {
    const worldX = (e.offsetX - this.mainContainer.x) / this.mainContainer.scale.x;
    const worldY = (e.offsetY - this.mainContainer.y) / this.mainContainer.scale.y;
    const worldXMicrometers = worldX * dbToUserUnits;
    const worldYMicrometers = worldY * dbToUserUnits;
    this.coordsText.text = `X: ${worldXMicrometers.toFixed(3)} µm, Y: ${worldYMicrometers.toFixed(3)} µm`;
});
```

**Impact:** Users can precisely locate features in the layout.

---

### Issue 5: Keyboard Navigation Controls

**Problem:** Mouse-only navigation is inefficient for precise movements.

**Solution:**
- **Arrow Keys:** Pan viewport (50 pixels per press)
- **Enter:** Zoom in (1.1x) to center
- **Shift+Enter:** Zoom out (0.9x) from center
- All controls prevent default browser behavior
- Update viewport, grid, and scale bar after each action

**Impact:** Faster, more precise navigation for power users.

---

### Issue 6: Progress Bar Not Updating

**Problem:** Progress bar jumped from 0% → 100% during file loading and rendering.

**Root Cause Analysis:**
1. **File Loading:** Progress updates were synchronous, UI couldn't repaint
2. **Rendering:** `renderCellGeometry()` was synchronous, processed 776K polygons in 11 seconds without yielding

**Solution - File Loading:**
```typescript
// src/lib/gds/GDSParser.ts
export async function parseGDSII(...): Promise<GDSDocument> {
    onProgress?.(10, "Converting file data...");
    await new Promise(resolve => setTimeout(resolve, 0));  // Yield to browser
    // ... continue parsing
}
```

**Solution - Rendering:**
```typescript
// src/lib/renderer/PixiRenderer.ts
private async renderCellGeometry(...): Promise<number> {
    const yieldInterval = 10000;  // Yield every 10K polygons

    for (let i = 0; i < totalPolygonsInCell; i++) {
        // ... render polygon

        if (onProgress && i > 0 && i % yieldInterval === 0) {
            const progress = Math.floor((i / totalPolygonsInCell) * 100);
            onProgress(progress, `Processing ${cell.name}: ${i}/${totalPolygonsInCell} polygons`);
            await new Promise(resolve => setTimeout(resolve, 0));  // Yield to browser
        }
    }
}
```

**Progress Calculation:**
- Pre-calculate total polygon count across all cells
- Update progress based on polygon count (not cell count)
- For 776K polygon file: updates every 10K polygons (~78 updates total)

**Impact:** Smooth progress bar updates from 0% → 100% with intermediate steps.

---

### Issue 7: FPS Drops During Panning

**Problem:** Panning large layouts caused FPS to drop significantly.

**Root Cause:** Grid and scale bar were being redrawn on **every mousemove** event during panning.

**Solution - Debouncing:**
```typescript
private updateGrid(): void {
    if (this.gridUpdateTimeout !== null) {
        clearTimeout(this.gridUpdateTimeout);
    }
    this.gridUpdateTimeout = window.setTimeout(() => {
        this.performGridUpdate();
        this.gridUpdateTimeout = null;
    }, 50);  // 50ms debounce
}
```

**Debounce Strategy:**
- **Viewport culling:** 100ms delay (expensive spatial queries)
- **Grid updates:** 50ms delay (graphics redraw)
- **Scale bar updates:** 50ms delay (graphics redraw)
- **Direct calls:** Use `performXXX()` methods for non-interactive updates (fitToView, toggleGrid)

**Impact:** Smooth 60 FPS panning even on large files (776K polygons).

---

### Issue 8: Fine-Grain Rendering Progress

**Problem:** For single-cell files, progress jumped from 0% → 80% with no intermediate updates.

**Solution:**
- Calculate total polygon count before rendering
- Update progress proportionally based on polygons processed
- Show cell name and polygon count in progress message
- Update before and after each cell render

**Progress Messages:**
```
0% - "Preparing to render..."
0% - "Rendering Big_Dipper_v1_3 (776458 polygons)..."
1% - "Processing Big_Dipper_v1_3: 10000/776458 polygons"
2% - "Processing Big_Dipper_v1_3: 20000/776458 polygons"
...
80% - "Rendered Big_Dipper_v1_3"
90% - "Fitting to view..."
100% - "Render complete!"
```

**Impact:** Users see detailed progress during long rendering operations.

---

### Updated Task Completion Status

**Week 1 Rendering Prototype:**
- [x] Add zoom controls (mouse wheel)
- [x] Add pan controls (middle mouse + Space + drag)
- [x] Add FPS counter (always visible, top-right corner)
- [x] Implement viewport culling (only render visible geometry)
- [x] Implement LOD rendering with polygon budget (100K limit)
- [x] Successfully render 150MB file (1.8M polygons) without OOM crash
- [x] **Fix Y-axis coordinate system (Cartesian → screen)**
- [x] **Add grid overlay with automatic spacing**
- [x] **Add scale bar with correct unit conversion**
- [x] **Add mouse cursor coordinates display**
- [x] **Add keyboard controls (arrows, Enter, Shift+Enter)**
- [x] **Fix progress bar updates (file loading + rendering)**
- [x] **Optimize panning performance (debouncing)**
- [ ] TODO: Implement dynamic LOD updates on zoom

**Week 1 Navigation Controls:**
- [x] Implement mouse wheel zoom (zoom to cursor position)
- [x] Implement pan (middle mouse drag or Space + drag)
- [x] **Implement keyboard shortcuts:**
  - [x] Arrow keys: Pan viewport
  - [x] Enter: Zoom in
  - [x] Shift+Enter: Zoom out
  - [x] Space+Drag: Pan (alternative to middle mouse)
  - [x] Mouse wheel: Zoom to cursor position
  - [x] **F key: Fit view (zoom to fit all geometry)**
- [x] Add reset view functionality (via fitToView method)

---

### Performance Metrics (2025-11-19)

**Test File:** Big_Dipper_v1_3.gds (150MB, 776,458 polygons, 308 instances)

**Loading Performance:**
- Parse time: ~2-3 seconds
- Progress updates: Smooth 0% → 100% with intermediate steps

**Rendering Performance:**
- Initial render: 11 seconds (100K polygon budget, depth=0)
- Rendered polygons: 100,000 (budget limit reached)
- Graphics objects: 29 (batched by layer)
- Progress updates: ~78 updates (every 10K polygons)
- Memory usage: < 1GB

**Interaction Performance:**
- Panning FPS: 60 FPS (smooth with debouncing)
- Zoom FPS: 60 FPS
- Viewport culling: 29/29 polygons visible (after fitToView)
- Grid/scale bar update delay: 50ms (imperceptible)

**Browser:** Chrome on macOS

---

### Code Quality

**All changes pass:**
- ✅ Biome linting (no errors)
- ✅ TypeScript type checking (strict mode)
- ✅ Svelte component validation

**Debug Logging:**
- Added comprehensive console logging for progress tracking
- `[PixiRenderer] Progress: X% - message`
- `[gdsStore] setRendering: X% - message`
- Helps diagnose future issues

---

### Next Steps

**Immediate (Week 1):**
1. Implement F key for fit-to-view
2. Test with more diverse GDSII files
3. Document keyboard shortcuts in help modal
4. Add loading state improvements

**Short-term (Week 2):**
1. Implement dynamic LOD updates on zoom
2. Add proper Container instancing for repeated cells
3. Implement progressive rendering with requestIdleCallback
4. Begin Pyodide + gdstk integration (replace JavaScript parser)

**Medium-term (Week 3-4):**
1. Layer panel with visibility controls
2. Hierarchy panel with cell tree
3. Measurement tools (ruler, area)
4. Begin Y.js + WebRTC integration

---

**End of Document**

