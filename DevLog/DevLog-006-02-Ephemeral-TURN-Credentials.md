# DevLog-006-02: Ephemeral TURN Credentials

**Date**: 2026-02-15  
**Status**: Complete  
**Scope**: Replace static TURN password usage in browser runtime with server-issued ephemeral TURN credentials

## Goals

1. Remove direct dependency on `VITE_TURN_PASSWORD` for normal runtime.
2. Issue short-lived TURN credentials from server.
3. Keep fallback path for local/dev compatibility.

## Plan

- [x] Add TURN credential issuance endpoint to server.
- [x] Add typed client utility for TURN credential fetch.
- [x] Update `YjsProvider` to initialize WebRTC with fetched TURN credentials.
- [x] Keep static TURN fallback path for migration safety.
- [x] Update docs/env examples.
- [x] Validate with `pnpm check`, tests, and server syntax check.

## Progress Log

### 2026-02-15 14:24

- Started TURN hardening after pushing two tested commits:
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

- Validation:
  - `pnpm check`: pass (0 errors, 0 warnings)
  - `pnpm test --run`: pass (6 files, 94 tests)
  - `node --check` for modified server files: pass
- TURN hardening slice complete.
