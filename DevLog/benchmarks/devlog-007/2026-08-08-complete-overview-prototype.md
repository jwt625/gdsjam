# DevLog-007 complete-overview prototype benchmark

**Run date:** 2026-08-08

**Branch:** `feature/devlog-007-overview-prototype`

**Workload:** deterministic 8 × 8 compact AREF with four canonical rectangles on
four layers per placement: 256 logical polygon occurrences over a square
1,024 × 1,024 DBU scope. Each case has one unmeasured warm-up and five measured
runs.

## Outcome

The CPU/main-thread prototype generated a complete, conservative per-layer
coverage representation at all six requested physical-resolution/DPR cases.
At equal physical resolution, DPR changes the logical CSS size but correctly
does not materially change coverage bytes, occupied pixels, or runtime.

"Conservative" is literal: this is a spatial-completeness representation, not
an area-exact raster or a gdstk/reference-raster equivalence result. Any pixel
touched by a polygon boundary is retained, so coarse coverage may overstate area.

| Physical raster | DPR | Logical CSS edge | Median generation | Min–max | Coverage bytes |
|---:|---:|---:|---:|---:|---:|
| 128 × 128 | 1 | 128 px | 1.02 ms | 0.79–2.10 ms | 65,536 B |
| 128 × 128 | 2 | 64 px | 0.83 ms | 0.72–1.01 ms | 65,536 B |
| 256 × 256 | 1 | 256 px | 2.51 ms | 2.47–2.57 ms | 262,144 B |
| 256 × 256 | 2 | 128 px | 2.63 ms | 2.50–2.77 ms | 262,144 B |
| 512 × 512 | 1 | 512 px | 9.68 ms | 9.42–9.75 ms | 1,048,576 B |
| 512 × 512 | 2 | 256 px | 9.66 ms | 9.62–9.93 ms | 1,048,576 B |

Coverage storage is currently one byte per physical pixel per represented
layer. The measured byte counts therefore scale with `layers × width × height`;
they exclude Pixi `Graphics`, JavaScript object, scene-index, and GPU memory.

## Method and interpretation

- Node `v23.7.0`, Apple arm64, macOS.
- Timing uses `performance.now()` around the complete call, including compact
  scene-index construction, hierarchy traversal, conservative rasterization,
  layer ordering, and telemetry aggregation.
- The generator asserted `complete=true`, exactly 256 visited polygon
  occurrences, and the requested physical dimensions on every measured case.
- Coverage is binary per layer, so output is invariant to polygon/cell/root
  traversal order. Unit tests separately cover transformed hierarchy, selected
  versus all top-cell scope, layers, and sub-pixel narrow geometry.

## Limitations and next decision

- This is a deliberately small deterministic CPU prototype, not a large-GDS
  throughput claim. Runtime still scales with logical occurrences and candidate
  polygon/pixel intersections; it does not yet exploit cell coverage reuse.
- Generation runs synchronously on the main thread. It is feature-gated and is
  not suitable for unconditional production enablement before worker scheduling
  and cancellation land.
- The Pixi adapter uses run-length `Graphics` rectangles. Its commit/render cost
  is not included here and should be replaced or measured against texture upload
  in the tile prototype.
- Conservative boundary contact can occupy adjacent pixels. This intentionally
  prevents narrow geometry from disappearing, at the cost of controlled coarse
  over-coverage.
- Absolute-angle/absolute-magnification STRANS references are reported as
  incomplete by this prototype rather than falsely marked exact.

The 256-physical-pixel representation is the defensible starting point: four
layers cost 256 KiB and generated in about 2.6 ms for this workload. Keep 512 as
an opt-in benchmark point until Pixi upload/render and real-layout occurrence
scaling are measured.

## Reproduction and evidence

```sh
node scripts/devlog-007/benchmark_complete_overview.mjs
```

- Executable benchmark: `scripts/devlog-007/benchmark_complete_overview.mjs`
- Machine-readable raw samples:
  `artifacts/devlog-007/2026-08-08-complete-overview/overview-benchmark.json`

## Validation

- Vitest: 24 files, 165 tests passed.
- Svelte/TypeScript check: 0 errors and 0 warnings.
- Playwright with `VITE_ENABLE_COMPLETE_OVERVIEW=true`: 12/12 tests passed
  across desktop Chromium and emulated iPad; the real parser-to-Pixi path
  asserted ready/complete overview telemetry at the browser DPR.
- Production build: 2,219 modules transformed and completed successfully with
  the existing large-chunk advisory.
- Production test-API audit: 103 assets inspected; no E2E API markers shipped.
- Scoped Biome check: no errors; one pre-existing private callback warning in
  `PixiRenderer.ts` remains intentionally unchanged.
