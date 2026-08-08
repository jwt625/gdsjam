# DevLog-007 correctness-foundation baseline

Collected: `2026-08-08T18:38:01.256267+00:00`
Revision: `b3bc9963d9baac95988b1f50c2bfa8e24bde7e93` on `feature/devlog-007-correctness-foundation`

## Existing validation

| Check | Exit | Wall time | Raw log |
|---|---:|---:|---|
| test | 0 | 1.521 s | `artifacts/devlog-007/2026-08-08-correctness-milestone-1/test.log` |
| check | 0 | 2.408 s | `artifacts/devlog-007/2026-08-08-correctness-milestone-1/check.log` |
| build | 0 | 10.910 s | `artifacts/devlog-007/2026-08-08-correctness-milestone-1/build.log` |

## Fixture inventory

Counts below come from a strict, dependency-free scan of GDS record headers; they are not expanded hierarchy counts.

| Fixture | Bytes | Structures | Boundaries | Paths | SREFs | AREFs | Other elements | DBU |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `tests/gds/PIC_example_20251213.gds` | 269,056 | 186 | 416 | 0 | 702 | 0 | 0 | 1e-09 m |
| `tests/gds/TLS08C_20220725.gds` | 10,091,426 | 1 | 61,443 | 80,152 | 0 | 0 | 0 | 1e-09 m |
| `tests/gds/ring_modulator_pin.gds` | 24,706 | 16 | 18 | 0 | 30 | 3 | 0 | 1e-09 m |

## Baseline renderer contract

- Default polygon budget: `100,000`.
- Budget-exhaustion branch present: `true`.
- Explicit budget signal in `RenderResult`: `true`.
- Explicit hierarchy-depth signal in `RenderResult`: `true`.
- `Render complete` log present: `true`.

These source facts make the before-state auditable without launching a browser. They are deliberately descriptive, not a substitute for later render-quality benchmarks.

## Reproduce

```sh
python3 scripts/devlog-007/collect_baseline.py
```

The JSON report contains tool versions, hashes, record-scan validation, and exact commands.
