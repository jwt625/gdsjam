<script lang="ts">
import { onDestroy, onMount } from "svelte";
import type { Comment } from "../../lib/collaboration/types";
import { formatTimestamp } from "../../lib/comments/utils";
import { generateUUID } from "../../lib/utils/uuid";
import { collaborationStore } from "../../stores/collaborationStore";
import { commentStore } from "../../stores/commentStore";
import { getPanelZIndex, panelZIndexStore } from "../../stores/panelZIndexStore";

interface Props {
	visible?: boolean;
	onRecenterViewport?: (worldX: number, worldY: number) => void;
}

interface ThreadRow {
	comment: Comment;
	depth: number;
	childCount: number;
	descendantCount: number;
}

const { visible = false, onRecenterViewport }: Props = $props();

const zIndex = getPanelZIndex("comments");
const STORAGE_KEY = "comment-panel-state";
const MAX_COMMENTS = 100;
const MAX_COMMENT_CHARS = 1000;

// Panel state
let isCollapsed = $state(false);
let panelPosition = $state({ x: -1, y: -1 });
let isDragging = $state(false);
let dragStart = $state({ x: 0, y: 0 });
let mouseDownTime = $state(0);
let mouseDownPos = $state({ x: 0, y: 0 });
const CLICK_THRESHOLD_MS = 200;
const DRAG_THRESHOLD_PX = 5;

// Comment store state
const comments = $derived($commentStore.comments);
const permissions = $derived($commentStore.permissions);
const isInSession = $derived($collaborationStore.isInSession);
const isHost = $derived($collaborationStore.isHost);
const sessionManager = $derived($collaborationStore.sessionManager);
const currentUserId = $derived(
	isInSession ? ($collaborationStore.userId ?? "") : localStorage.getItem("gdsjam_userId") || "",
);

// Timestamp display mode
let showAbsoluteTime = $state(false);

// Thread UI state
let collapsedCommentIds = $state<Set<string>>(new Set());
let replyingToCommentId = $state<string | null>(null);
let replyDraft = $state("");

const sortedComments = $derived(
	Array.from(comments.values()).sort((a, b) => a.createdAt - b.createdAt),
);

const childrenByParentId = $derived(
	(() => {
		const children = new Map<string, Comment[]>();
		for (const comment of sortedComments) {
			if (!comment.parentId) continue;
			const existing = children.get(comment.parentId) ?? [];
			existing.push(comment);
			children.set(comment.parentId, existing);
		}
		return children;
	})(),
);

const descendantCountById = $derived(
	(() => {
		const memo = new Map<string, number>();
		const countDescendants = (commentId: string): number => {
			const cached = memo.get(commentId);
			if (cached !== undefined) return cached;
			const children = childrenByParentId.get(commentId) ?? [];
			let total = children.length;
			for (const child of children) {
				total += countDescendants(child.id);
			}
			memo.set(commentId, total);
			return total;
		};

		for (const comment of sortedComments) {
			countDescendants(comment.id);
		}
		return memo;
	})(),
);

const threadRows = $derived(
	(() => {
		const rows: ThreadRow[] = [];
		const roots = sortedComments.filter((comment) => comment.parentId === null);

		const walk = (comment: Comment, depth: number) => {
			const childCount = (childrenByParentId.get(comment.id) ?? []).length;
			rows.push({
				comment,
				depth,
				childCount,
				descendantCount: descendantCountById.get(comment.id) ?? 0,
			});

			if (collapsedCommentIds.has(comment.id)) return;
			for (const child of childrenByParentId.get(comment.id) ?? []) {
				walk(child, depth + 1);
			}
		};

		for (const root of roots) {
			walk(root, 0);
		}

		return rows;
	})(),
);

function getCurrentUserInfo(): { userId: string; authorName: string; authorColor: string } | null {
	if (isInSession) {
		const userId = currentUserId;
		if (!userId) return null;
		const currentUser = $collaborationStore.connectedUsers.find((u) => u.id === userId);
		return {
			userId,
			authorName: currentUser?.displayName || "Anonymous",
			authorColor: currentUser?.color || "#888888",
		};
	}

	let userId = localStorage.getItem("gdsjam_userId");
	if (!userId) {
		userId = generateUUID();
		localStorage.setItem("gdsjam_userId", userId);
	}

	return {
		userId,
		authorName: "You",
		authorColor: "#4ECDC4",
	};
}

function canCurrentUserComment(): boolean {
	if (!isInSession) return true;
	if (isHost) return true;
	return permissions.viewersCanComment;
}

