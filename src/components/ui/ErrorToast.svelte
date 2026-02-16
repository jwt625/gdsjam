<script lang="ts">
interface Props {
	message: string;
	onDismiss: () => void;
}

const { message, onDismiss }: Props = $props();
</script>

<div class="error-toast">
	<div class="error-content">
		<p class="error-title">Error</p>
		<p class="error-message">{message}</p>
		<button type="button" class="error-button" onclick={onDismiss}>Dismiss</button>
	</div>
</div>

<style>
	.error-toast {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 200;
	}

	.error-content {
		background-color: #3a1a1a;
		border: 1px solid #ff4444;
		border-radius: 0;
		padding: 1rem 1.5rem;
		max-width: 500px;
		max-height: 80vh;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.error-title {
		margin: 0 0 0.5rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #ff6666;
	}

	.error-message {
		margin: 0 0 1rem 0;
		font-size: 0.875rem;
		color: #ffaaaa;
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.error-button {
		background-color: #ff4444;
		color: #fff;
		border: none;
		border-radius: 0;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.error-button:hover {
		background-color: #ff6666;
	}
</style>

