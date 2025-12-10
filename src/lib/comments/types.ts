/**
 * Comment Types - Data structures for floating comments feature
 *
 * Note: Comment and CommentPermissions are defined in src/lib/collaboration/types.ts
 * to enable Y.js sync. Import from there for shared types.
 */

import type { Comment, CommentPermissions } from "../collaboration/types";

/**
 * Display state for comment bubbles
 */
export type CommentDisplayState = "minimal" | "preview" | "full";

/**
 * Rate limit tracking for a user
 */
export interface RateLimitState {
	/** User ID */
	userId: string;
	/** Timestamps of recent comments (milliseconds since epoch) */
	recentComments: number[];
	/** Last rate limit violation timestamp */
	lastViolation: number | null;
}

/**
 * Comment with local UI state (extends synced Comment type)
 */
export interface CommentWithDisplayState extends Comment {
	/** Current display state (minimal/preview/full) - local UI state only, not synced */
	displayState: CommentDisplayState;
}

/**
 * Comment store state
 */
export interface CommentStoreState {
	/** All comments (keyed by comment ID) */
	comments: Map<string, CommentWithDisplayState>;
	/** Comment mode active (user can click to place comment) */
	commentModeActive: boolean;
	/** Comment visibility (all visible or all hidden) */
	allCommentsVisible: boolean;
	/** Previous visibility state (for hold `c` temporary peek) */
	previousVisibilityState: boolean;
	/** Rate limit tracking per user */
	rateLimits: Map<string, RateLimitState>;
	/** Comment permissions (collaboration only) */
	permissions: CommentPermissions;
	/** File identifier for localStorage (fileName_fileSize or fileHash) */
	fileIdentifier: string | null;
	/** Toast notification message (null = no toast) */
	toastMessage: string | null;
}
