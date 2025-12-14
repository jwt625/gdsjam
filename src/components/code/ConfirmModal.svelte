<script lang="ts">
/**
 * ConfirmModal - Minimal confirmation dialog
 *
 * Features:
 * - Simple yes/no confirmation
 * - Instant transitions (no animations)
 * - Keyboard support (Enter = confirm, Escape = cancel)
 */

interface Props {
	message: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

const {
	message,
	confirmText = "Confirm",
	cancelText = "Cancel",
	onConfirm,
	onCancel,
}: Props = $props();

// Handle keyboard shortcuts
function handleKeydown(event: KeyboardEvent) {
	if (event.key === "Enter") {
		event.preventDefault();
		onConfirm();
	} else if (event.key === "Escape") {
		event.preventDefault();
		onCancel();
	}
}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={onCancel}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-content" onclick={(e) => e.stopPropagation()}>
		<p class="modal-message">{message}</p>
		<div class="modal-actions">
			<button class="cancel-button" onclick={onCancel} type="button">
				{cancelText}
			</button>
			<button class="confirm-button" onclick={onConfirm} type="button">
				{confirmText}
			</button>
		</div>
	</div>
</div>

<style>
.modal-overlay {
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
	background: #252526;
	border: 1px solid #3e3e42;
	border-radius: 4px;
	padding: 24px;
	min-width: 300px;
	max-width: 500px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.modal-message {
	color: #d4d4d4;
	font-size: 14px;
	line-height: 1.5;
	margin: 0 0 20px 0;
}

.modal-actions {
	display: flex;
	gap: 12px;
	justify-content: flex-end;
}

.cancel-button,
.confirm-button {
	padding: 8px 16px;
	border: none;
	border-radius: 3px;
	font-size: 13px;
	cursor: pointer;
	transition: background-color 0.1s;
}

.cancel-button {
	background: #3e3e42;
	color: #d4d4d4;
}

.cancel-button:hover {
	background: #4e4e52;
}

.confirm-button {
	background: #0e639c;
	color: #ffffff;
}

.confirm-button:hover {
	background: #1177bb;
}

.cancel-button:active,
.confirm-button:active {
	transform: translateY(1px);
}
</style>