function getCommentSync() {
	return sessionManager?.getCommentSync() ?? null;
}

function syncUpdatedComment(comment: Comment): void {
	if (!isInSession) return;
	getCommentSync()?.updateComment(comment);
}

function loadState() {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			const state = JSON.parse(saved);
			if (state.position) panelPosition = state.position;
			if (state.collapsed !== undefined) isCollapsed = state.collapsed;
		}
	} catch (_e) {
		/* ignore */
	}
}

function saveState() {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ position: panelPosition, collapsed: isCollapsed }),
		);
	} catch (_e) {
		/* ignore */
	}
}

function initDefaultPosition() {
	if (panelPosition.x === -1 || panelPosition.y === -1) {
		panelPosition = { x: window.innerWidth - 340, y: 100 };
	}
}

// Constrain panel position to be within viewport bounds
function constrainPosition() {
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;
	const panelWidth = 320;
	const minVisiblePx = 50;

	let newX = panelPosition.x;
	let newY = panelPosition.y;

	if (newX + panelWidth < minVisiblePx) {
		newX = minVisiblePx - panelWidth;
	}
	if (newX > viewportWidth - minVisiblePx) {
		newX = viewportWidth - minVisiblePx;
	}
	if (newY < 0) {
		newY = 0;
	}
	if (newY > viewportHeight - minVisiblePx) {
		newY = viewportHeight - minVisiblePx;
	}

	if (newX !== panelPosition.x || newY !== panelPosition.y) {
		panelPosition = { x: newX, y: newY };
		saveState();
	}
}

function handleWindowResize() {
	constrainPosition();
}

// Drag handlers
function handlePointerStart(clientX: number, clientY: number) {
	mouseDownTime = Date.now();
	mouseDownPos = { x: clientX, y: clientY };
	dragStart = { x: clientX - panelPosition.x, y: clientY - panelPosition.y };
}

function handlePointerMove(clientX: number, clientY: number) {
	const dx = Math.abs(clientX - mouseDownPos.x);
	const dy = Math.abs(clientY - mouseDownPos.y);
	if (!isDragging && (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX)) isDragging = true;
	if (isDragging) panelPosition = { x: clientX - dragStart.x, y: clientY - dragStart.y };
}

function handlePointerEnd(clientX: number, clientY: number) {
	const elapsed = Date.now() - mouseDownTime;
	const dx = Math.abs(clientX - mouseDownPos.x);
	const dy = Math.abs(clientY - mouseDownPos.y);

	if (elapsed < CLICK_THRESHOLD_MS && dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) {
		isCollapsed = !isCollapsed;
	}

	isDragging = false;
	saveState();
}

// Mouse handlers
function handleHeaderMouseDown(e: MouseEvent) {
	handlePointerStart(e.clientX, e.clientY);
	window.addEventListener("mousemove", handleMouseMove);
	window.addEventListener("mouseup", handleMouseUp);
}

function handleMouseMove(e: MouseEvent) {
	handlePointerMove(e.clientX, e.clientY);
}

function handleMouseUp(e: MouseEvent) {
	window.removeEventListener("mousemove", handleMouseMove);
	window.removeEventListener("mouseup", handleMouseUp);
	handlePointerEnd(e.clientX, e.clientY);
}

// Touch handlers
function handleHeaderTouchStart(e: TouchEvent) {
	if (e.touches.length !== 1) return;
	const touch = e.touches[0]!;
	handlePointerStart(touch.clientX, touch.clientY);
	window.addEventListener("touchmove", handleTouchMove);
	window.addEventListener("touchend", handleTouchEnd);
	window.addEventListener("touchcancel", handleTouchEnd);
}

function handleTouchMove(e: TouchEvent) {
	if (e.touches.length !== 1) return;
	e.preventDefault();
	const touch = e.touches[0]!;
	handlePointerMove(touch.clientX, touch.clientY);
}

function handleTouchEnd(e: TouchEvent) {
	e.preventDefault();
	window.removeEventListener("touchmove", handleTouchMove);
	window.removeEventListener("touchend", handleTouchEnd);
	window.removeEventListener("touchcancel", handleTouchEnd);
	const touch = e.changedTouches[0]!;
	handlePointerEnd(touch.clientX, touch.clientY);
}

function toggleFold(commentId: string): void {
	const next = new Set(collapsedCommentIds);
	if (next.has(commentId)) {
		next.delete(commentId);
	} else {
		next.add(commentId);
	}
	collapsedCommentIds = next;
}

