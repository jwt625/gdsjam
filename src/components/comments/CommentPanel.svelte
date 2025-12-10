<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { formatTimestamp } from "../../lib/comments/utils";
import { collaborationStore } from "../../stores/collaborationStore";
import { commentStore } from "../../stores/commentStore";
import { getPanelZIndex, panelZIndexStore } from "../../stores/panelZIndexStore";

interface Props {
	visible?: boolean;
	onRecenterViewport?: (worldX: number, worldY: number) => void;
}

const { visible = false, onRecenterViewport }: Props = $props();

const zIndex = getPanelZIndex("comments");
const STORAGE_KEY = "comment-panel-state";

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
const userId = $derived($collaborationStore.userId);

// Sort comments chronologically (newest first)
const sortedComments = $derived(
	Array.from(comments.values()).sort((a, b) => b.createdAt - a.createdAt),
);

// Timestamp display mode
let showAbsoluteTime = $state(false);

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

// Comment actions
function handleDeleteComment(commentId: string) {
	const comment = comments.get(commentId);
	if (!comment) return;

	// Check if confirmation is needed (>140 characters)
	const needsConfirmation = comment.content.length > 140;

	if (needsConfirmation) {
		if (!confirm("Delete this comment? This action cannot be undone.")) {
			return;
		}
	}

	commentStore.deleteComment(commentId);

	// Sync to Y.js if in collaboration mode
	if (isInSession) {
		const sessionManager = $collaborationStore.sessionManager;
		const commentSync = sessionManager?.getCommentSync();
		if (commentSync) {
			commentSync.deleteComment(commentId);
		}
	}
}

function handleClearAll() {
	if (!confirm("Clear all comments? This action cannot be undone.")) {
		return;
	}

	// Delete all comments
	for (const comment of comments.values()) {
		commentStore.deleteComment(comment.id);

		// Sync to Y.js if in collaboration mode
		if (isInSession) {
			const sessionManager = $collaborationStore.sessionManager;
			const commentSync = sessionManager?.getCommentSync();
			if (commentSync) {
				commentSync.deleteComment(comment.id);
			}
		}
	}
}

function handleToggleViewerComments() {
	const newValue = !permissions.viewersCanComment;
	commentStore.updatePermissions({ ...permissions, viewersCanComment: newValue });

	// Sync to Y.js if in collaboration mode
	if (isInSession) {
		const sessionManager = $collaborationStore.sessionManager;
		const commentSync = sessionManager?.getCommentSync();
		if (commentSync) {
			commentSync.updatePermissions({ ...permissions, viewersCanComment: newValue });
		}
	}
}

function handleRecenterViewport(worldX: number, worldY: number) {
	onRecenterViewport?.(worldX, worldY);
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
							title={permissions.viewersCanComment ? "Disable viewer comments" : "Enable viewer comments"}
						>
							<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								{#if permissions.viewersCanComment}
									<!-- Unlocked icon -->
									<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
									<path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
								{:else}
									<!-- Locked icon -->
									<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
									<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
								{/if}
							</svg>
							{permissions.viewersCanComment ? "Viewers Can Comment" : "Viewers Cannot Comment"}
						</button>
						<button
							class="control-btn danger"
							onclick={handleClearAll}
							disabled={sortedComments.length === 0}
							title="Clear all comments"
						>
							<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="3 6 5 6 21 6"></polyline>
								<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
							</svg>
							Clear All
						</button>
					</div>
				{/if}

				<!-- Comment list -->
				<div class="comment-list">
					{#if sortedComments.length === 0}
						<div class="empty-state">No comments yet</div>
					{:else}
						{#each sortedComments as comment (comment.id)}
							<div class="comment-item">
								<div class="comment-header">
									<span class="author" style="color: {comment.authorColor}">{comment.authorName}</span>
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
								<div class="comment-text">{comment.content}</div>
								<div class="comment-actions">
									<button
										class="action-btn"
										onclick={() => handleRecenterViewport(comment.worldX, comment.worldY)}
										title="Recenter viewport to this comment"
									>
										<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
											<circle cx="12" cy="10" r="3"></circle>
										</svg>
										Go to
									</button>
									{#if isHost || comment.authorId === userId}
										<button
											class="action-btn delete"
											onclick={() => handleDeleteComment(comment.id)}
											title="Delete comment"
										>
											<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<polyline points="3 6 5 6 21 6"></polyline>
												<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
											</svg>
											Delete
										</button>
									{/if}
								</div>
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
	border-radius: 4px;
	box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
	overflow: hidden;
	user-select: none;
	font-family: monospace;
	font-size: 12px;
	color: #ccc;
	/* NO ANIMATIONS */
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
	/* NO ANIMATIONS */
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
	border-radius: 4px;
	color: #ccc;
	font-size: 11px;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 6px;
	/* NO ANIMATIONS */
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
	border-radius: 4px;
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

.comment-actions {
	display: flex;
	gap: 8px;
}

.action-btn {
	padding: 4px 8px;
	background: rgba(40, 40, 40, 0.6);
	border: 1px solid #444;
	border-radius: 3px;
	color: #aaa;
	font-size: 10px;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 4px;
	/* NO ANIMATIONS */
	transition: none;
}

.action-btn:hover {
	background: rgba(60, 60, 60, 0.8);
	border-color: #555;
	color: #ccc;
}

.action-btn.delete {
	background: rgba(180, 50, 50, 0.2);
	border-color: rgba(255, 100, 100, 0.2);
}

.action-btn.delete:hover {
	background: rgba(200, 60, 60, 0.4);
	border-color: rgba(255, 100, 100, 0.4);
}

.btn-icon {
	width: 14px;
	height: 14px;
	flex-shrink: 0;
}
</style>



