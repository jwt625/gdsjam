# DevLog-006-00: Viewer Stability and Refactor Fixes

**Date**: 2026-02-15  
**Status**: Complete  
**Scope**: Resolve concrete stability issues from repo audit and continue behavior-preserving refactor cleanup

## Goals

1. Fix event-listener lifecycle leaks in viewer/renderer code paths.
2. Restore `pnpm check` pass status by removing the known unused-member error.
3. Keep changes behavior-preserving and low-risk.

## Plan

- [x] Patch `PixiRenderer` layer-visibility listener to use a stable handler reference.
- [x] Patch `ViewerCanvas` custom resize listener to clean up correctly on unmount.
- [x] Patch `MeasurementOverlay` constructor/state to remove unused `app` member.
- [x] Run `pnpm check` and `pnpm test --run`.
- [x] Record outcomes and remaining follow-ups.

## Progress Log

### 2026-02-15 13:10

- Created DevLog and locked execution scope to targeted stability fixes.
- Next: apply code patches for listener cleanup and check failure.

### 2026-02-15 13:18

- Completed code patches:
  - `src/lib/renderer/PixiRenderer.ts`: stable handler reference for add/remove listener symmetry.
  - `src/components/viewer/ViewerCanvas.svelte`: removed inline custom resize listener and added cleanup.
  - `src/lib/renderer/overlays/MeasurementOverlay.ts`: removed unused `app` member and simplified constructor.
- Next: run validation (`pnpm check`, `pnpm test --run`) and log results.

### 2026-02-15 13:24

- Validation results:
  - `pnpm check`: pass (`svelte-check found 0 errors and 0 warnings`).
  - `pnpm test --run`: pass (6 files, 94 tests).
- Remaining follow-up:
  - Security hardening issue remains open and needs architecture-level token changes (separate scope from this stability patch).
