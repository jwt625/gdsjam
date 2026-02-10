import type { SessionManager } from "../collaboration/SessionManager";
import type { Comment, CommentPermissions } from "../collaboration/types";
import type { PixiRenderer } from "../renderer/PixiRenderer";
import { generateUUID } from "../utils/uuid";

interface WorldPoint {
	worldX: number;
	worldY: number;
}

interface SessionUserInfo {
	userId: string;
	displayName: string;
	color: string;
}

export interface ViewerCommentControllerCallbacks {
	getRenderer: () => PixiRenderer | null;
	getCanvas: () => HTMLCanvasElement | null;
	getCommentsCount: () => number;
	getIsInSession: () => boolean;
	getIsHost: () => boolean;
	getCommentPermissions: () => CommentPermissions;
	getSessionManager: () => SessionManager | null;
	checkRateLimit: (userId: string, isHost: boolean) => boolean;
	showToast: (message: string) => void;
	addComment: (comment: Comment, isInSession: boolean) => void;
}

/**
 * Handles comment placement and submission logic for ViewerCanvas.
 */
export class ViewerCommentController {
	private readonly callbacks: ViewerCommentControllerCallbacks;

	constructor(callbacks: ViewerCommentControllerCallbacks) {
		this.callbacks = callbacks;
	}

	getPendingFromCanvasPointer(
		event: MouseEvent | PointerEvent,
		mobileBreakpoint: number,
	): WorldPoint | null {
		const renderer = this.callbacks.getRenderer();
		const canvas = this.callbacks.getCanvas();
		if (!renderer || !canvas) return null;

		if (
			typeof window !== "undefined" &&
			window.innerWidth < mobileBreakpoint &&
			"pointerType" in event &&
			event.pointerType === "touch"
		) {
			return null;
		}

		return this.toWorldPoint(event.clientX, event.clientY, canvas, renderer);
	}

	getPendingFromViewportCenter(): WorldPoint | null {
		const renderer = this.callbacks.getRenderer();
		const canvas = this.callbacks.getCanvas();
		if (!renderer || !canvas) return null;

		const rect = canvas.getBoundingClientRect();
		const centerScreenX = rect.width / 2;
		const centerScreenY = rect.height / 2;
		const viewportState = renderer.getViewportState();

		return {
			worldX: (centerScreenX - viewportState.x) / viewportState.scale,
			worldY: -((centerScreenY - viewportState.y) / viewportState.scale),
		};
	}

	worldToScreen(worldX: number, worldY: number): { x: number; y: number } | null {
		const renderer = this.callbacks.getRenderer();
		if (!renderer) return null;

		const viewportState = renderer.getViewportState();
		return {
			x: worldX * viewportState.scale + viewportState.x,
			y: -worldY * viewportState.scale + viewportState.y,
		};
	}

	recenterViewport(worldX: number, worldY: number): void {
		const renderer = this.callbacks.getRenderer();
		const canvas = this.callbacks.getCanvas();
		if (!renderer || !canvas) return;

		const rect = canvas.getBoundingClientRect();
		const centerScreenX = rect.width / 2;
		const centerScreenY = rect.height / 2;
		const viewportState = renderer.getViewportState();
		const newX = centerScreenX - worldX * viewportState.scale;
		const newY = centerScreenY + worldY * viewportState.scale;

		renderer.setViewportState({
			...viewportState,
			x: newX,
			y: newY,
		});
	}

	submitComment(content: string, pendingPosition: WorldPoint | null): boolean {
		if (!pendingPosition) return false;

		const currentCommentCount = this.callbacks.getCommentsCount();
		if (currentCommentCount >= 100) {
			this.callbacks.showToast("Comment limit reached (100 comments maximum)");
			return false;
		}

		const isInSession = this.callbacks.getIsInSession();
		const isHost = this.callbacks.getIsHost();
		const userInfo = isInSession
			? this.getSessionUserInfo(this.callbacks.getSessionManager())
			: this.getSoloUserInfo();

		if (!userInfo) return false;

		if (isInSession) {
			const permissions = this.callbacks.getCommentPermissions();
			if (!isHost && !permissions.viewersCanComment) {
				this.callbacks.showToast("Commenting is disabled by the host");
				return false;
			}

			if (!this.callbacks.checkRateLimit(userInfo.userId, isHost)) {
				const rateLimit = isHost ? "10 seconds" : "1 minute";
				this.callbacks.showToast(
					`Please wait before posting another comment (${rateLimit} rate limit)`,
				);
				return false;
			}
		}

		const comment: Comment = {
			id: generateUUID(),
			authorId: userInfo.userId,
			authorName: userInfo.displayName,
			authorColor: userInfo.color,
			content,
			worldX: pendingPosition.worldX,
			worldY: pendingPosition.worldY,
			createdAt: Date.now(),
			editedAt: null,
		};

		this.callbacks.addComment(comment, isInSession);
		if (isInSession) {
			this.callbacks.getSessionManager()?.getCommentSync()?.addComment(comment);
		}

		return true;
	}

	private toWorldPoint(
		clientX: number,
		clientY: number,
		canvas: HTMLCanvasElement,
		renderer: PixiRenderer,
	): WorldPoint {
		const rect = canvas.getBoundingClientRect();
		const screenX = clientX - rect.left;
		const screenY = clientY - rect.top;
		const viewportState = renderer.getViewportState();

		return {
			worldX: (screenX - viewportState.x) / viewportState.scale,
			worldY: -((screenY - viewportState.y) / viewportState.scale),
		};
	}

	private getSessionUserInfo(sessionManager: SessionManager | null): SessionUserInfo | null {
		if (!sessionManager) return null;

		const userId = sessionManager.getUserId();
		const users = sessionManager.getConnectedUsers();
		const currentUser = users.find((user) => user.id === userId);
		return {
			userId,
			displayName: currentUser?.displayName || "Anonymous",
			color: currentUser?.color || "#888888",
		};
	}

	private getSoloUserInfo(): SessionUserInfo {
		let userId = localStorage.getItem("gdsjam_userId");
		if (!userId) {
			userId = generateUUID();
			localStorage.setItem("gdsjam_userId", userId);
		}

		return {
			userId,
			displayName: "You",
			color: "#4ECDC4",
		};
	}
}
