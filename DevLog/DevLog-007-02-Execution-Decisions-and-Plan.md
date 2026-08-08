# DevLog-007-02: Execution Decisions and Multi-PR Plan

**Date**: 2026-08-08  
**Status**: Initial autonomous execution wave complete; milestones pushed and integration-validated through the gated overview prototype
**Base revision**: `b3bc996` on `main`  
**Related roadmaps**:

- [DevLog-007-00: Semantic Chipmap and Physical-Design Analysis Roadmap](DevLog-007-00-Semantic-Chipmap-and-EDA-Analysis-Roadmap.md)
- [DevLog-007-01: End-to-End Validation and Collaboration Testing Roadmap](DevLog-007-01-End-to-End-Validation-and-Collaboration-Testing.md)

## Objective

Turn the DevLog-007 roadmaps into a sequence of small, reviewable pull requests. The first execution window is **three hours of agent runtime** and prioritizes **renderer and parser correctness**. Its desired outcome is both:

1. A visible UI improvement, initially an honest incomplete/unsupported-geometry warning and diagnostics surface.
2. Reproducible benchmark numbers with saved logs.

The work should remain incremental. Large changes and features use a dedicated branch or worktree. Progress, decisions, evidence, benchmark summaries, and milestone commit SHAs are tracked in this document. Independent work may be delegated to subagents and run in parallel where file ownership and dependencies make that safe.

## Working Rules

- Optimize each change for a small, mergeable PR while planning several PRs ahead.
- Make milestone commits. Do not combine unrelated work in one commit.
- Provide only important milestone updates and otherwise operate autonomously.
- Source, test, CI, script, and documentation changes are authorized.
- Adding Node, Python, browser, Docker Compose, coturn, toxiproxy, and gdstk dependencies is authorized when required by the selected phase.
- The shipped product remains a web-only viewer. Correctness tools run offline during development/CI and must not become browser runtime dependencies or server-side requirements.
- Milestone branches may be pushed to the remote. Opening a pull request remains a separate explicit action.
- Preserve unrelated existing lint warnings and user changes.
- Record implementation decisions and benchmark results here as work proceeds.
- Save important command, test, benchmark, and diagnostic logs. Raw run artifacts should live under `artifacts/devlog-007/<run-id>/`; compact reviewed benchmark summaries should be committed under `DevLog/benchmarks/devlog-007/`.
- Use synthetic/public layouts for committed fixtures, screenshots, traces, and CI artifacts unless provenance is explicitly confirmed.

## Baseline Before DevLog-007 Implementation

Measured on 2026-08-08 at `b3bc996`:

| Check | Result |
|---|---|
| Vitest | 13 files, 109 tests passed |
| Type/Svelte check | Passed with 0 errors and 0 warnings |
| Production build | Passed; Vite transformed 2,207 modules in approximately 11 seconds |
| Biome | Exit 0; 78 pre-existing warnings and 1 informational diagnostic |
| Working tree | Clean before this decision document was added |

These are environment observations, not yet pinned performance baselines. Exact command output from subsequent execution runs will be saved under the artifact convention above.

## Accepted Product and Architecture Decisions

### Scope and delivery

1. **First priority**: correctness.
2. **Delivery shape**: small PRs arranged into a multi-PR program. Parallel subagent work is encouraged when tasks are independent.
3. **First execution budget**: three hours of agent runtime.
4. **First-run success**: visible UI improvement plus benchmark numbers, not only internal scaffolding.
5. **Documentation structure**: DevLog-007-00 remains the product/renderer roadmap, DevLog-007-01 remains the validation roadmap, and this document is the execution tracker.
6. **Planning horizon**: plan the first few phases in detail and extend the decomposition as far as evidence permits.
7. **Execution authority**: source, tests, CI, scripts, dependencies, and documentation may be changed without repeated approval when within this plan.
8. **Reference tooling**: Python/gdstk may be installed and invoked as the automated offline oracle. KLayout is not required, is not part of CI or the product, and may only be used as an optional one-off manual cross-check if already convenient.
9. **E2E/infrastructure tooling**: Playwright browsers, Docker Compose, coturn, and toxiproxy may be added when their phase begins.
10. **History**: create milestone commits.
11. **Isolation**: use a new branch or worktree for large changes/features; record branch/worktree and commit state here.
12. **Communication**: report important milestone boundaries only; otherwise proceed autonomously.
13. **Hygiene**: do not clean up unrelated lint warnings.
14. **Evidence**: keep this document current and save important raw logs plus reviewed summaries.

