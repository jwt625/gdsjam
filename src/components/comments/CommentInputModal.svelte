<script lang="ts">
/**
 * CommentInputModal - Modal dialog for creating/editing comments
 *
 * Features:
 * - Character limit: 1000 characters
 * - Character counter
 * - ESC to cancel
 * - Enter to submit (Shift+Enter for newline)
 * - Click outside to cancel
 * - No animations (instant display)
 */

interface Props {
	visible: boolean;
	onSubmit: (content: string) => void;
	onCancel: () => void;
	initialContent?: string;
}

let { visible = $bindable(false), onSubmit, onCancel, initialContent = "" }: Props = $props();

const MAX_CHARS = 1000;
let content = $state(initialContent);
let textareaElement: HTMLTextAreaElement | null = $state(null);

// Character count
const charCount = $derived(content.length);
const charsRemaining = $derived(MAX_CHARS - charCount);
const isOverLimit = $derived(charCount > MAX_CHARS);

/**
 * Handle form submission
 */
function handleSubmit() {
	if (content.trim().length === 0) {
		handleCancel();
		return;
	}

	if (isOverLimit) {
		return;
	}

	onSubmit(content.trim());
	content = "";
	visible = false;
}

/**
 * Handle cancel
 */
function handleCancel() {
	content = "";
	visible = false;
	onCancel();
}

/**
 * Handle keyboard events in textarea
 */
function handleTextareaKeyDown(event: KeyboardEvent) {
	// Stop propagation to prevent global keyboard shortcuts from interfering
	event.stopPropagation();

	// ESC to cancel
	if (event.key === "Escape") {
		event.preventDefault();
		handleCancel();
		return;
	}

	// Enter to submit (Shift+Enter for newline)
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		handleSubmit();
		return;
	}

	// Allow all other keys (space, Ctrl+C, Ctrl+V, etc.) to work normally
}

/**
 * Handle keyboard events on backdrop (for ESC when not focused on textarea)
 */
function handleBackdropKeyDown(event: KeyboardEvent) {
	// Only handle ESC at backdrop level
	if (event.key === "Escape") {
		event.preventDefault();
		handleCancel();
	}
}

/**
 * Handle backdrop click (click outside modal)
 */
function handleBackdropClick(event: MouseEvent) {
	if (event.target === event.currentTarget) {
		handleCancel();
	}
}

/**
 * Focus textarea when modal becomes visible
 */
$effect(() => {
	if (visible && textareaElement) {
		textareaElement.focus();
	}
});
</script>

{#if visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={handleBackdropClick} onkeydown={handleBackdropKeyDown}>
		<div class="modal-content">
			<h3>Add Comment</h3>
			<textarea
				bind:this={textareaElement}
				bind:value={content}
				placeholder="Enter your comment..."
				maxlength={MAX_CHARS}
				onkeydown={handleTextareaKeyDown}
			></textarea>
			<div class="modal-footer">
				<div class="char-counter" class:over-limit={isOverLimit}>
					{charCount} / {MAX_CHARS}
					{#if isOverLimit}
						<span class="error-text">({Math.abs(charsRemaining)} over limit)</span>
					{/if}
				</div>
				<div class="button-group">
					<button type="button" class="cancel-btn" onclick={handleCancel}>Cancel (ESC)</button>
					<button type="button" class="submit-btn" onclick={handleSubmit} disabled={isOverLimit || content.trim().length === 0}>
						Submit (Enter)
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
	}

	.modal-content {
		background: rgba(0, 0, 0, 0.95);
		border: 1px solid #444;
		border-radius: 4px;
		padding: 20px;
		min-width: 400px;
		max-width: 600px;
		width: 90%;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-family: monospace;
		color: #ccc;
	}

	h3 {
		margin: 0;
		font-size: 16px;
		font-weight: bold;
		color: #fff;
	}

	textarea {
		width: 100%;
		min-height: 120px;
		max-height: 300px;
		padding: 10px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid #555;
		border-radius: 4px;
		color: #fff;
		font-family: monospace;
		font-size: 14px;
		resize: vertical;
		outline: none;
	}

	textarea:focus {
		border-color: #4ecdc4;
	}

	.modal-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}

	.char-counter {
		font-size: 12px;
		color: #888;
	}

	.char-counter.over-limit {
		color: #ff6b6b;
		font-weight: bold;
	}

	.error-text {
		color: #ff6b6b;
		margin-left: 4px;
	}

	.button-group {
		display: flex;
		gap: 8px;
	}

	button {
		padding: 8px 16px;
		border: 1px solid #555;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.05);
		color: #ccc;
		font-family: monospace;
		font-size: 12px;
		cursor: pointer;
		transition: all 0.1s;
	}

	button:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		border-color: #4ecdc4;
		color: #fff;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.submit-btn {
		background: rgba(78, 205, 196, 0.2);
		border-color: #4ecdc4;
		color: #4ecdc4;
	}

	.submit-btn:hover:not(:disabled) {
		background: rgba(78, 205, 196, 0.3);
		color: #fff;
	}

	.cancel-btn:hover {
		border-color: #ff6b6b;
		color: #ff6b6b;
	}

	/* Mobile responsive */
	@media (max-width: 600px) {
		.modal-content {
			min-width: unset;
			width: 95%;
			padding: 16px;
		}

		.modal-footer {
			flex-direction: column;
			align-items: stretch;
		}

		.button-group {
			width: 100%;
		}

		button {
			flex: 1;
		}
	}
</style>

