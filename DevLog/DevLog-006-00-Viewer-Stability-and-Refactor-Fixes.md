# DevLog-006-00: Viewer Stability, API Token, and TURN Hardening

**Date**: 2026-02-15  
**Status**: Complete  
**Scope**: Consolidated execution log for DevLog-006 series:
- 006-00 Viewer stability and refactor fixes
- 006-01 Short-lived API token hardening
- 006-02 Ephemeral TURN credentials hardening

## Goals

1. Fix event-listener lifecycle leaks in viewer/renderer code paths.
2. Restore `pnpm check` pass status by removing known check blockers.
3. Replace long-lived client-exposed API token usage with short-lived scoped tokens.
4. Replace static TURN password runtime dependency with ephemeral TURN credentials.
5. Keep all changes behavior-preserving, migration-safe, and validated.

## Plan

- [x] Patch `PixiRenderer` layer-visibility listener to use a stable handler reference.
- [x] Patch `ViewerCanvas` custom resize listener to clean up correctly on unmount.
- [x] Patch `MeasurementOverlay` constructor/state to remove unused `app` member.
- [x] Add shared server auth module for short-lived scoped API tokens.
- [x] Add token issuance endpoint `POST /api/auth/token`.
- [x] Migrate file/python client calls to ephemeral token flow.
- [x] Add ephemeral TURN credential endpoint `GET /api/turn-credentials`.
- [x] Integrate TURN credential fetch in `YjsProvider` with static fallback.
- [x] Update docs/env/workflow notes for new security model.
- [x] Validate all slices with `pnpm check`, tests, and server syntax checks.

## Progress Log

### 2026-02-15 13:10

- Created DevLog and locked execution scope to targeted stability fixes.
- Next: apply code patches for listener cleanup and check failure.

### 2026-02-15 13:18

- Completed viewer stability code patches:
  - `src/lib/renderer/PixiRenderer.ts`: stable handler reference for add/remove listener symmetry.
  - `src/components/viewer/ViewerCanvas.svelte`: removed inline custom resize listener and added cleanup.
  - `src/lib/renderer/overlays/MeasurementOverlay.ts`: removed unused `app` member and simplified constructor.
- Next: run validation (`pnpm check`, `pnpm test --run`) and log results.

### 2026-02-15 13:24

- Stability validation results:
  - `pnpm check`: pass (`svelte-check found 0 errors and 0 warnings`).
  - `pnpm test --run`: pass (6 files, 94 tests).
- Next: security hardening follow-up.

### 2026-02-15 13:34

- Started API token hardening with shared scope design:
  - `files:read`
  - `files:write`
  - `python:execute`
- Next: patch server auth and token issuing endpoint.

### 2026-02-15 13:52

- Implemented API token hardening:
  - Added `server/auth.js` for short-lived token signing/verification and scoped middleware.
  - Added `POST /api/auth/token` in `server/server.js` with per-IP rate limit.
  - Switched `server/fileStorage.js` and `server/pythonExecutor.js` to scoped auth middleware.
  - Added `src/lib/api/authTokenClient.ts` with in-memory token cache.
  - Replaced direct `VITE_FILE_SERVER_TOKEN` usage in `FileTransfer`, `SessionManager`, and `PythonExecutor`.
  - Updated env/workflow/docs to remove browser long-lived file token usage.
- Next: run full validation and finalize status.

### 2026-02-15 14:16

- API token hardening validation:
  - `pnpm check`: pass (0 errors, 0 warnings)
  - `pnpm test --run`: pass (6 files, 94 tests)
  - `node --check` on modified server files: pass
- Patch complete. Long-lived browser-exposed file token usage removed from runtime code paths.

### 2026-02-15 14:24

- Started TURN hardening after two pushed commits:
  - `ed7340b` stability fixes
  - `01af1b7` short-lived API token hardening
- Next: implement server endpoint and client integration.

### 2026-02-15 14:41

- Added TURN hardening implementation:
  - `server/turnCredentials.js`: `GET /api/turn-credentials` endpoint for ephemeral TURN credentials.
  - `server/auth.js`: added `turn:read` scope.
  - `src/lib/api/turnCredentialsClient.ts`: client fetch + in-memory cache.
  - `src/lib/collaboration/YjsProvider.ts`: fetches ephemeral TURN creds first, falls back to static `VITE_TURN_PASSWORD`.
  - `src/lib/collaboration/SessionManager.ts`: awaits async `yjsProvider.connect(...)`.
- Updated environment/docs for TURN REST secret setup.
- Next: run validation and finalize status.

### 2026-02-15 14:46

- TURN hardening validation:
  - `pnpm check`: pass (0 errors, 0 warnings)
  - `pnpm test --run`: pass (6 files, 94 tests)
  - `node --check` for modified server files: pass
- TURN hardening slice complete.

### 2026-02-15 15:28

- Added automated test coverage for the new security and TURN logic:
  - `tests/api/authTokenClient.test.ts`
  - `tests/api/turnCredentialsClient.test.ts`
  - `tests/api/pythonExecutor.auth.test.ts`
  - `tests/collaboration/FileTransfer.auth.test.ts`
  - `tests/collaboration/YjsProvider.turn.test.ts`
  - `tests/server/auth.test.ts`
  - `tests/server/turnCredentials.test.ts`
- Test run result:
  - `pnpm test --run`: pass (13 files, 109 tests)

## Sensitive Data Review

- Reviewed consolidated DevLog content for secrets/tokens/credentials.
- No raw secret values, real tokens, passwords, private keys, or credential strings are present.
- Mentions of environment variables (`AUTH_TOKEN`, `API_TOKEN_SECRET`, `TURN_SHARED_SECRET`, `VITE_TURN_PASSWORD`) are generic configuration identifiers only.
- Commit hashes included are public git identifiers, not sensitive data.
