<script lang="ts">
import type { CommentWithDisplayState } from "../../lib/comments/types";
import { extractInitials, truncateText } from "../../lib/comments/utils";

interface Props {
	comment: CommentWithDisplayState;
	screenX: number;
	screenY: number;
	onClick: () => void;
}

let { comment, screenX, screenY, onClick }: Props = $props();

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
		<div class="initials">{displayContent()}</div>
	{:else}
		<div class="content">
			<div class="header">
				<span class="author">{comment.authorName}</span>
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
	
	/* Position bubble with bottom-left corner at the point */
	transform: translate(0, -100%);
	
	/* Dark theme styling */
	background: rgba(60, 60, 60, 0.95);
	border: 1px solid rgba(255, 255, 255, 0.3);
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

.initials {
	color: rgba(255, 255, 255, 0.9);
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
	gap: 8px;
}

.author {
	color: rgba(255, 255, 255, 0.9);
	font-size: 11px;
	font-weight: 600;
}

.text {
	color: rgba(255, 255, 255, 0.8);
	font-size: 11px;
	line-height: 1.4;
	white-space: pre-wrap;
	word-wrap: break-word;
}

.comment-bubble:hover {
	background: rgba(70, 70, 70, 0.95);
	border-color: rgba(255, 255, 255, 0.5);
}
</style>

