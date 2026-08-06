# DevLog-007-00: Semantic Chipmap and Physical-Design Analysis Roadmap

**Date**: 2026-08-05  
**Status**: Proposed  
**Scope**: Define the next major GDSJam architecture and product roadmap: visually complete multiresolution rendering, hierarchy-aware reuse, renderer correctness, and independent physical-design analysis overlays.

## Decision Summary

GDSJam has substantially completed its original collaborative-viewer MVP. The next major investment should be a scalable physical-design visualization substrate rather than additional collaboration plumbing.

The recommended direction is a modern semantic chipmap with three representations:

1. Exact vector geometry at close zoom.
2. Dynamically generated coverage tiles at intermediate zoom.
3. A permanently available, spatially complete overview at whole-design zoom.

The renderer must always provide a complete coarse representation before progressively refining it. A polygon budget may limit refinement work, but it must not silently turn a layout into an arbitrary traversal-order subset.

This roadmap is inspired by Jeff Solomon's dissertation, *The Chipmap: Visualizing Large VLSI Physical Design Datasets*, especially Chapters 3-6:

- [Parsed Markdown](<../docs/0212_Solomon___Physical_Design_Datasets (1).md>)
- [Original PDF](<../docs/0212_Solomon___Physical_Design_Datasets (1).pdf>)

## Motivation

### Completed Foundation

The existing project already provides a strong base:

- Browser-based GDSII and DXF parsing.
- Pixi.js/WebGL layout rendering.
- Hierarchical cell and instance data model.
- Adaptive depth and polygon-budget LOD.
- Spatial tile batching and R-tree viewport culling.
- Layer visibility, minimap, measurements, and comments.
- WebRTC/Y.js collaboration with viewport and layer synchronization.
- Tauri desktop integration and file watching.
- Python/gdsfactory generation workflow.
- Parser support for BOUNDARY, PATH, SREF, and AREF use cases.
- Performance telemetry and unit-test infrastructure.

The original product concept--a collaborative, browser-accessible layout viewer--is therefore substantially implemented.

### Current Architectural Limitation

The current LOD implementation constrains memory by limiting recursion depth and stopping after a global polygon budget. Geometry is recursively transformed into world coordinates and batched into Pixi `Graphics`; viewport culling is applied after those graphics have been constructed.

This has four consequences:

1. **Incomplete overviews**: budget exhaustion can omit an arbitrary suffix of the hierarchy based on traversal order.
2. **Hierarchy expansion**: repeated cells are transformed and rendered for each occurrence instead of reusing canonical geometry or cached representations.
3. **Broad invalidation**: zoom, fill-mode, and some layer changes trigger large renderer rebuilds.
4. **Weak EDA semantics**: rendered spatial-index entries represent graphics batches, not selectable polygons, cell-instance paths, violations, or analysis features.

The central correctness requirement is:

> A coarse layout view may aggregate detail, but it must remain spatially complete, deterministic, and visually honest.

## Design Principles

1. **Completeness before sharpness**: display a complete coarse answer immediately, then refine it.
2. **Viewport-bounded work**: detailed rendering cost should scale primarily with the visible screen area.
3. **Preserve hierarchy**: avoid flattening the full instance tree into world-coordinate polygons.
4. **Separate representation from semantics**: raster tiles accelerate display; hierarchical geometry remains the source of truth for inspection and measurement.
5. **Independent overlays**: analysis layers must not invalidate the base layout cache unnecessarily.
6. **Explicit bounded caches**: CPU, GPU, and persistent caches require observable memory limits and eviction behavior.
7. **Accuracy is a metric**: FPS alone is insufficient if geometry is omitted or visually aliased.
8. **Progressive work must be cancellable**: obsolete viewport and document jobs must not commit stale results.
9. **One coordinate contract**: parser, renderer, measurement, tiling, overlays, and collaboration must share a tested DBU/world-unit model.
10. **Incremental adoption**: retain existing controls, overlays, and collaboration behavior while replacing the layout-rendering core behind stable interfaces.