### Coordinate and unit contract

15. **Canonical geometry coordinates**: raw integer GDS database-unit counts.
16. **User-facing display unit**: micrometers (µm) for now.
17. **Overlay coordinates**: every imported overlay declares a unit and coordinate mapping; µm is the default only when the format omits a unit.
18. **Viewport and collaboration coordinates**: canonical world coordinates in DBU counts. UI boundaries convert to/from µm. This preserves current behavior and avoids participant drift caused by repeated physical-unit conversion.
19. **Non-default GDS units**:
    - A GDS `UNITS` record contains (a) the size of one DBU in user units and (b) the size of one DBU in meters.
    - The second value, meters per DBU, is the physical source of truth for geometry, measurement, viewport limits, overlays, and benchmarks.
    - User-unit size in meters is `metersPerDBU / dbuInUserUnits`.
    - A file is “non-default” when its DBU differs from the common 1 nm and/or its user unit differs from the common 1 µm. Neither is an error.
    - GDSJam keeps integer coordinates unchanged, preserves both declared values as metadata, and converts `coordinateDBU * metersPerDBU * 1e6` for µm display.
    - No renderer or tile constant may assume 1 DBU = 1 nm.
    - Invalid, zero, non-finite, or internally implausible unit declarations produce visible diagnostics rather than silent fallback. Any fallback must be explicit and recorded in document completeness.

  This follows the GDS `UNITS` definition and KLayout's integer-coordinate model. KLayout documents that a layout DBU is the physical size of one integer coordinate step and notes that 0.001 µm (1 nm) is typical, not mandatory:

  - [KLayout `Layout#dbu` documentation](https://www.klayout.de/doc-qt5/code/class_Layout.html)
  - [GDS `UNITS` record description](https://www.klayout.de/forum/uploads/editor/v2/k4lfi69nrv9k.pdf)
  - [KLayout GDS user-unit behavior](https://www.klayout.de/doc/code/class_SaveLayoutOptions.html)

20. **Integer preservation**: preserve integer DBU values for parsed coordinates and translations wherever possible. Matrix composition may use floating point for rotation or magnification; conversions must not round-trip through µm. Snap/round only at an explicitly documented output boundary.
21. **Orientation**: retain the current world origin and Y-up Cartesian contract consistently across parser, scene index, renderer, measurements, overlays, comments, minimap, and collaboration.
22. **Top-cell behavior**: one top cell is selected by default. A single-top design selects it automatically; a multiple-top design requires an explicit selection before detailed rendering. “Show all” is available as an explicit mode.
23. **Document bounds**: retain aggregate bounds for all top cells regardless of the selected rendering mode; also expose selected-view bounds separately.

### GDS semantics and diagnostics

24. **Core correctness scope**: BOUNDARY, PATH, SREF, and AREF are the first blocking geometry set.
25. **Additional elements**: add BOX and TEXT support. They may land after the blocking geometry set but must be represented semantically rather than silently discarded. NODE/TEXTNODE and other unsupported records receive diagnostics until deliberately implemented.
26. **Partial documents**: continue parsing usable content and mark the document incomplete when unsupported, malformed, unresolved, cyclic, or truncated content is encountered.
27. **User visibility**: incomplete or unsupported geometry produces a visible warning, backed by a detailed diagnostics view.
28. **Unresolved references**: preserve and render valid content; report unresolved references and mark completeness partial.
29. **Cyclic references**: tolerate the file, detect a repeated cell in the active traversal path, stop that branch deterministically, and emit a cycle diagnostic containing the hierarchical path. Do not rely only on an arbitrary global recursion depth.
30. **STRANS semantics**: parse and preserve reflection, absolute-magnification, and absolute-angle flags now. Include them in the affine oracle and composition rules during correctness work; silently ignoring them is incompatible with the trusted-renderer goal.
31. **PATH oracle**: matching gdstk is sufficient for initial PATH correctness.
32. **Migration strategy**: introduce a compact scene/geometry model and compatibility adapter rather than mutating all `GDSDocument` consumers simultaneously.

### Identity policy

Identity is important for deterministic digests, selection, comments, caching, and incremental revisions, but full cross-revision identity is **not a blocker for the first visible correctness PR**.

33. **Initial deterministic identity**:
    - Document identity: content hash plus parser/schema version.
    - Cell identity: document identity plus cell name initially.
    - Element identity: cell identity plus element kind and deterministic source-record ordinal.
    - Instance identity: parent hierarchical path plus deterministic reference ordinal.
    - Render/diagnostic identity: derived from semantic identities; never a random UUID.
34. **Reordering stability**: not guaranteed in the initial slice. A later normalized-geometry identity can make unchanged cells stable across generator record reordering.
35. **Edit stability**: initial IDs remain stable only when the relevant binary structure and ordinal remain stable. Cross-revision identity based on normalized cell hashes is deferred to incremental-revision work.
36. **Source metadata**: do not assume gdsfactory source identity exists in binary GDS. Accept explicit source manifests later when available.
37. **Duplicate elements**: geometrically identical elements remain distinct semantic objects because record occurrence can matter for selection and provenance.
38. **Comments across revisions**: the initial design must not preclude stable anchoring, but migration/re-anchoring is not part of the first three-hour slice.

## Completeness Contract: Initial Direction

The implementation should distinguish at least:

```text
pending
complete
partial-unsupported
partial-unresolved
partial-cycle
partial-budget
failed
```

“Complete” is relative to the selected top-cell mode and visible/supported element contract. Document-level diagnostics remain available even when the selected visible representation is complete. A budget-limited traversal must never emit `complete` or the message “Render complete.”

## Multi-PR Execution Plan

The PR boundaries may be adjusted when implementation evidence shows tighter coupling. Each PR must keep existing tests/check/build green and save its relevant benchmark or diagnostic evidence.

### PR 1 — Coordinate, affine, and oracle foundation

**Goal**: establish trusted mathematical primitives without switching production rendering.

- Add a documented `CoordinateSpace`/unit contract.
- Correct misleading unit type comments and remove 1 nm assumptions from new APIs.
- Add a small affine-transform module covering translation, rotation, reflection, magnification, composition, and STRANS absolute flags.
- Add a compact AREF lattice type with both complete vectors.
- Add generated gdstk fixtures for non-default DBU, reflected/rotated SREF, skewed AREF, and multiple top cells.
- Commit inspectable generator sources and semantic oracle JSON.
- Add deterministic unit/property tests and a benchmark harness for parse/oracle timing.

**Exit evidence**:

- gdstk and GDSJam agree on fixture bounds and representative transformed vertices.
- Skewed arrays retain both lattice-vector components without eager expansion in the new model.
- Unit conversion tests include at least 1 nm, 5 nm, and sub-nm DBUs.
- Raw logs and a reviewed benchmark summary are saved.

### PR 2 — Parser diagnostics, completeness, and visible warning

**Goal**: make the current UI honest about incomplete geometry.

- Add structured parse and render diagnostics.
- Track supported, unsupported, malformed, unresolved, cyclic, and budget-truncated content.
- Expose structured completeness through the renderer/viewer boundary.
- Replace unconditional “Render complete” behavior.
- Add a visible warning with a concise summary and expandable details.
- Add deterministic diagnostic tests for damaged/unsupported/unresolved fixtures.
- Capture before/after screenshots and parse/render benchmark numbers.

**Exit evidence**:

- Budget exhaustion and unsupported geometry cannot be reported as complete.
- A user can see why a view is partial.
- Valid geometry remains usable for partial documents.
- This PR supplies the first required visible UI improvement.

### PR 3 — Compact scene index and top-cell selection

**Goal**: establish the compatibility boundary needed for hierarchy-aware rendering.

- Add a hierarchy-preserving layout scene index.
- Preserve canonical cell-local geometry and compact SREF/AREF records.
- Add per-cell bounds/reference topology and deterministic initial semantic IDs.
- Detect cycles and unresolved references during topology construction.
- Add single-top automatic selection, multiple-top selection UI, and explicit “Show all.”
- Retain aggregate document bounds plus selected-view bounds.
- Keep the existing renderer operational through an adapter.

**Exit evidence**:

- Multiple-top behavior is explicit and deterministic.
- AREF-heavy parse/index memory is measured against eager expansion.
- Existing measurement, minimap, comments, and collaboration behavior remains intact.

### PR 4 — Testability API and Playwright smoke layer

**Goal**: make viewer correctness reproducible in a real browser.

- Add Playwright with Chromium desktop and one emulated tablet project unless the remaining decisions change the matrix.
- Add an E2E-only `window.__GDSJAM_TEST__` API.
- Support fixture injection, world-bounds viewport control, render-idle waiting, completeness, diagnostics, and semantic digest retrieval.
- Add explicit lifecycle events and critical test IDs.
- Add one deterministic layout tour and one incomplete-document warning test.
- Store trace, screenshot, console, digest, and timing artifacts on failure.

**Exit evidence**:

- Tests use readiness/convergence signals rather than sleeps.
- Production builds do not expose the test API.
- The visible warning and exact viewport behavior are browser-tested.

### PR 5 — Complete overview prototype

**Goal**: prove complete-first rendering before replacing the current renderer.

- Generate a complete world-anchored coverage overview behind a feature flag.
- Begin on the main thread for coordinate/fidelity validation.
- Retain the previous valid representation until the overview is ready.
- Measure 128/256/512 physical-pixel candidates at DPR 1 and 2.
- Compare coverage and missing geometry against the reference rasterizer.
- Expose overview readiness, completeness, generation time, and memory telemetry.

**Exit evidence**:

- Whole-design overview is spatially complete for the supported contract.
- No blank viewport occurs during the prototype transition.
- Fidelity and performance results determine the later worker/tile backend.

### Later parallel tracks

After PR 1 establishes shared contracts, the following can proceed in parallel using separate worktrees and non-overlapping ownership:

| Track | Depends on | Primary files/scope |
|---|---|---|
| Diagnostics/UI | PR 1 contracts | stores, viewer components, parser diagnostic adapters |
| Playwright harness | stable test API types from PR 2/3 | `e2e/`, Vite test configuration, CI |
| Scene index | PR 1 affine/AREF types | `src/lib/layout/`, parser adapter, semantic tests |
| Reference raster/benchmarks | PR 1 fixtures | fixture scripts, oracle tools, benchmark scripts |
| Collaboration harness | PR 4 lifecycle API | `e2e/collaboration/`, local Compose topology |

Subagents should not concurrently edit the same central parser/renderer files. Integration and milestone commits remain the responsibility of the primary execution agent.

## First Three-Hour Run: Proposed Timebox

This is the default run plan pending the 15 remaining answers.

| Time | Work | Intended evidence |
|---|---|---|
| 0:00–0:20 | Create feature branch/worktree, artifact directory, baseline script, and execution checklist | Saved baseline logs and run metadata |
| 0:20–1:10 | Coordinate/unit contract and affine-transform module with tests | Exact unit and transform test results |
| 0:30–1:20, parallel | gdstk fixture generator and semantic oracle output | Synthetic `.gds`, source, reviewed JSON |
| 1:10–2:00 | Compact AREF semantics and parser/adapter tests | Skew-array comparison and memory/count measurements |
| 1:20–2:20, parallel | Completeness/diagnostic model and warning UI spike | Visible partial-render warning screenshot |
| 2:20–2:45 | Integration, regression tests, check, build, targeted benchmark | Raw logs plus benchmark JSON/Markdown |
| 2:45–3:00 | Milestone commit(s), update this tracker, concise handoff | Commit SHAs, completed/pending checklist, risks |

This is intentionally ambitious. If integration pressure arises, mathematical correctness and honest completeness take precedence; the UI may be a narrow but production-quality warning rather than a full diagnostics panel.

## Progress Tracker

### Decisions and setup

- [x] Read and reconcile DevLog-007-00 and DevLog-007-01.
- [x] Record decisions 1–38 and resolve delegated technical choices.
- [x] Establish initial unit interpretation from GDS/KLayout documentation.
- [x] Answer the remaining 15 execution gates.
- [x] Select/create implementation branch or worktree: `feature/devlog-007-correctness-foundation`.
- [x] Create run ID and artifact directory: `2026-08-08-correctness-foundation`.

### PR 1

- [x] Coordinate contract implemented and tested.
- [x] Affine module implemented, used by parser/renderer transforms, and tested.
- [x] Full-vector AREF semantics represented and tested; legacy adapter still expands instances.
- [x] gdstk fixtures and semantic oracle generated and staged for the milestone commit.
- [x] Parse/oracle and validation benchmarks captured.
- [x] Milestone implementation commit recorded: `dcda478`.

### PR 2

- [x] Structured budget, hierarchy-depth, reference, cycle, unsupported-ready, and failure diagnostics implemented.
- [x] Visible expandable warning implemented.
- [x] Diagnostic fixtures and tests added.
- [x] Synthetic screenshot and load-to-warning evidence captured.
- [x] Milestone implementation commit recorded: `dcda478` (combined PR 1/PR 2 vertical slice).

### PR 3+

- [x] Compact scene index, explicit top-cell selection, scoped renderer/minimap, and selected/aggregate bounds implemented and pushed.
- [x] Playwright testability/browser-smoke foundation implemented and pushed.
- [x] Parser diagnostics with BOX/TEXT semantics implemented and pushed.
- [x] Parallel branches composed on an integration branch and validated together.
- [x] High-repetition scene-index compactness and browser-visible parser diagnostics measured.
- [x] Complete-overview and slow reference-raster prototypes implemented, pushed, and integration-validated.

### Active branches and milestone commits

| Branch | Milestone commits | State |
|---|---|---|
| `feature/devlog-007-correctness-foundation` | `dcda478`, `bf31dcc`, `e96f47b` | Pushed; visible warning, geometry/unit foundation, fixtures, and baseline evidence |
| `feature/devlog-007-parser-diagnostics` | `0452f45` | Pushed; typed parser diagnostics, BOX polygons, TEXT origin markers |
| `feature/devlog-007-scene-index` | `473da91`, `98ad6c6` | Pushed; compact hierarchy index and memoized construction |
| `feature/devlog-007-playwright` | `23bff59`, `c7b8b1b` | Pushed; gated browser API and deterministic desktop/iPad tests |
| `feature/devlog-007-integration` | `0e0663c` through `84f14b5` | Pushed; all completed slices composed and validated together |
| `feature/devlog-007-top-cell-ui` | `3de89ac`, `da966d6` | Pushed; explicit multi-top selection and stale-document protection |
| `feature/devlog-007-scene-benchmarks` | `c1930b0` | Pushed; 100,000-placement compactness benchmark and evidence |
| `feature/devlog-007-parser-e2e` | `1ceec99` | Pushed; browser-visible unit diagnostics and semantic BOX/TEXT digest |
| `feature/devlog-007-overview-prototype` | `111f218` | Pushed; gated conservative complete-overview prototype and benchmark |
| `feature/devlog-007-reference-raster` | `126c976` | Pushed; exact discrete slow raster oracle and evidence |

No pull requests have been opened. The stacked integration branch is validation evidence, not a replacement for the small review branches.

### Combined validation at `84f14b5`

| Check | Result |
|---|---|
| Vitest | 25 files, 171 tests passed |
| Type/Svelte check | 0 errors, 0 warnings |
| Production build | Passed; 2,219 modules transformed in approximately 10.8 seconds |
| Playwright | 12/12 passed across desktop Chromium and emulated iPad |
| Production test-API audit | 103 emitted HTML/JS/CSS assets checked; zero gated E2E markers |

Integration found one contract bug not visible in either isolated branch: parser diagnostics traversed the legacy expanded AREF instances, so one unresolved AREF could be reported once per placement. Diagnostics now traverse compact source references when present; a 3 × 2 unresolved AREF is asserted as six compatibility instances, one source reference, and one diagnostic.

Primary review found a second cross-lifecycle issue before the top-cell branch was pushed: clearing an unselected multi-top canvas left the previous document inside `PixiRenderer`, allowing a fill/LOD action to resurrect stale geometry. `unloadDocument()` now clears graphics/spatial state and nulls the document and render scope; a regression test covers the transition.

### High-repetition scene-index evidence

The committed benchmark uses 21 isolated Node processes across three scenarios for a synthetic 1,000 × 100 AREF (100,000 logical placements):

| Scenario | Median scene-index time | Median incremental index heap | Scene references |
|---|---:|---:|---:|
| Legacy expanded only | 164.48 ms | 39,345,912 B | 100,000 |
| Current compatibility document | 6.83 ms | 35,224 B | 1 |
| Compact canonical document | 6.52 ms | 35,224 B | 1 |

The deterministic source-representation JSON proxy is 16,708,205 B expanded versus 293 B compact, a 57,025× ratio. This is evidence for the compact scene-index boundary, **not** a parser-memory win: the current compatibility document still retains 100,000 legacy instances and measured 18,413,736 B of retained heap. Removing that adapter requires renderer migration.

### Complete-overview prototype evidence

The feature-gated prototype (`VITE_ENABLE_COMPLETE_OVERVIEW=true`) produces conservative binary coverage masks per layer from the compact scene hierarchy. It visits every selected, resolvable polygon occurrence without a polygon budget and commits a Pixi representation only after a complete artifact is ready. Failed or incomplete output cannot replace a valid same-scope artifact, and stale artifacts from another document/scope are discarded. The vector renderer remains the production default.

The benchmark workload is an 8 × 8 compact AREF with four canonical polygons/layers per placement: 256 logical polygon occurrences over a 1,024 × 1,024 DBU scope.

| Physical raster | DPR | Median generation | Coverage bytes |
|---:|---:|---:|---:|
| 128 × 128 | 1 / 2 | 1.02 / 0.83 ms | 65,536 B |
| 256 × 256 | 1 / 2 | 2.51 / 2.63 ms | 262,144 B |
| 512 × 512 | 1 / 2 | 9.68 / 9.66 ms | 1,048,576 B |

These numbers include scene-index construction, hierarchy traversal, conservative rasterization, ordering, and telemetry, but exclude Pixi conversion/render cost, GPU memory, and large-layout scaling. Conservative means any pixel touched by polygon area or boundary remains occupied; this is spatial-completeness evidence, not area-exact equivalence.

### Reference-raster evidence

The slow TypeScript oracle uses exact BigInt rational pixel-center tests, even-odd fill, boundary inclusion, integer DBU crops, Y-up world coordinates, and deterministic raw masks. Its 32 × 16 synthetic evidence fixture contains five polygons on three layer/datatype masks:

- Combined union: 252 covered pixels.
- Conserved polygon coverage: 297 samples, including overlap.
- Runtime: approximately 0.147–0.155 ms per raster across 250 repeats.
- Committed raw-mask JSON SHA-256: `d04c2f72fe911fc21f9cb5318fbebbf0fac275d6a7ce7d2f1ca3d801f69bdd8f`.

This oracle is deliberately separate from browser/GPU antialiasing. It supports exact discrete-mask comparisons for small filled-polygon crops; hierarchy flattening, PATH conversion, TEXT, fractional-area coverage, and screenshot tolerance remain outside its current contract.

## Next execution priorities

1. Move overview generation off the main thread and add document/viewport generation IDs plus cancellation before considering default enablement.
2. Replace run-length Pixi `Graphics` conversion with a measured texture path and benchmark upload/render cost, blank-frame count, and 128/256/512 candidates on representative layouts.
3. Add world-anchored dynamic tile keys, parent fallback, padded borders, and atomic child swaps.
4. Migrate exact rendering onto compact scene references so the parser can stop retaining eagerly expanded AREF compatibility instances.
5. Implement or formally resolve absolute-angle/absolute-magnification STRANS composition; the overview currently marks those scopes incomplete.
6. Define browser antialiasing/golden-image tolerance against the exact reference raster, then add fixed-viewport goldens.
7. Decide whether top-cell render scope should be collaboration-synchronized; it is intentionally local viewer state today.

## Resolved Execution Gates

All 15 final gates were resolved on 2026-08-08. Defaults were accepted except where noted:

1. Use newly generated synthetic fixtures until existing-file provenance is confirmed.
2. The first run may span PR 1 and the narrow visible-warning portion of PR 2, with separate branches/commits where appropriate.
3. Multi-top files use a blocking top-cell selector with an explicit “Show all” option.
4. BOX renders as filled/outlined layer geometry while retaining BOX semantics.
5. TEXT initially exposes semantic markers/bounds and content; glyph rendering is deferred.
6. Missing/invalid `UNITS` requires user confirmation, prefilled with 1 nm, rather than a silent assumption.
7. Small generated GDS fixtures and reviewed oracle JSON are committed directly to Git.
8. **Exception**: KLayout is unnecessary for the planned automated path. The product stays web-only; gdstk generates the blocking offline oracle. KLayout is at most an optional manual independent cross-check and will not be installed merely for this work.
9. Raster thresholds are derived empirically on pinned Chromium and tightened after measuring antialiasing variance.
10. Playwright/test-API work starts after the coordinate/completeness contracts, then may run concurrently with scene-index work.
11. The initial browser matrix is Chromium desktop plus emulated iPad; Firefox/WebKit follow later.
12. Routine collaboration tests are hermetic/local and must not use production services.
13. Initial cache hypotheses are 256 MB CPU plus 256 MB GPU on desktop and 96 MB combined on mobile.
14. Initial scale tiers are small synthetic correctness, approximately 10 MB public integration, and generated high-repetition stress, without premature hard latency gates.
15. **Exception**: local milestone commits and pushes to remote feature branches are authorized. Opening pull requests is not implied and remains an explicit action.

## Decision Log

### 2026-08-08

- Selected correctness as the first investment.
- Set a three-hour initial agent runtime budget with visible UI and benchmark deliverables.
- Chose raw integer DBU coordinates, µm display, and explicit overlay unit mappings.
- Defined non-default unit behavior using meters per DBU as physical truth.
- Selected partial parsing with visible diagnostics for unsupported, unresolved, cyclic, malformed, and truncated content.
- Added BOX and TEXT to the planned semantic model.
- Chose a compact scene model plus compatibility adapter.
- Scoped deterministic IDs now and stronger cross-revision identity later.
- Decomposed work into five initial PRs and identified parallel tracks.
- Reduced remaining clarification to 15 execution gates.
- Accepted defaults for all 15 gates, removed KLayout from the required toolchain, reaffirmed a browser-only shipped product, and authorized pushing remote milestone branches.
- Created `feature/devlog-007-correctness-foundation` and delegated fixture/oracle, diagnostics/UI, and benchmark/evidence tracks to three subagents with non-overlapping ownership.
- Fixed GDS `UNITS` decoding: the parser had expected an array although the library emits `{ userUnit, metersPerUnit }`, causing silent fallback to 1 nm/1 µm defaults.
- Added a tested affine module and moved production parser bounds plus renderer polygon/nested-instance transforms onto it.
- Preserved both AREF vector components and fixed skewed-array expansion in the legacy adapter. gdstk confirms endpoint displacement divides by column/row count, not count minus one.
- Added four deterministic synthetic GDS/oracle pairs and expanded validation from 109 to 133 tests.
- Added explicit budget and hierarchy-depth truncation signals, unresolved-reference/cycle checks, and an expandable partial-render warning.
- Browser-validated the warning with a public 5 nm-DBU synthetic fixture: 1,496.4 ms to warning at 1440 × 900, zero console errors.
- Saved before/milestone logs, machine-readable reports, screenshot evidence, and reviewed benchmark summaries.
- Created milestone implementation commit `dcda478` (`feat(renderer): establish geometry correctness diagnostics`).
- Added typed parser diagnostics for missing/invalid units, malformed geometry, unsupported NODE/TEXTNODE records, unresolved references, and bounded cycle paths. BOX is retained as renderable polygon geometry with provenance; TEXT is retained as content plus an origin marker, not fabricated glyph bounds.
- Added a compact hierarchy-preserving scene index. Parsed AREFs remain one source reference while the existing renderer continues to receive an expanded compatibility adapter. Shared-subtree bounds are memoized, topology diagnostics remain deterministic, and identity hashing streams geometry rather than serializing a second geometry-sized string.
- Added a compile-time-gated browser test API and six Playwright tests across desktop Chromium and emulated iPad. Production builds are audited for test-API markers.
- Rebased and pushed the parser, scene-index, and Playwright milestone branches on the latest correctness foundation.
- Composed all parallel branches on `feature/devlog-007-integration`; 150 tests, checks, build, browser tests, and the production API audit passed together.
- Corrected integration behavior so unresolved/cycle diagnostics traverse compact source references instead of multiplying one AREF problem across every legacy-expanded placement.
- Started a second parallel wave for explicit top-cell UI, high-repetition scene-index benchmarks, and browser-visible parser diagnostics.
- Added explicit multi-top selection with “Show all,” selected/aggregate bounds, renderer root scoping, and a scoped minimap. Single-top files remain automatic.
- Added browser proof that missing/invalid units show `partial-malformed` plus provisional-scale wording and that BOX/TEXT semantic markers survive into a deterministic digest.
- Measured the compact scene-index boundary at 100,000 logical placements. One compact AREF cuts index construction from a 100,000-reference traversal to one reference, while confirming that eager parser compatibility instances remain the dominant memory debt.
- Fixed stale renderer state discovered during top-cell review so an unloaded render scope cannot resurrect the prior document.
- Composed the full second wave at `c5e0f88`; 156 unit tests and 12 desktop/tablet browser tests passed together.
- Started isolated complete-overview and slow reference-raster prototype tracks for the next renderer phase.
- Added an exact discrete reference raster for small integer-DBU crops with per-layer masks and overlap conservation.
- Added a default-off complete-overview prototype that builds conservative per-layer coverage before atomic Pixi replacement and rejects incomplete, unsupported, or stale-scope artifacts.
- Benchmarked physical overview resolutions at DPR 1 and 2; selected 256 physical pixels as the current prototype starting point, subject to Pixi/GPU and large-layout measurements.
- Composed the third wave at `84f14b5`; 171 unit tests, 12 browser tests, checks, build, and production test-API audit passed together.
- Closed the initial autonomous execution wave with all milestone and integration branches pushed and no pull requests opened.
