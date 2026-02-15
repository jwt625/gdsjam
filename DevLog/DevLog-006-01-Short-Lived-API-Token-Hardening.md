# DevLog-006-01: Short-Lived API Token Hardening

**Date**: 2026-02-15  
**Status**: Complete  
**Scope**: Replace long-lived client-exposed file/python API token usage with short-lived server-issued scoped tokens

## Goals

1. Remove direct `VITE_FILE_SERVER_TOKEN` dependency from browser request paths.
2. Introduce short-lived, scoped API tokens issued by the server.
3. Keep behavior backward-compatible for server operators still using `AUTH_TOKEN`.

## Plan

- [x] Add shared auth module in server for:
  - short-lived token signing and verification
  - scope checks
  - reusable middleware
- [x] Add token issuance endpoint: `POST /api/auth/token`.
- [x] Apply scoped auth to:
  - `/api/files` (read/write scopes)
  - `/api/execute` (python execute scope)
- [x] Add client-side ephemeral token manager with in-memory cache.
- [x] Migrate frontend calls in:
  - `FileTransfer`
  - `SessionManager` pending upload path
  - `PythonExecutor`
- [x] Update environment/docs notes and run validation.

## Progress Log

### 2026-02-15 13:34

- Started implementation with server/client shared scope design:
  - `files:read`
  - `files:write`
  - `python:execute`
- Next: patch server auth and token issuing endpoint.

### 2026-02-15 13:52

- Implemented server auth hardening:
  - Added `server/auth.js` for short-lived token signing/verification and scoped middleware.
  - Added `POST /api/auth/token` in `server/server.js` with per-IP rate limit.
  - Switched `server/fileStorage.js` and `server/pythonExecutor.js` to scoped auth middleware.
- Implemented client migration:
  - Added `src/lib/api/authTokenClient.ts` with in-memory token cache.
  - Replaced direct `VITE_FILE_SERVER_TOKEN` usage in `FileTransfer`, `SessionManager`, and `PythonExecutor`.
- Updated env/workflow/docs:
  - Removed Vite file-server token guidance from root env examples.
  - Added server-side API token secret config note.
  - Removed `VITE_FILE_SERVER_TOKEN` from deploy workflow env injection.
- Next: run full validation and finalize status.

### 2026-02-15 14:16

- Validation:
  - `pnpm check`: pass (0 errors, 0 warnings)
  - `pnpm test --run`: pass (6 files, 94 tests)
  - `node --check server/*.js` on modified server files: pass
- Patch complete. Long-lived browser-exposed file token usage removed from runtime code paths.
