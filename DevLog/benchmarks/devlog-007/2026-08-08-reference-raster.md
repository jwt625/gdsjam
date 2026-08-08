# DevLog-007 reference raster oracle

**Date:** 2026-08-08

**Branch:** `feature/devlog-007-reference-raster`

**Purpose:** provide a slow, deterministic semantic oracle for later overview/tile work without depending on the production renderer.

## Contract

- Inputs are filled polygons with safe-integer coordinates in canonical GDS database-unit (DBU) counts and an explicit world crop.
- Each output pixel is one exact binary sample at its center. Fill is even-odd and a sample exactly on an edge is included. Raster decisions use rational `BigInt` arithmetic, avoiding floating-point ambiguity when a pixel center is a fractional DBU.
- The source world is Y-up. Raw-mask row zero samples the top of the crop (`maxY`).
- Masks are OR-composited per `(layer, datatype)` and across layers. A separate integer coverage count preserves overlap/overdraw information.
- Polygon evaluation is sorted by `(layer, datatype, id)`, making the serialized result independent of input ordering. Tests also cover start-vertex and winding changes.
- The committed JSON is a stable, inspectable raw-mask artifact. It is intentionally not a browser screenshot or PNG.

## Synthetic evidence fixture

The fixture is a `32 DBU × 16 DBU` crop rasterized at `32 × 16` pixels. It contains five rectangles on three layer/datatype pairs, including same-layer overlap, cross-layer overlap, two one-DBU-wide lines, and a one-DBU gap.

| Metric | Result |
|---|---:|
| Pixels | 512 |
| Polygons | 5 |
| Layer/datatype masks | 3 |
| Combined covered pixels | 252 |
| Conserved polygon samples (includes overlap) | 297 |
| One-DBU lines | 12 pixels each |
| One-DBU gap | 12 pixels clear |

The exact masks and per-pixel overlap counts are in [`2026-08-08-reference-raster.json`](2026-08-08-reference-raster.json). Generate them with:

```bash
pnpm evidence:reference-raster
```

The same command performs 250 in-process repetitions and prints an environment-specific timing observation. Two consecutive runs of the exact rational implementation measured **0.147–0.155 ms/raster** on the development machine. This is only a regression sanity check: the implementation is deliberately `O(polygons × crop pixels)` and is not a production performance target.

## Validation

- Focused Vitest: 6 reference-raster tests passed.
- Full Vitest: 24 files, 162 tests passed.
- Svelte/TypeScript check: 0 errors and 0 warnings.
- Production build: passed; Vite transformed 2,217 modules in 10.34 seconds. The existing large-chunk warning remains.
- Two evidence runs produced byte-identical JSON (`SHA-256 d04c2f72fe911fc21f9cb5318fbebbf0fac275d6a7ce7d2f1ca3d801f69bdd8f`) because timing and machine metadata are kept out of the artifact.

## Limitations and comparison policy

- Filled polygon masks only. Paths must already be converted to polygons; text markers, strokes, hierarchy traversal, and layer colors are outside this oracle.
- This is point-sampled binary coverage, not fractional area coverage. Features with no covered pixel center intentionally disappear at that resolution; callers must choose crop/resolution explicitly.
- Browser/WebGL screenshots include antialiasing, color blending, device-pixel-ratio behavior, and possible GPU variance. Compare exact semantic/raw masks to this oracle. Do not require byte equality between this artifact and antialiased screenshots; define a separate edge/color tolerance when screenshot comparison is added.
- Coordinates must fit JavaScript's safe-integer input range. After validation, edge and pixel-center decisions are performed with `BigInt` rational arithmetic.
