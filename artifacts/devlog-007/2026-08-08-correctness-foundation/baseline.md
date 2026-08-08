# DevLog-007 correctness-foundation baseline

Collected: `2026-08-08T18:26:06.922956+00:00`
Revision: `b3bc9963d9baac95988b1f50c2bfa8e24bde7e93` on `feature/devlog-007-correctness-foundation`

## Existing validation

| Check | Exit | Wall time | Raw log |
|---|---:|---:|---|
| test | 0 | 1.531 s | `artifacts/devlog-007/2026-08-08-correctness-foundation/test.log` |
| check | 0 | 2.387 s | `artifacts/devlog-007/2026-08-08-correctness-foundation/check.log` |
| build | 0 | 10.942 s | `artifacts/devlog-007/2026-08-08-correctness-foundation/build.log` |

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
- Structured completeness in `RenderResult`: `false`.
- `Render complete` log present: `true`.

These source facts make the before-state auditable without launching a browser. They are deliberately descriptive, not a substitute for later render-quality benchmarks.

## Reproduce

```sh
python3 scripts/devlog-007/collect_baseline.py
```

The JSON report contains tool versions, hashes, record-scan validation, and exact commands.
