# DevLog-006-01: Comment Conversations (Threaded Replies)

**Date**: 2026-02-15  
**Status**: In Progress  
**Scope**: Implement conversation-style comments with arbitrary-depth replies, soft delete, host thread delete, and fold/unfold controls.

## Requirements (Confirmed)

1. Arbitrary-depth replies (forum-style).
2. No new canvas bubbles for replies (root bubble only).
3. Soft delete for comments; host can delete whole thread.
4. Single permission toggle controls both comments and replies.
5. Oldest-first ordering in threads.
6. Viewer comments enabled by default.

## Plan

- [x] Extend `Comment` model for threads (`parentId`, `rootId`, `deleted`, `deletedAt`).
- [x] Add normalization for backward compatibility with existing comments.
- [x] Add update/soft-delete primitives in `commentStore` and `CommentSync`.
- [x] Update `ViewerCommentController` to create thread-capable root comments.
- [x] Refactor `CommentPanel` to threaded tree view with:
  - reply composer
  - per-comment fold/unfold
  - soft delete
  - host delete thread
- [x] Keep reply comments out of canvas bubbles (root bubbles only).
- [x] Validate with `pnpm check` and `pnpm test --run`.

## Progress Log

### 2026-02-15 14:44

- Created DevLog and locked final behavior to the user-confirmed decisions above.
- Next: implement model + sync/store compatibility layer.

### 2026-02-15 15:20

- Implemented threaded conversation panel:
  - Oldest-first thread traversal.
  - Arbitrary-depth replies with inline composer.
  - Per-comment fold/unfold of descendants.
  - Soft-delete comment action (author or host).
  - Host-only "Delete Thread" action (soft-deletes all descendants in same root thread).
- Updated host permissions copy to clarify one toggle controls comment + reply rights.
- Updated canvas bubble rendering to root comments only (`parentId === null`) so replies do not spawn new bubbles.
- Validation complete:
  - `pnpm check`: 0 errors, 0 warnings
  - `pnpm test --run`: 109/109 passing

### 2026-02-15 15:37

- Fixed global `Space` interception conflict in viewer pan controls:
  - `MouseController` now ignores `Space` keydown when the focused target is `INPUT`, `TEXTAREA`, or `contenteditable`.
  - This allows normal typing (including spaces) in the threaded comment reply textarea while keeping `Space+Drag` panning behavior elsewhere.
