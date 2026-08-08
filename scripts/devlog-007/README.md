# DevLog-007 baseline harness

Run the browser-free correctness baseline from the repository root:

```sh
python3 scripts/devlog-007/collect_baseline.py
```

This records environment metadata, hashes and scans each `tests/gds/*.gds`
fixture, captures source-level renderer contract facts, and times the existing
Vitest, type/Svelte check, and production build commands. Raw logs and generated
reports go to `artifacts/devlog-007/2026-08-08-correctness-foundation/`.

For a fast fixture/source inventory without validation commands:

```sh
python3 scripts/devlog-007/collect_baseline.py --inventory-only
```

The script has no third-party Python dependencies. Fixture counts are direct GDS
record counts, not flattened hierarchy or visible-polygon counts.

Measure compact scene-index behavior against a deterministic 100,000-placement
synthetic AREF:

```sh
node scripts/devlog-007/benchmark_scene_index.mjs
```

The benchmark launches each repeat in a fresh Node process with forced garbage
collection. It compares a legacy-only expanded document, the current parser's
compatibility shape (expanded instances plus one compact source AREF), and a
future compact-canonical document. Results are written to
`artifacts/devlog-007/2026-08-08-scene-index/scene-index-benchmark.json`.

Capture the visible partial-render warning against the public synthetic fixture
with a deliberately small polygon budget:

```sh
VITE_MAX_POLYGONS_PER_RENDER=1 pnpm dev --host 127.0.0.1
node scripts/devlog-007/capture_diagnostics.mjs
```

The capture uses the project's existing Puppeteer development dependency and
writes a screenshot plus machine-readable evidence into the same artifact run.
