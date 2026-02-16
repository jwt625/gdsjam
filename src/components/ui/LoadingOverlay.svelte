<script lang="ts">
interface Props {
	message: string;
	progress: number;
}

const { message, progress }: Props = $props();
</script>

<div class="loading-overlay">
	<div class="loading-content">
		<div class="spinner"></div>
		<p class="loading-message">{message}</p>
		<div class="progress-bar">
			<div class="progress-fill" style="width: {progress}%"></div>
		</div>
		<p class="progress-text">{Math.round(progress)}%</p>
	</div>
</div>

<style>
	.loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: rgba(26, 26, 26, 0.95);
		z-index: 100;
	}

	.loading-content {
		text-align: center;
		max-width: 400px;
	}

	.spinner {
		width: 48px;
		height: 48px;
		border: 4px solid #333;
		border-top-color: #4a9eff;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin: 0 auto 1rem;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-message {
		margin: 0 0 1rem 0;
		font-size: 1rem;
		color: #ccc;
	}

	.progress-bar {
		width: 100%;
		height: 8px;
		background-color: #333;
		border-radius: 0;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.progress-fill {
		height: 100%;
		background-color: #4a9eff;
		transition: width 0.1s linear;
	}

	.progress-text {
		margin: 0;
		font-size: 0.875rem;
		color: #888;
	}
</style>
