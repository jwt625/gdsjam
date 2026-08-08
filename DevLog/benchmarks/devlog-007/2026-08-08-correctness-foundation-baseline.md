# DevLog-007 correctness-foundation baseline

**Run date:** 2026-08-08  
**Revision:** `b3bc9963d9baac95988b1f50c2bfa8e24bde7e93`  
**Branch:** `feature/devlog-007-correctness-foundation`  
**Environment:** Apple arm64, macOS 15.5, Node 23.7.0, pnpm 10.12.4

## Validation timing

These are single-run wall-clock measurements, useful as a local baseline rather
than a regression gate. Repeat samples and pinned CI hardware are required before
setting performance thresholds.

| Command | Result | Wall time | Reviewed output |
|---|---|---:|---|
| `pnpm test -- --run` | 13 files / 109 tests passed | 1.531 s | Vitest duration 949 ms |
| `pnpm check` | 0 errors / 0 warnings | 2.387 s | Svelte and TypeScript checks passed |
| `pnpm build` | 2,207 modules transformed | 10.942 s | Vite reported build in 10.50 s |

## GDS fixture inventory

The harness scans binary record headers without loading a browser or expanding
hierarchy. Counts therefore describe source semantic records, not rendered
polygons. Each file scanned to its exact end with no invalid/truncated record.

| Fixture | Size | Structures | BOUNDARY | PATH | SREF | AREF | Source elements |
|---|---:|---:|---:|---:|---:|---:|---:|
| `PIC_example_20251213.gds` | 269,056 B | 186 | 416 | 0 | 702 | 0 | 1,118 |
| `TLS08C_20220725.gds` | 10,091,426 B | 1 | 61,443 | 80,152 | 0 | 0 | 141,595 |
| `ring_modulator_pin.gds` | 24,706 B | 16 | 18 | 0 | 30 | 3 | 51 |

All three fixtures declare 1 nm per DBU (`1e-9 m`) and 1 µm per user unit.
Their SHA-256 digests are recorded in the machine-readable report.

## Correctness-relevant before-state

- The configured default render budget is 100,000 polygons.
- `GDSRenderer` has a budget-exhaustion branch but `RenderResult` has no
  structured completeness field.
- `GDSRenderer` still contains a `Render complete` diagnostic independent of a
  structured completeness result.
- The 10.1 MB TLS fixture contains 141,595 BOUNDARY/PATH source records. Because
  each supported PATH is converted to polygon geometry, this fixture provides a
  concrete workload that can exceed the default budget even before hierarchy
  expansion. This is an inference from record counts and the current parser, not
  a browser-observed visible-polygon count.

## Evidence and reproduction

- Generated report: `artifacts/devlog-007/2026-08-08-correctness-foundation/baseline.md`
- Machine-readable data: `artifacts/devlog-007/2026-08-08-correctness-foundation/baseline.json`
- Raw logs: `test.log`, `check.log`, and `build.log` in the same artifact directory
- Harness: `python3 scripts/devlog-007/collect_baseline.py`

The harness uses only the Python standard library. It records exact commands,
tool versions, fixture hashes, scan errors, declared GDS units, source contract
facts, exit codes, and wall times.
