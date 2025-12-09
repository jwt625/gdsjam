/**
 * Comment Store - Manages floating comments state and persistence
 *
 * Storage Strategy:
 * - Solo mode: localStorage with key `gdsjam_comments_${fileName}_${fileSize}`
 * - Collaboration: Y.js shared array `comments`
 *
 * Permissions:
 * - Solo mode: Full access (no restrictions)
 * - Collaboration: Host controls viewer permissions, rate limiting enforced
 */

import { get, writable } from "svelte/store";
import type { Comment, CommentPermissions } from "../lib/collaboration/types";
import type {
	CommentDisplayState,
	CommentStoreState,
	CommentWithDisplayState,
} from "../lib/comments/types";
import { DEBUG } from "../lib/config";

const STORAGE_KEY_PREFIX = "gdsjam_comments_";
const DEFAULT_PERMISSIONS: CommentPermissions = {
	viewersCanComment: false,
	viewerRateLimit: 1, // 1 comment per minute
	hostRateLimit: 1, // 1 comment per 10 seconds
};

/**
 * Create the comment store
 */
function createCommentStore() {
	const initialState: CommentStoreState = {
		comments: new Map(),
		commentModeActive: false,
		allCommentsVisible: true,
		previousVisibilityState: true,
		rateLimits: new Map(),
		permissions: { ...DEFAULT_PERMISSIONS },
		fileIdentifier: null,
	};

	const { subscribe, set, update } = writable<CommentStoreState>(initialState);

	return {
		subscribe,

		/**
		 * Initialize for a new file
		 * Only reinitializes if fileIdentifier has changed (different file)
		 */
		initializeForFile: (fileName: string, fileSize: number) => {
			const fileIdentifier = `${fileName}_${fileSize}`;

			update((state) => {
				// Skip if already initialized for this file
				if (state.fileIdentifier === fileIdentifier) {
					if (DEBUG) {
						console.log(`[commentStore] Already initialized for file: ${fileIdentifier}, skipping`);
					}
					return state;
				}

				if (DEBUG) {
					console.log(`[commentStore] Initializing for file: ${fileIdentifier}`);
				}

				return {
					...state,
					fileIdentifier,
					comments: new Map(),
					commentModeActive: false,
					allCommentsVisible: true,
					previousVisibilityState: true,
					rateLimits: new Map(),
				};
			});

			// Load from localStorage (solo mode) - only if we actually initialized
			const currentState = get({ subscribe });
			if (currentState.fileIdentifier === fileIdentifier) {
				commentStore.loadFromLocalStorage(fileIdentifier);
			}
		},

		/**
		 * Initialize for collaboration session
		 * Note: Does NOT clear comments - Y.js sync will populate them via syncFromYjs
		 * Only reinitializes if fileIdentifier has changed (different file)
		 */
		initializeForSession: (fileHash: string, permissions: CommentPermissions) => {
			update((state) => {
				// Skip if already initialized for this file
				if (state.fileIdentifier === fileHash) {
					if (DEBUG) {
						console.log(`[commentStore] Already initialized for session: ${fileHash}, skipping`);
					}
					// Just update permissions, don't reset anything else
					return {
						...state,
						permissions,
					};
				}

				if (DEBUG) {
					console.log(`[commentStore] Initializing for session: ${fileHash}`);
				}

				return {
					...state,
					fileIdentifier: fileHash,
					comments: new Map(), // Clear comments only when switching files
					commentModeActive: false,
					allCommentsVisible: true,
					previousVisibilityState: true,
					rateLimits: new Map(),
					permissions,
				};
			});
		},

		/**
		 * Load comments from localStorage (solo mode only)
		 */
		loadFromLocalStorage: (fileIdentifier: string) => {
			try {
				const key = `${STORAGE_KEY_PREFIX}${fileIdentifier}`;
				const stored = localStorage.getItem(key);
				if (!stored) return;

				const commentsArray: Comment[] = JSON.parse(stored);
				// Add default display state when loading
				const commentsMap = new Map(
					commentsArray.map((c) => [c.id, { ...c, displayState: "preview" as const }]),
				);

				update((state) => ({
					...state,
					comments: commentsMap,
				}));

				if (DEBUG) {
					console.log(`[commentStore] Loaded ${commentsMap.size} comments from localStorage`);
				}
			} catch (error) {
				console.error("[commentStore] Failed to load from localStorage:", error);
			}
		},

		/**
		 * Save comments to localStorage (solo mode only)
		 */
		saveToLocalStorage: (fileIdentifier: string, comments: Map<string, Comment>) => {
			try {
				const key = `${STORAGE_KEY_PREFIX}${fileIdentifier}`;
				const commentsArray = Array.from(comments.values());
				localStorage.setItem(key, JSON.stringify(commentsArray));

				if (DEBUG) {
					console.log(`[commentStore] Saved ${commentsArray.length} comments to localStorage`);
				}
			} catch (error) {
				console.error("[commentStore] Failed to save to localStorage:", error);
			}
		},

		/**
		 * Sync comments from Y.js (collaboration mode)
		 * Merges Y.js comments with local state, preserving display states for existing comments
		 */
		syncFromYjs: (comments: Comment[]) => {
			update((state) => {
				const newCommentsMap = new Map<string, CommentWithDisplayState>();

				// Merge Y.js comments with existing local state
				for (const comment of comments) {
					const existingComment = state.comments.get(comment.id);
					if (existingComment) {
						// Preserve display state for existing comments
						newCommentsMap.set(comment.id, {
							...comment,
							displayState: existingComment.displayState,
						});
					} else {
						// New comment - default to preview state
						newCommentsMap.set(comment.id, {
							...comment,
							displayState: "preview" as const,
						});
					}
				}

				if (DEBUG) {
					console.log(`[commentStore] Synced ${newCommentsMap.size} comments from Y.js`);
				}

				return {
					...state,
					comments: newCommentsMap,
				};
			});
		},

		/**
		 * Sync permissions from Y.js (collaboration mode)
		 */
		syncPermissionsFromYjs: (permissions: CommentPermissions) => {
			update((state) => {
				if (DEBUG) {
					console.log("[commentStore] Synced permissions from Y.js:", permissions);
				}

				return {
					...state,
					permissions,
				};
			});
		},

		/**
		 * Toggle comment mode on/off
		 */
		toggleCommentMode: () => {
			update((state) => {
				const newMode = !state.commentModeActive;
				if (DEBUG) {
					console.log(`[commentStore] Comment mode: ${newMode ? "ON" : "OFF"}`);
				}
				return {
					...state,
					commentModeActive: newMode,
				};
			});
		},

		/**
		 * Set comment mode explicitly
		 */
		setCommentMode: (active: boolean) => {
			update((state) => ({
				...state,
				commentModeActive: active,
			}));
		},

		/**
		 * Add a new comment
		 */
		addComment: (comment: Comment, isCollaboration: boolean = false) => {
			update((state) => {
				const newComments = new Map(state.comments);
				// Add default display state
				const commentWithState: CommentWithDisplayState = {
					...comment,
					displayState: "preview",
				};
				newComments.set(comment.id, commentWithState);

				// Save to localStorage if solo mode (without displayState)
				if (!isCollaboration && state.fileIdentifier) {
					const commentsForStorage = new Map(
						Array.from(newComments.entries()).map(([id, c]) => {
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							const { displayState, ...commentData } = c;
							return [id, commentData as Comment];
						}),
					);
					commentStore.saveToLocalStorage(state.fileIdentifier, commentsForStorage);
				}

				if (DEBUG) {
					console.log(`[commentStore] Added comment: ${comment.id}`);
				}

				return {
					...state,
					comments: newComments,
				};
			});
		},

		/**
		 * Delete a comment
		 */
		deleteComment: (commentId: string, isCollaboration: boolean = false) => {
			update((state) => {
				const newComments = new Map(state.comments);
				newComments.delete(commentId);

				// Save to localStorage if solo mode (without displayState)
				if (!isCollaboration && state.fileIdentifier) {
					const commentsForStorage = new Map(
						Array.from(newComments.entries()).map(([id, c]) => {
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							const { displayState, ...commentData } = c;
							return [id, commentData as Comment];
						}),
					);
					commentStore.saveToLocalStorage(state.fileIdentifier, commentsForStorage);
				}

				if (DEBUG) {
					console.log(`[commentStore] Deleted comment: ${commentId}`);
				}

				return {
					...state,
					comments: newComments,
				};
			});
		},

		/**
		 * Update comment display state (local UI only, not persisted)
		 */
		updateCommentDisplayState: (commentId: string, displayState: CommentDisplayState) => {
			update((state) => {
				const comment = state.comments.get(commentId);
				if (!comment) return state;

				const updatedComment = { ...comment, displayState };
				const newComments = new Map(state.comments);
				newComments.set(commentId, updatedComment);

				return {
					...state,
					comments: newComments,
				};
			});
		},

		/**
		 * Cycle comment display state:
		 * - For short comments (≤140 chars): minimal -> preview -> minimal
		 * - For long comments (>140 chars): minimal -> preview -> full -> minimal
		 */
		cycleDisplayState: (commentId: string) => {
			update((state) => {
				const comment = state.comments.get(commentId);
				if (!comment) return state;

				const isShortComment = comment.content.length <= 140;
				let newState: CommentDisplayState;

				switch (comment.displayState) {
					case "minimal":
						newState = "preview";
						break;
					case "preview":
						// Skip "full" state for short comments
						newState = isShortComment ? "minimal" : "full";
						break;
					case "full":
						newState = "minimal";
						break;
					default:
						newState = "preview";
				}

				const updatedComment = { ...comment, displayState: newState };
				const newComments = new Map(state.comments);
				newComments.set(commentId, updatedComment);

				if (DEBUG) {
					console.log(
						`[commentStore] Cycled display state for ${commentId}: ${comment.displayState} -> ${newState}`,
					);
				}

				return {
					...state,
					comments: newComments,
				};
			});
		},

		/**
		 * Toggle all comments visibility
		 */
		toggleAllCommentsVisibility: () => {
			update((state) => {
				const newVisibility = !state.allCommentsVisible;
				if (DEBUG) {
					console.log(`[commentStore] All comments: ${newVisibility ? "VISIBLE" : "HIDDEN"}`);
				}
				return {
					...state,
					allCommentsVisible: newVisibility,
				};
			});
		},

		/**
		 * Set all comments visibility (for hold `c` temporary peek)
		 */
		setAllCommentsVisibility: (visible: boolean, savePrevious: boolean = false) => {
			update((state) => {
				const updates: Partial<CommentStoreState> = {
					allCommentsVisible: visible,
				};

				if (savePrevious) {
					updates.previousVisibilityState = state.allCommentsVisible;
				}

				return {
					...state,
					...updates,
				};
			});
		},

		/**
		 * Restore previous visibility state (after hold `c` release)
		 */
		restorePreviousVisibility: () => {
			update((state) => ({
				...state,
				allCommentsVisible: state.previousVisibilityState,
			}));
		},

		/**
		 * Check rate limit for a user
		 * Returns true if user can comment, false if rate limited
		 */
		checkRateLimit: (userId: string, isHost: boolean): boolean => {
			let canComment = true;

			update((state) => {
				const now = Date.now();
				const rateLimit = isHost
					? state.permissions.hostRateLimit
					: state.permissions.viewerRateLimit;
				const windowMs = isHost ? 10000 : 60000; // 10s for host, 60s for viewer

				// Get or create rate limit state
				let rateLimitState = state.rateLimits.get(userId);
				if (!rateLimitState) {
					rateLimitState = {
						userId,
						recentComments: [],
						lastViolation: null,
					};
				}

				// Filter out old timestamps outside the window
				const recentComments = rateLimitState.recentComments.filter(
					(timestamp) => now - timestamp < windowMs,
				);

				// Check if rate limit exceeded
				if (recentComments.length >= rateLimit) {
					canComment = false;
					rateLimitState.lastViolation = now;
					if (DEBUG) {
						console.log(`[commentStore] Rate limit exceeded for user: ${userId}`);
					}
				} else {
					// Add current timestamp
					recentComments.push(now);
				}

				// Update rate limit state
				const newRateLimits = new Map(state.rateLimits);
				newRateLimits.set(userId, {
					...rateLimitState,
					recentComments,
				});

				return {
					...state,
					rateLimits: newRateLimits,
				};
			});

			return canComment;
		},

		/**
		 * Update permissions (host only, collaboration mode)
		 */
		updatePermissions: (permissions: Partial<CommentPermissions>) => {
			update((state) => ({
				...state,
				permissions: {
					...state.permissions,
					...permissions,
				},
			}));
		},

		/**
		 * Reset store (clear all data)
		 */
		reset: () => {
			if (DEBUG) {
				console.log("[commentStore] Resetting store");
			}
			set(initialState);
		},
	};
}

export const commentStore = createCommentStore();
