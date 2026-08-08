# DevLog-007 compact scene-index benchmark

**Run date:** 2026-08-08

**Branch:** `feature/devlog-007-scene-benchmarks`

**Workload:** deterministic 1,000 × 100 AREF, 100,000 logical placements, one leaf polygon

## Outcome

The scene index preserves the synthetic 100,000-placement AREF as one reference
when the document provides its compact source record. On this local run, that
reduced median index construction from 164.48 ms to 6.83 ms versus adapting the
100,000 legacy instances, and reduced incremental retained V8 heap from 39.35 MB
to 36.46 kB.

This is an **index/representation result, not a parser-memory result**. The
current parser-compatible document still retains all 100,000 expanded legacy
instances alongside the compact source AREF. Consequently, its document heap
was still 18.42 MB even though the index itself held one reference.

| Scenario | Legacy instances | Compact source refs | Index refs | Document build median | Index build median | Document heap delta median | Index heap delta median | Source JSON bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Legacy expanded | 100,000 | 0 | 100,000 | 10.59 ms | 164.48 ms | 18,412,104 B | 39,345,912 B | 16,708,205 B |
| Current compatibility | 100,000 | 1 | 1 | 9.67 ms | 6.83 ms | 18,413,736 B | 35,224 B | 16,708,482 B |
| Compact canonical | 0 | 1 | 1 | 0.12 ms | 6.52 ms | Below noise (−8,048 B) | 35,224 B | 293 B |

The deterministic serialized representation proxy is 57,025× smaller for the
compact-canonical source than for the legacy-expanded source. This ratio is
inspectable and repeatable, but JSON is not an estimate of JavaScript object
layout. The retained-heap measurements better reflect this Node runtime, while
remaining sensitive to V8 allocation and garbage-collection behavior.

## Method

- Seven repeats per scenario, each in a fresh Node/Vite process.
- Node `v23.7.0`, Apple arm64, macOS.
- Three forced garbage-collection requests before every retained `heapUsed`
  sample.
- Wall-clock construction timings use `performance.now()` and report median,
  minimum, and maximum in the machine-readable artifact.
- The workload and expected aggregate bounds `(0, 0)–(19,990, 2,980)` are
  asserted on every run.
- The legacy scenario exercises the scene index's compatibility fallback. The
  current-compatibility scenario retains eager expansion in the document but
  proves the index prefers its one compact source record. The compact-canonical
  scenario represents the deferred parser migration after legacy expansion can
  be removed.

## Limitations

- These are programmatically constructed documents, not GDS parse timings.
- `heapUsed` is retained Node/V8 heap after forced GC, not peak browser memory,
  RSS, GPU memory, or native parser allocation.
- Small compact allocations are below runtime noise: the compact document's
  median delta was −8,048 B with a −14,352–4,448 B range. That is not "negative
  memory"; it means this process-level subtraction cannot resolve the allocation.
  Use the deterministic byte proxy and order of magnitude, not byte-exact compact
  heap deltas, for decisions.
- The scene index currently coexists with the legacy renderer adapter; only a
  future migration can realize the compact-canonical document-memory result.

## Reproduction and evidence

```sh
node scripts/devlog-007/benchmark_scene_index.mjs
```

- Executable benchmark: `scripts/devlog-007/benchmark_scene_index.mjs`
- Machine-readable report with all 21 raw runs:
  `artifacts/devlog-007/2026-08-08-scene-index/scene-index-benchmark.json`

## Validation

- Benchmark: 21/21 isolated runs passed count and aggregate-bounds invariants.
- Vitest: 21 files, 150 tests passed.
- Svelte/TypeScript check: 0 errors and 0 warnings.
- Production build: 2,213 modules transformed; completed successfully with the
  existing large-chunk advisory.
- Biome: benchmark script passes formatting and static checks.