## Proposed Architecture

### 1. Layout Scene Index

Introduce a hierarchy-aware scene index that owns:

- Cell-local geometry and bounds.
- Compact SREF and AREF representations.
- Cell-to-cell reference topology.
- Per-cell spatial indexes.
- Stable hierarchical object paths.
- Layer and datatype metadata.
- Unsupported and unresolved element diagnostics.

Viewport queries should traverse only instances whose transformed bounds intersect the requested world region. The scene index must not eagerly flatten every instance polygon.

Proposed module:

```text
src/lib/layout/LayoutSceneIndex.ts
```

### 2. Representation Selector

Select the appropriate rendering representation using:

- Projected minimum feature dimension in screen pixels.
- Estimated visible primitive count.
- Recent render and frame latency.
- Interaction state: pan, zoom, idle, measurement, or selection.
- Availability of exact or cached representations.

The three representation regions are:

| Region | Intended use | Representation |
|---|---|---|
| Vector | Close zoom and semantic interaction | Exact cell-local geometry with instance transforms |
| Dynamic tiles | Intermediate zoom | Coverage-aware raster or aggregate tiles |
| Static overview | Whole-design view | Pinned complete overview pyramid |

The vector/raster boundary must be perceptual and workload-aware, not simply a fixed hierarchy depth.

### 3. Tile Scheduler

The tile scheduler should:

- Convert the viewport into required multiresolution tile keys.
- Prioritize viewport-center tiles.
- Prefetch in the direction of navigation.
- Return cached parent tiles while finer tiles are pending.
- Cancel obsolete jobs using document and viewport generation IDs.
- Commit completed tiles atomically.
- Preserve the previous valid representation until a replacement is ready.

Proposed module:

```text
src/lib/renderer/tiles/TileScheduler.ts
```

### 4. Tile and Hierarchy Caches

Use separate bounded caches for:

- CPU-side tile or coverage data.
- GPU textures.
- Canonical per-cell vector buffers.
- Scale-bucketed repeated-cell representations.
- Optional IndexedDB or Tauri persistent artifacts.

Candidate tile key:

```text
designHash / representation / zoomLevel / tileX / tileY /
layerRevision / styleRevision / analysisRevision
```

Candidate hierarchy-cache ranking:

```text
estimatedBenefit = instanceCount * uncachedBuildCost / cachedBytes
```

LRU is the initial replacement policy. More complex spatial policies should only be considered if instrumentation shows a material benefit.

### 5. Worker Pipeline

Move parsing and tile generation off the browser UI thread:

- Transfer ownership of the input `ArrayBuffer` to a Web Worker.
- Decode records directly into compact cell-local structures when practical.
- Avoid materializing both a complete record array and a second object-heavy document graph.
- Generate independent tiles in workers using `OffscreenCanvas`, `ImageBitmap`, typed arrays, or an equivalent measured implementation.
- Send compact progress and diagnostic events to the UI.
- Reject stale results using generation IDs.

WebGPU should be evaluated only after profiling demonstrates a bottleneck that cannot be addressed cleanly with workers and the current WebGL/Pixi stack.

### 6. Analysis Overlay Engine

Introduce a generic overlay contract independent of base layout rendering:

```ts
interface AnalysisOverlay {
	id: string;
	source: OverlaySource;
	geometry?: OverlayGeometry;
	scalarGrid?: ScalarGrid;
	colorScale: ColorScale;
	opacity: number;
	minScreenSizePx?: number;
	zOrder: number;
	filter: OverlayFilter;
}
```

Initial overlay adapters:

1. Per-layer geometry coverage and density heatmap.
2. DRC markers imported from JSON or CSV.
3. Layout A/B XOR or change-density view.
4. Cell and floorplan region coloring.

Future adapters may include timing paths, clock skew, congestion, IR drop, thermal fields, and photonic simulation data, provided their coordinate and object mappings are explicit.