function handleSoftDeleteComment(commentId: string): void {
	const comment = comments.get(commentId);
	if (!comment || comment.deleted) return;

	const needsConfirmation = comment.content.length > 140;
	if (needsConfirmation && !confirm("Delete this comment?")) {
		return;
	}

	const deletedAt = Date.now();
	const updatedComment: Comment = {
		...comment,
		content: "[deleted]",
		deleted: true,
		deletedAt,
		editedAt: deletedAt,
	};

	commentStore.updateComment(updatedComment, isInSession);
	syncUpdatedComment(updatedComment);
}

function handleDeleteThread(rootId: string): void {
	if (!isHost) return;
	if (!confirm("Delete this whole thread?")) return;

	for (const comment of comments.values()) {
		if (comment.rootId !== rootId || comment.deleted) continue;
		const deletedAt = Date.now();
		const updatedComment: Comment = {
			...comment,
			content: "[deleted]",
			deleted: true,
			deletedAt,
			editedAt: deletedAt,
		};
		commentStore.updateComment(updatedComment, isInSession);
		syncUpdatedComment(updatedComment);
	}
}

function handleClearAll() {
	if (!confirm("Soft-delete all comments?")) {
		return;
	}

	for (const comment of comments.values()) {
		if (comment.deleted) continue;
		const deletedAt = Date.now();
		const updatedComment: Comment = {
			...comment,
			content: "[deleted]",
			deleted: true,
			deletedAt,
			editedAt: deletedAt,
		};
		commentStore.updateComment(updatedComment, isInSession);
		syncUpdatedComment(updatedComment);
	}
}

function handleToggleViewerComments() {
	const newValue = !permissions.viewersCanComment;
	commentStore.updatePermissions({ ...permissions, viewersCanComment: newValue });

	// Sync to Y.js if in collaboration mode
	if (isInSession) {
		getCommentSync()?.updatePermissions({ ...permissions, viewersCanComment: newValue });
	}
}

function handleRecenterViewport(worldX: number, worldY: number) {
	onRecenterViewport?.(worldX, worldY);
}

function startReply(commentId: string): void {
	if (!canCurrentUserComment()) {
		commentStore.showToast("Commenting is disabled by the host");
		return;
	}
	replyingToCommentId = commentId;
	replyDraft = "";
}

function cancelReply(): void {
	replyingToCommentId = null;
	replyDraft = "";
}

function submitReply(parentComment: Comment): void {
	const trimmed = replyDraft.trim();
	if (!trimmed) return;
	if (trimmed.length > MAX_COMMENT_CHARS) {
		commentStore.showToast(`Comment is too long (${MAX_COMMENT_CHARS} character max)`);
		return;
	}
	if (comments.size >= MAX_COMMENTS) {
		commentStore.showToast("Comment limit reached (100 comments maximum)");
		return;
	}

	const userInfo = getCurrentUserInfo();
	if (!userInfo) return;

	if (isInSession) {
		if (!isHost && !permissions.viewersCanComment) {
			commentStore.showToast("Commenting is disabled by the host");
			return;
		}
		if (!commentStore.checkRateLimit(userInfo.userId, isHost)) {
			const rateLimit = isHost ? "10 seconds" : "1 minute";
			commentStore.showToast(
				`Please wait before posting another comment (${rateLimit} rate limit)`,
			);
			return;
		}
	}

	const replyComment: Comment = {
		id: generateUUID(),
		authorId: userInfo.userId,
		authorName: userInfo.authorName,
		authorColor: userInfo.authorColor,
		content: trimmed,
		worldX: parentComment.worldX,
		worldY: parentComment.worldY,
		createdAt: Date.now(),
		editedAt: null,
		parentId: parentComment.id,
		rootId: parentComment.rootId,
		deleted: false,
		deletedAt: null,
	};

	commentStore.addComment(replyComment, isInSession);
	if (isInSession) {
		getCommentSync()?.addComment(replyComment);
	}

	cancelReply();
}

onMount(() => {
	loadState();
	initDefaultPosition();
	window.addEventListener("resize", handleWindowResize);
});

