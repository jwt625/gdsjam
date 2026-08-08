# DevLog-007 correctness milestone 1

**Run date:** 2026-08-08  
**Branch:** `feature/devlog-007-correctness-foundation`  
**Base revision:** `b3bc9963d9baac95988b1f50c2bfa8e24bde7e93`

## Outcome

This milestone establishes an executable correctness foundation and makes
incomplete rendering visible. Measurements are single local runs on Apple
arm64/macOS 15.5, Node 23.7.0, and pnpm 10.12.4; they are evidence, not CI gates.

| Measurement | Before | Milestone 1 |
|---|---:|---:|
| Test files | 13 | 19 |
| Tests | 109 | 133 |
| Test wall time | 1.531 s | 1.521 s |
| Type/Svelte check | 2.387 s, green | 2.408 s, green |
| Production build | 10.942 s, green | 10.910 s, green |
| Synthetic oracle fixtures | 0 | 4 |
| Explicit budget/depth completeness signals | 0 | 2 |

Timing variance at this scale is noise; the meaningful result is that the added
correctness coverage did not create an observable regression in these coarse
validation commands.

## Browser evidence

A production UI capture used the generated 5 nm-DBU synthetic fixture with
`VITE_MAX_POLYGONS_PER_RENDER=1`:

- Chromium viewport: 1440 × 900 at DPR 1.
- Load-to-visible-warning: 1,496.4 ms.
- Rendered count at truncation: 1 polygon.
- Visible result: expandable **Layout is partially rendered** warning.
- Browser console errors: 0.
- Screenshot: `artifacts/devlog-007/2026-08-08-correctness-foundation/partial-render-warning.png`.
- Machine-readable evidence: `partial-render-warning.json` beside the screenshot.

This deliberately uses a tiny public synthetic fixture and a test-only budget;
no existing layout provenance is assumed.

## Geometry evidence

- Non-default-unit fixture: 5 nm per DBU and 1 µm per user unit; parsed physical
  units and bounds agree with the committed gdstk oracle.
- Skewed/rotated AREF fixture: 3 × 2 instances with pitch vectors `(7, 3)` and
  `(-3, 7)` µm. Both components survive parsing and placement.
- Transformed SREF fixture: reflection, rotation, and magnification are captured
  by deterministic oracle data.
- Multiple-top fixture: `TOP_A` and `TOP_B` plus aggregate bounds are recovered.
- Nested renderer test: a reflected parent and rotated child produce the expected
  world bounds `(109, 48)–(110, 50)`, exercising production affine composition.

## Current large-file signal

The strict record scanner reports 141,595 BOUNDARY/PATH records in the existing
10.1 MB TLS fixture versus the default 100,000 polygon budget. This explains why
the old renderer can produce a traversal-order subset. Because existing fixture
provenance is not yet confirmed, it is used only for local numeric inventory—not
committed screenshots or newly published binary artifacts.

## Evidence paths

- Before-state reviewed summary:
  `DevLog/benchmarks/devlog-007/2026-08-08-correctness-foundation-baseline.md`
- Before-state raw evidence:
  `artifacts/devlog-007/2026-08-08-correctness-foundation/`
- Milestone validation evidence:
  `artifacts/devlog-007/2026-08-08-correctness-milestone-1/`
- Reproduction scripts: `scripts/devlog-007/`

## Known limits

- AREF is placed correctly but is still eagerly expanded in the legacy document
  adapter; compact scene-index storage is the next PR.
- STRANS absolute-angle and absolute-magnification flags are preserved but their
  nested rendering semantics still need dedicated oracle fixtures.
- Unsupported element diagnostics are schema-ready, but parser counting plus BOX
  and TEXT semantic support remain for the next diagnostics/parser slice.
- Pixel-coverage and reference-raster error are not measured yet.