Sparse errors should support zoom-dependent minimum screen size. Exaggeration should decrease to zero at close zoom and be limited when marker density would destroy the spatial pattern.

### 7. Semantic Selection and Hierarchy Navigation

Add a semantic query path separate from the rendered-tile R-tree:

- Click and box selection.
- Stable polygon, cell, instance, and hierarchical-path identifiers.
- Hierarchy breadcrumbs and parent navigation.
- Isolate, ghost, and zoom-to-object actions.
- Select-by-layer, cell, property, or overlay feature.
- Comments anchored to object or analysis IDs in addition to XY coordinates.

Semantic indexes must remain hierarchical. Eagerly indexing every flattened instance polygon would recreate the existing memory problem.

## Implementation Roadmap

### Phase 0: Correctness and Benchmark Baseline

**Goal**: Establish trusted geometry, transform, and rendering measurements before architectural optimization.

- [ ] Define and document the DBU/world/screen coordinate contract.
- [ ] Replace separate rotation, mirror, scale, and translation accumulation with a tested affine-transform module.
- [ ] Preserve both AREF lattice-vector components and avoid eager AREF expansion.
- [ ] Audit supported and unsupported GDSII elements.
- [ ] Report unresolved references, unsupported elements, and truncated geometry.
- [ ] Add generated fixtures for nested transforms, reflected rotations, skewed arrays, non-default DBU, deep hierarchy, repeated cells, and multiple top cells.
- [ ] Compare parser output against gdstk or KLayout reference results.
- [ ] Add deterministic headless screenshots at fixed viewports and zoom levels.
- [ ] Add a slow reference rasterizer for small crops.

**Exit criteria**:

- Geometry bounds and representative transformed polygons match a trusted reference.
- Rendering output is deterministic regardless of cell or polygon record ordering.
- An incomplete render is never reported as complete.
- Baseline parse, first-view, pan/zoom, memory, and image-error metrics are recorded.

### Phase 1: Complete Overview and Viewport Tile Prototype

**Goal**: Prove complete-first progressive rendering without replacing the full renderer.

- [ ] Generate a complete whole-design coverage overview for one or more layers.
- [ ] Define world-anchored zoom levels and tile coordinates.
- [ ] Display a cached parent tile while a requested child tile is pending.
- [ ] Implement atomic tile swaps with no blank viewport.
- [ ] Benchmark 128, 256, and 512 physical-pixel tiles at DPR 1 and 2.
- [ ] Add padded tile borders and test for seams.
- [ ] Expose tile queue depth, cache hit rate, and refinement latency in development telemetry.

**Exit criteria**:

- Every full-design view is spatially complete.
- Arbitrary viewport jumps never produce a blank canvas.
- Memory remains bounded while navigating across the complete design.
- Tile edges remain visually continuous at fractional pan offsets.

### Phase 2: Worker Scheduling and Bounded Caches

**Goal**: Decouple interaction from tile generation and make resource use explicit.

- [ ] Add worker-based tile generation.
- [ ] Add document and viewport generation IDs.
- [ ] Cancel stale jobs after rapid pan, zoom, file reload, or layer changes.
- [ ] Implement CPU-side LRU tile cache.
- [ ] Implement explicit GPU texture budgeting and eviction.
- [ ] Prefetch neighboring tiles and tiles in the navigation direction.
- [ ] Keep a pinned static overview outside normal LRU eviction.

**Exit criteria**:

- Pan and zoom remain responsive while tiles are generated.
- Stale jobs cannot overwrite newer viewport or document state.
- Cache and GPU memory remain within configured bounds.
- Tile latency p50/p95 and time-to-sharp are measurable and stable.

### Phase 3: Hierarchy Reuse and Vector Detail

**Goal**: Remove the depth-3 ceiling and repeated-cell expansion.

- [ ] Preserve canonical cell-local geometry.
- [ ] Render close-zoom geometry using instance transforms rather than world-coordinate duplication.
- [ ] Add canonical per-cell vector-buffer cache.
- [ ] Add scale-bucketed repeated-cell coverage cache for intermediate zoom.
- [ ] Instrument cache build cost, bytes, instance count, and reuse count.
- [ ] Sweep cache size to find the empirical performance knee.
- [ ] Test rotated, mirrored, magnified, fractionally offset, nested, and arrayed instances.

