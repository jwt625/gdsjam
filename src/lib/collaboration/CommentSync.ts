/**
 * CommentSync - Handles comment synchronization via Y.js
 *
 * Storage:
 * - Y.Array "comments" - shared comment list
 * - Y.Map "session" - comment permissions
 *
 * Responsibilities:
 * - Sync comments between all participants
 * - Enforce comment permissions (host controls)
 * - Handle comment CRUD operations
 */

import type * as Y from "yjs";
import { DEBUG } from "../config";
import type { Comment, CommentPermissions } from "./types";
import type { YjsProvider } from "./YjsProvider";

// Heartbeat interval for comment sync polling (milliseconds)
const COMMENT_SYNC_HEARTBEAT = 5000; // 5 seconds

export interface CommentSyncCallbacks {
	onCommentsChanged?: (comments: Comment[]) => void;
	onPermissionsChanged?: (permissions: CommentPermissions) => void;
}

export class CommentSync {
	private yjsProvider: YjsProvider;
	private callbacks: CommentSyncCallbacks;
	private commentsArray: Y.Array<Comment> | null = null;
	private sessionMap: Y.Map<any> | null = null;
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private lastCommentCount: number = 0;

	constructor(yjsProvider: YjsProvider, _userId: string, callbacks: CommentSyncCallbacks = {}) {
		this.yjsProvider = yjsProvider;
		this.callbacks = callbacks;
		if (DEBUG) console.log("[CommentSync] Initialized for user:", _userId);
	}

	setCallbacks(callbacks: CommentSyncCallbacks): void {
		this.callbacks = callbacks;
	}

	/**
	 * Initialize comment sync for a session
	 */
	initialize(): void {
		this.commentsArray = this.yjsProvider.getArray<Comment>("comments");
		this.sessionMap = this.yjsProvider.getMap<any>("session");

		// Listen for comment array changes
		this.commentsArray.observe(() => {
			const comments = this.commentsArray!.toArray();
			if (DEBUG) {
				console.log("[CommentSync] Comments changed via observer:", comments.length);
			}
			this.lastCommentCount = comments.length;
			this.callbacks.onCommentsChanged?.(comments);
		});

		// Listen for permission changes
		this.sessionMap.observe((event) => {
			if (event.keysChanged.has("commentPermissions")) {
				const permissions = this.sessionMap!.get("commentPermissions") as
					| CommentPermissions
					| undefined;
				if (permissions && DEBUG) {
					console.log("[CommentSync] Permissions changed:", permissions);
				}
				if (permissions) {
					this.callbacks.onPermissionsChanged?.(permissions);
				}
			}
		});

		// Trigger initial callbacks
		const initialComments = this.commentsArray.toArray();
		const initialPermissions = this.sessionMap.get("commentPermissions") as
			| CommentPermissions
			| undefined;

		this.lastCommentCount = initialComments.length;

		if (initialComments.length > 0) {
			this.callbacks.onCommentsChanged?.(initialComments);
		}
		if (initialPermissions) {
			this.callbacks.onPermissionsChanged?.(initialPermissions);
		}

		// Start heartbeat polling as fallback for missed Y.js observer events
		this.startHeartbeat();

		if (DEBUG) {
			console.log("[CommentSync] Initialized with", initialComments.length, "comments");
		}
	}

	/**
	 * Start heartbeat polling to ensure comments stay synced
	 * This is a fallback in case Y.js observers miss updates
	 */
	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatInterval = setInterval(() => {
			this.pollComments();
		}, COMMENT_SYNC_HEARTBEAT);

		if (DEBUG) {
			console.log("[CommentSync] Started heartbeat polling");
		}
	}

	/**
	 * Stop heartbeat polling
	 */
	private stopHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	/**
	 * Poll comments from Y.js and trigger callback if changed
	 */
	private pollComments(): void {
		if (!this.commentsArray) return;

		const comments = this.commentsArray.toArray();
		if (comments.length !== this.lastCommentCount) {
			if (DEBUG) {
				console.log(
					"[CommentSync] Comments changed via heartbeat poll:",
					this.lastCommentCount,
					"->",
					comments.length,
				);
			}
			this.lastCommentCount = comments.length;
			this.callbacks.onCommentsChanged?.(comments);
		}
	}

	/**
	 * Add a comment to the shared array
	 */
	addComment(comment: Comment): void {
		if (!this.commentsArray) {
			console.error("[CommentSync] Cannot add comment - not initialized");
			return;
		}

		this.commentsArray.push([comment]);
		if (DEBUG) {
			console.log("[CommentSync] Added comment:", comment.id);
		}
	}

	/**
	 * Delete a comment from the shared array
	 */
	deleteComment(commentId: string): void {
		if (!this.commentsArray) {
			console.error("[CommentSync] Cannot delete comment - not initialized");
			return;
		}

		const comments = this.commentsArray.toArray();
		const index = comments.findIndex((c) => c.id === commentId);
		if (index !== -1) {
			this.commentsArray.delete(index, 1);
			if (DEBUG) {
				console.log("[CommentSync] Deleted comment:", commentId);
			}
		}
	}

	/**
	 * Update comment permissions (host only)
	 */
	updatePermissions(permissions: CommentPermissions): void {
		if (!this.sessionMap) {
			console.error("[CommentSync] Cannot update permissions - not initialized");
			return;
		}

		this.sessionMap.set("commentPermissions", permissions);
		if (DEBUG) {
			console.log("[CommentSync] Updated permissions:", permissions);
		}
	}

	/**
	 * Get current comments
	 */
	getComments(): Comment[] {
		if (!this.commentsArray) return [];
		return this.commentsArray.toArray();
	}

	/**
	 * Get current permissions
	 */
	getPermissions(): CommentPermissions | null {
		if (!this.sessionMap) return null;
		return this.sessionMap.get("commentPermissions") as CommentPermissions | null;
	}

	/**
	 * Cleanup
	 */
	destroy(): void {
		this.stopHeartbeat();
		this.commentsArray = null;
		this.sessionMap = null;
		if (DEBUG) console.log("[CommentSync] Destroyed");
	}
}