onDestroy(() => {
	window.removeEventListener("resize", handleWindowResize);
});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if visible}
	<div
		class="comment-panel"
		class:collapsed={isCollapsed}
		class:dragging={isDragging}
		style="left: {panelPosition.x}px; top: {panelPosition.y}px; z-index: {$zIndex};"
		onmousedown={() => panelZIndexStore.bringToFront("comments")}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="panel-header"
			onmousedown={handleHeaderMouseDown}
			ontouchstart={handleHeaderTouchStart}
			role="button"
			tabindex="0"
			aria-expanded={!isCollapsed}
		>
			<h3>Comments ({sortedComments.length})</h3>
			<svg class="chevron-icon" class:rotated={isCollapsed} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</div>

		{#if !isCollapsed}
			<div class="panel-content">
				<!-- Host controls -->
				{#if isHost}
					<div class="host-controls">
						<button
							class="control-btn"
							onclick={handleToggleViewerComments}
							title={permissions.viewersCanComment ? "Disable viewer comments and replies" : "Enable viewer comments and replies"}
						>
							<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								{#if permissions.viewersCanComment}
									<rect x="3" y="11" width="18" height="11" rx="0" ry="0"></rect>
									<path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
								{:else}
									<rect x="3" y="11" width="18" height="11" rx="0" ry="0"></rect>
									<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
								{/if}
							</svg>
							{permissions.viewersCanComment ? "Viewers Can Comment/Reply" : "Viewers Cannot Comment/Reply"}
						</button>
						<button
							class="control-btn danger"
							onclick={handleClearAll}
							disabled={sortedComments.length === 0}
							title="Soft-delete all comments"
						>
							<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="3 6 5 6 21 6"></polyline>
								<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
							</svg>
							Soft Delete All
						</button>
					</div>
				{/if}

				<div class="comment-list">
					{#if sortedComments.length === 0}
						<div class="empty-state">No comments yet</div>
					{:else}
						{#each threadRows as row (row.comment.id)}
							{@const comment = row.comment}
							<div class="comment-item" style="margin-left: {Math.min(row.depth, 10) * 14}px;">
								<div class="comment-header">
									<div class="header-left">
										{#if row.childCount > 0}
											<button
												class="fold-btn"
												onclick={() => toggleFold(comment.id)}
												title={collapsedCommentIds.has(comment.id) ? "Unfold replies" : "Fold replies"}
											>
												{collapsedCommentIds.has(comment.id) ? "+" : "-"}
											</button>
										{/if}
										<span class="author" style="color: {comment.authorColor}">{comment.authorName}</span>
									</div>
									<span
										class="timestamp"
										onclick={() => { showAbsoluteTime = !showAbsoluteTime; }}
										onkeydown={(e) => e.key === 'Enter' && (showAbsoluteTime = !showAbsoluteTime)}
										role="button"
										tabindex="0"
										title="Click to toggle between absolute and relative time"
									>
										{formatTimestamp(comment.createdAt, showAbsoluteTime ? "absolute" : "relative")}
									</span>
								</div>

								<div class="comment-text" class:deleted={comment.deleted}>{comment.content}</div>

								<div class="comment-actions">
									<button
										class="action-btn"
										onclick={() => handleRecenterViewport(comment.worldX, comment.worldY)}
										title="Recenter viewport to this thread anchor"
									>
										<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
											<circle cx="12" cy="10" r="3"></circle>
										</svg>
										Go to
									</button>

									<button
										class="action-btn"
										onclick={() => startReply(comment.id)}
										disabled={!canCurrentUserComment()}
										title={canCurrentUserComment() ? "Reply to this comment" : "Replies are disabled by host"}
									>
										Reply
									</button>

									{#if row.descendantCount > 0}
										<span class="thread-meta">{row.descendantCount} replies</span>
									{/if}

									{#if isHost || comment.authorId === currentUserId}
										<button
											class="action-btn delete"
											onclick={() => handleSoftDeleteComment(comment.id)}
											disabled={comment.deleted}
											title="Soft-delete comment"
										>
											Delete
										</button>
									{/if}

									{#if isHost && comment.parentId === null}
										<button
											class="action-btn danger"
											onclick={() => handleDeleteThread(comment.rootId)}
											title="Host: soft-delete whole thread"
										>
											Delete Thread
										</button>
									{/if}
								</div>

								{#if replyingToCommentId === comment.id}
									<div class="reply-composer">
										<textarea
											bind:value={replyDraft}
											maxlength={MAX_COMMENT_CHARS}
											placeholder="Write a reply..."
											rows="3"
										></textarea>
										<div class="reply-actions">
											<button class="action-btn" onclick={() => submitReply(comment)}>
												Post Reply
											</button>
											<button class="action-btn" onclick={cancelReply}>
												Cancel
											</button>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
.comment-panel {
	position: absolute;
	width: 320px;
	max-height: 600px;
	background: rgba(0, 0, 0, 0.9);
	border: 1px solid #444;
	border-radius: 0;
	box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
	overflow: hidden;
	user-select: none;
	font-family: monospace;
	font-size: 12px;
	color: #ccc;
	transition: none;
}

.comment-panel.dragging {
	cursor: move;
	opacity: 0.9;
}

.panel-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px;
	border-bottom: 1px solid #444;
	cursor: grab;
}

.panel-header h3 {
	margin: 0;
	font-size: 12px;
	font-weight: normal;
	color: #ccc;
}

.chevron-icon {
	width: 16px;
	height: 16px;
	color: #ccc;
	transition: none;
}

.chevron-icon.rotated {
	transform: rotate(-90deg);
}

.panel-content {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 12px;
	max-height: 540px;
	overflow-y: auto;
	-webkit-overflow-scrolling: touch;
	overscroll-behavior: contain;
}

.host-controls {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding-bottom: 12px;
	border-bottom: 1px solid #444;
}

.control-btn {
	padding: 8px 12px;
	background: rgba(40, 40, 40, 0.8);
	border: 1px solid #555;
	border-radius: 0;
	color: #ccc;
	font-size: 11px;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 6px;
	transition: none;
}

.control-btn:hover:not(:disabled) {
	background: rgba(60, 60, 60, 0.9);
	border-color: #666;
}

.control-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.control-btn.danger {
	background: rgba(180, 50, 50, 0.3);
	border-color: rgba(255, 100, 100, 0.3);
}

.control-btn.danger:hover:not(:disabled) {
	background: rgba(200, 60, 60, 0.5);
	border-color: rgba(255, 100, 100, 0.5);
}

.comment-list {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.empty-state {
	padding: 24px;
	text-align: center;
	color: #888;
	font-size: 11px;
}

.comment-item {
	padding: 10px;
	background: rgba(20, 20, 20, 0.6);
	border: 1px solid #333;
	border-radius: 0;
}

.comment-item:hover {
	background: rgba(255, 255, 255, 0.05);
}

.comment-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 6px;
}

.header-left {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.fold-btn {
	width: 18px;
	height: 18px;
	padding: 0;
	background: rgba(50, 50, 50, 0.9);
	border: 1px solid #555;
	border-radius: 0;
	color: #ccc;
	font-size: 11px;
	cursor: pointer;
}

.author {
	font-size: 11px;
	font-weight: 600;
}

.timestamp {
	font-size: 10px;
	color: #888;
	cursor: pointer;
	white-space: nowrap;
	flex-shrink: 0;
}

.timestamp:hover {
	color: #aaa;
}

.comment-text {
	font-size: 11px;
	color: #aaa;
	line-height: 1.4;
	white-space: pre-wrap;
	word-wrap: break-word;
	margin-bottom: 8px;
}

.comment-text.deleted {
	color: #777;
	font-style: italic;
}

.comment-actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

.thread-meta {
	display: inline-flex;
	align-items: center;
	color: #888;
	font-size: 10px;
}

.action-btn {
	padding: 4px 8px;
	background: rgba(40, 40, 40, 0.6);
	border: 1px solid #444;
	border-radius: 0;
	color: #aaa;
	font-size: 10px;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 4px;
	transition: none;
}

.action-btn:hover:not(:disabled) {
	background: rgba(60, 60, 60, 0.8);
	border-color: #555;
	color: #ccc;
}

.action-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.action-btn.delete {
	background: rgba(120, 40, 40, 0.35);
	border-color: rgba(255, 100, 100, 0.25);
}

.action-btn.danger {
	background: rgba(140, 45, 45, 0.45);
	border-color: rgba(255, 110, 110, 0.35);
}

.reply-composer {
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid #333;
}

.reply-composer textarea {
	width: 100%;
	resize: vertical;
	min-height: 56px;
	background: rgba(10, 10, 10, 0.9);
	border: 1px solid #444;
	border-radius: 0;
	color: #ccc;
	font-family: monospace;
	font-size: 11px;
	padding: 6px;
	box-sizing: border-box;
}

.reply-actions {
	display: flex;
	gap: 8px;
	margin-top: 6px;
}

.btn-icon {
	width: 12px;
	height: 12px;
	flex-shrink: 0;
}

@media (max-width: 1023px) {
	.comment-panel {
		width: min(320px, calc(100vw - 32px));
		max-height: calc(100vh - 120px);
	}
}
</style>