**Exit criteria**:

- Deep hierarchy can be inspected without a hard global depth limit.
- Repeated-cell memory growth is substantially sublinear in expanded polygon count.
- Cached and uncached reference images agree within the defined error threshold.
- No false seams are introduced at repeated-cell boundaries.

### Phase 4: Physical-Design Analysis MVP

**Goal**: Deliver EDA value on top of the new display substrate.

- [ ] Define `AnalysisOverlay`, provenance, unit mapping, and serialization contracts.
- [ ] Implement per-layer coverage and density heatmaps.
- [ ] Import point, rectangle, polygon, and scalar-grid overlays from JSON or CSV.
- [ ] Add DRC-style marker exaggeration with zoom-dependent fade-out.
- [ ] Add legends, units, sequential/diverging color scales, and range filters.
- [ ] Add linked histogram-to-layout brushing.
- [ ] Keep overlay updates independent from base layout tile invalidation.
- [ ] Synchronize compact overlay configuration and filter state in collaborative sessions.

**Exit criteria**:

- Base layout tiles are reused when overlay visibility or filters change.
- Sparse errors remain visible at whole-design scale.
- Dense overlays preserve meaningful spatial patterns.
- At least 100,000 overlay features remain interactive on representative hardware.

### Phase 5: Semantic Inspection and Incremental Revision

**Goal**: Connect visualization to practical inspection and code-driven layout iteration.

- [ ] Add hierarchy-aware picking and stable object paths.
- [ ] Add hierarchy breadcrumbs, isolate, ghost, and zoom-to-object.
- [ ] Anchor comments to object or analysis IDs.
- [ ] Hash normalized cell geometry by design revision.
- [ ] Retain unchanged cell and tile caches after Python/gdsfactory regeneration.
- [ ] Invalidate only tiles affected by changed cells and instances.
- [ ] Evaluate a compact changed-cell manifest or cell-delta protocol.

**Exit criteria**:

- Users can identify a selected feature's cell and instance path.
- Comments remain anchored when stable object identities survive a revision.
- A localized layout change does not require reparsing and rerendering all unchanged display content.

## Benchmark Matrix

Maintain at least four representative designs:

| Fixture | Purpose |
|---|---|
| Dense flat Manhattan layout | Stress polygon count, coverage, and aliasing |
| Deep hierarchical design | Stress transform composition and viewport traversal |
| Highly repetitive photonic/cell array | Measure hierarchy-cache and instancing benefit |
| Synthetic subpixel line/gap patterns | Measure visual fidelity and sampling invariance |

Measure:

- Parse wall time and peak memory.
- Time to first complete overview.
- Time to first sharp viewport.
- Pan/zoom frame-time p50, p95, and p99.
- Tile-generation latency p50 and p95.
- CPU and GPU cache hit rates.
- Stale-job cancellation rate.
- Layer-toggle and overlay-filter latency.
- Memory after navigating across the full design.
- RMS/SSIM pixel error against the reference renderer.
- Per-layer coverage conservation.
- Narrow-line and narrow-gap visibility.
- Ordering invariance and tile/cell seam tests.

## Product Milestones

### Milestone A: Trusted Renderer

- Transform and unit correctness established.
- Unsupported and incomplete geometry is reported.
- Golden-image and performance baselines exist.

### Milestone B: Complete Progressive Navigation

- Static overview and dynamic tiles are operational.
- No blank or traversal-order-incomplete viewports.
- Worker scheduling and bounded caches are instrumented.

### Milestone C: Hierarchy-Scale Rendering

- Repeated cells reuse canonical geometry or cached representations.
- Deep layouts are navigable without the current hard depth ceiling.

### Milestone D: Physical-Design Analysis

