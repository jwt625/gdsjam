<script lang="ts">
import type { CommentWithDisplayState } from "../../lib/comments/types";
import { extractInitials, formatTimestamp, truncateText } from "../../lib/comments/utils";

interface Props {
	comment: CommentWithDisplayState;
	screenX: number;
	screenY: number;
	onClick: () => void;
}

let { comment, screenX, screenY, onClick }: Props = $props();

// Timestamp display mode (toggles between absolute and relative)
let showAbsoluteTime = $state(false);

// Get display content based on state
const displayContent = $derived(() => {
	switch (comment.displayState) {
		case "minimal":
			return extractInitials(comment.authorName);
		case "preview":
			return truncateText(comment.content, 140);
		case "full":
			return comment.content;
	}
});

const isMinimal = $derived(comment.displayState === "minimal");
const isPreview = $derived(comment.displayState === "preview");
const isFull = $derived(comment.displayState === "full");

// Format timestamp based on current mode
const formattedTimestamp = $derived(
	formatTimestamp(comment.createdAt, showAbsoluteTime ? "absolute" : "relative"),
);

// Toggle timestamp format
function handleTimestampClick(event: MouseEvent | KeyboardEvent): void {
	event.stopPropagation(); // Prevent bubble click
	showAbsoluteTime = !showAbsoluteTime;
}
</script>

<div
	class="comment-bubble"
	class:minimal={isMinimal}
	class:preview={isPreview}
	class:full={isFull}
	style="left: {screenX}px; top: {screenY}px;"
	onclick={onClick}
	onkeydown={(e) => e.key === 'Enter' && onClick()}
	role="button"
	tabindex="0"
>
	{#if isMinimal}
		<div class="initials" style="color: {comment.authorColor}">{displayContent()}</div>
	{:else}
		<div class="content">
			<div class="header">
				<span class="author" style="color: {comment.authorColor}">{comment.authorName}</span>
				<span
					class="timestamp"
					onclick={handleTimestampClick}
					onkeydown={(e) => e.key === 'Enter' && handleTimestampClick(e)}
					role="button"
					tabindex="0"
					title="Click to toggle between absolute and relative time"
				>
					{formattedTimestamp}
				</span>
			</div>
			<div class="text">{displayContent()}</div>
		</div>
	{/if}
</div>

<style>
.comment-bubble {
	position: absolute;
	pointer-events: auto;
	cursor: pointer;
	user-select: none;
	z-index: 100;

	/* Position bubble with bottom-left corner at the point */
	transform: translate(0, -100%);

	/* Dark theme styling - match other panels */
	background: rgba(0, 0, 0, 0.9);
	border: 1px solid #444;
	border-radius: 4px;

	/* NO ANIMATIONS */
	transition: none;
}

.comment-bubble.minimal {
	width: 24px;
	height: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
}

.comment-bubble.preview,
.comment-bubble.full {
	max-width: 300px;
	padding: 8px 12px;
}

/* Triangle pointer at bottom-left corner for expanded states */
.comment-bubble.preview::after,
.comment-bubble.full::after {
	content: '';
	position: absolute;
	bottom: -6px;
	left: 8px;
	width: 0;
	height: 0;
	border-left: 6px solid transparent;
	border-right: 6px solid transparent;
	border-top: 6px solid rgba(0, 0, 0, 0.9);
	/* NO ANIMATIONS */
	transition: none;
}

/* Triangle border for pointer */
.comment-bubble.preview::before,
.comment-bubble.full::before {
	content: '';
	position: absolute;
	bottom: -7px;
	left: 7px;
	width: 0;
	height: 0;
	border-left: 7px solid transparent;
	border-right: 7px solid transparent;
	border-top: 7px solid #444;
	/* NO ANIMATIONS */
	transition: none;
}

.initials {
	/* Color set via inline style from comment.authorColor */
	font-size: 10px;
	font-weight: 600;
	text-transform: uppercase;
}

.content {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.author {
	/* Color set via inline style from comment.authorColor */
	font-size: 11px;
	font-weight: 600;
}

.timestamp {
	color: rgba(255, 255, 255, 0.6);
	font-size: 10px;
	cursor: pointer;
	user-select: none;
	white-space: nowrap;
	flex-shrink: 0;
}

.timestamp:hover {
	color: rgba(255, 255, 255, 0.8);
}

.text {
	color: #ccc;
	font-size: 11px;
	line-height: 1.4;
	white-space: pre-wrap;
	word-wrap: break-word;
}

.comment-bubble:hover {
	background: rgba(20, 20, 20, 0.95);
	border-color: #666;
}

/* Update triangle color on hover */
.comment-bubble.preview:hover::after,
.comment-bubble.full:hover::after {
	border-top-color: rgba(20, 20, 20, 0.95);
}

.comment-bubble.preview:hover::before,
.comment-bubble.full:hover::before {
	border-top-color: #666;
}
</style>