- Density and DRC overlays are filterable and collaboration-aware.
- Semantic selection connects spatial views to hierarchical objects.

## Risks and Mitigations

### Visual Aliasing or Missing Narrow Features

**Risk**: Raster tiles may hide narrow lines or gaps at low zoom.

**Mitigation**:

- Use area or coverage-aware rasterization instead of point sampling.
- Compare against a slow reference renderer.
- Expose whether the current view is aggregate or exact during development.
- Keep exact vector geometry available at close zoom.

### Tile and Cell Seams

**Risk**: Independent rasterization can introduce false boundaries.

**Mitigation**:

- Use a world-anchored sampling grid.
- Add tile gutters or padded borders.
- Test fractional offsets, rotations, mirrors, and non-grid-aligned instances.

### Cache Invalidation Complexity

**Risk**: Layer, style, overlay, and design changes can invalidate excessive data or reuse stale data.

**Mitigation**:

- Use explicit revision components in cache keys.
- Separate base-layout, style, and analysis revisions.
- Add invariant tests for invalidation and stale-job rejection.

### Excessive Architectural Rewrite

**Risk**: Replacing parser, renderer, UI, and collaboration behavior simultaneously would create unacceptable regression risk.

**Mitigation**:

- Introduce the scene index and tile scheduler behind existing renderer APIs.
- Preserve current controls and overlay components during early phases.
- Ship the overview/tile prototype before committing to the complete architecture.

### Object-Heavy Browser Memory

**Risk**: Compact display tiles alone do not solve parser and semantic-index memory use.

**Mitigation**:

- Preserve AREF compactly.
- Prefer typed coordinate buffers and cell-local indexes.
- Transfer file buffers to workers.
- Measure peak memory separately for parse, scene index, CPU tiles, and GPU textures.

## Non-Goals for Initial Phases

- Full layout editing or polygon-level collaborative CRDT operations.
- Signoff-quality DRC, extraction, STA, or IR-drop engines.
- Immediate LEF/DEF/SPEF/Liberty database integration.
- Immediate migration from Pixi/WebGL to a custom WebGPU renderer.
- Server-side storage of proprietary analysis data by default.
- Eliminating exact vector rendering in favor of a raster-only viewer.

## Open Decisions

1. Which small and large GDS fixtures may be checked into the repository for deterministic benchmarks?
2. Should the first reference renderer use browser Canvas, a Node-side library, gdstk, or KLayout screenshots?
3. What are the initial acceptable image-error and coverage-conservation thresholds?
4. Should the first tile prototype use Pixi `RenderTexture`, `OffscreenCanvas`/`ImageBitmap`, or both for comparison?
5. What CPU and GPU memory budgets should be used for desktop, mobile, and Tauri profiles?
6. Which DRC or analysis interchange format should be the first supported adapter?
7. Which object identifiers can remain stable across Python/gdsfactory revisions?

## Recommended First Execution Slice

The first implementation slice should be narrow and measurable:

1. Create affine-transform, AREF, DBU, and golden-image fixtures.
2. Add explicit completeness and unsupported-geometry reporting.
3. Generate a complete whole-design coverage overview for one layer.
4. Implement parent-tile fallback for one dynamic zoom level.
5. Measure fidelity, memory, and interaction latency against the current renderer.
6. Prototype a per-layer density overlay using the same tile coordinate system.

This slice validates both the architecture and the first physical-design analysis workflow without prematurely committing to a complete renderer replacement.

## Progress Log

### 2026-08-05

- Reviewed the parsed Solomon dissertation, extracted figures, current repository architecture, DevLog history, and recent git history.
- Confirmed that the collaborative-viewer MVP is substantially complete.
- Identified traversal-order polygon truncation and repeated hierarchy expansion as the principal renderer limitations.
- Defined the semantic chipmap, hierarchy-reuse, correctness, worker, and analysis-overlay roadmap.
- No implementation work has started under this DevLog.
- Next: confirm Phase 0 fixtures, reference tools, and success thresholds before changing renderer behavior.
