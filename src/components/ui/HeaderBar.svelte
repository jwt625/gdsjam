<script lang="ts">
import QRCode from "qrcode";
import { DEBUG } from "../../lib/config";
import { collaborationStore } from "../../stores/collaborationStore";
import { gdsStore } from "../../stores/gdsStore";

let showQRCode = $state(false);
let qrCodeDataUrl = $state("");

function handleCreateSession() {
	collaborationStore.createSession();
	if (DEBUG) {
		console.log("[HeaderBar] Session created. Upload a file to share it with peers.");
	}
}

function handleLeaveSession() {
	collaborationStore.leaveSession();
}

async function copySessionLink() {
	const sessionId = $collaborationStore.sessionId;
	if (!sessionId) return;

	const url = new URL(window.location.href);
	url.searchParams.set("room", sessionId);
	const link = url.toString();

	try {
		await navigator.clipboard.writeText(link);
		if (DEBUG) {
			console.log("[HeaderBar] Copied session link to clipboard:", link);
		}
	} catch (error) {
		console.error("[HeaderBar] Failed to copy session link:", error);
		gdsStore.setError("Failed to copy session link to clipboard");
	}
}

async function toggleQRCode() {
	showQRCode = !showQRCode;

	if (showQRCode && !qrCodeDataUrl) {
		const sessionId = $collaborationStore.sessionId;
		if (!sessionId) return;

		const url = new URL(window.location.href);
		url.searchParams.set("room", sessionId);
		const link = url.toString();

		try {
			qrCodeDataUrl = await QRCode.toDataURL(link, {
				width: 300,
				margin: 2,
				color: { dark: "#000000", light: "#FFFFFF" },
			});
		} catch (error) {
			console.error("[HeaderBar] Failed to generate QR code:", error);
			gdsStore.setError("Failed to generate QR code");
		}
	}
}

// Reset QR code when leaving session
$effect(() => {
	if (!$collaborationStore.isInSession) {
		showQRCode = false;
		qrCodeDataUrl = "";
	}
});
</script>

<header class="header">
	<div class="header-content">
		<div class="title-section">
			<a href="/" class="title-container">
				<img src="/icon.svg" alt="GDSJam" class="title-icon" />
				<h1 class="title">GDSJam</h1>
			</a>
			<p class="subtitle">Collaborative GDSII Viewer</p>
			{#if $gdsStore.fileName}
				<p class="file-name">Loaded: {$gdsStore.fileName}</p>
			{/if}
		</div>

		<div class="session-controls">
			{#if $collaborationStore.isInSession}
				<div class="session-info">
					<span class="session-label">Session Active</span>
					<span class="session-id">{$collaborationStore.sessionId?.substring(0, 8)}...</span>
					<span class="user-count">{$collaborationStore.connectedUsers.length} user{$collaborationStore.connectedUsers.length !== 1 ? 's' : ''}</span>
				</div>
				<button type="button" class="btn btn-secondary" onclick={copySessionLink}>Copy Link</button>
				<button type="button" class="btn btn-secondary" onclick={toggleQRCode}>
					{showQRCode ? 'Hide QR Code' : 'Show QR Code'}
				</button>
				<button type="button" class="btn btn-danger" onclick={handleLeaveSession}>Leave Session</button>
			{:else}
				<button type="button" class="btn btn-primary" onclick={handleCreateSession}>Create Session</button>
			{/if}
		</div>
	</div>
</header>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
{#if $collaborationStore.isInSession && showQRCode}
	<div class="qr-code-backdrop" onclick={() => { showQRCode = false; }}>
		<div class="qr-code-panel" onclick={(e) => e.stopPropagation()}>
			<div class="qr-code-content">
				<h3 class="qr-code-title">Scan to Join Session</h3>
				{#if qrCodeDataUrl}
					<img src={qrCodeDataUrl} alt="Session QR Code" class="qr-code-image" />
					<p class="qr-code-hint">Scan this QR code with your mobile device to join the session</p>
				{:else}
					<p class="qr-code-loading">Generating QR code...</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.header {
		padding: 1rem 1.5rem;
		background-color: #0f0f0f;
		border-bottom: 1px solid #333;
	}

	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 2rem;
	}

	.title-section {
		flex: 1;
	}

	.title-container {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		text-decoration: none;
	}

	.title-container:hover .title {
		color: #6bb3ff;
	}

	.title-icon {
		width: 2rem;
		height: 2rem;
	}

	.title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
		color: #fff;
	}

	.subtitle {
		margin: 0.25rem 0 0 0;
		font-size: 0.875rem;
		color: #888;
	}

	.file-name {
		margin: 0.5rem 0 0 0;
		font-size: 0.875rem;
		color: #4a9eff;
		font-weight: 500;
	}

	.session-controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.session-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background-color: #1a1a1a;
		border: 1px solid #333;
		border-radius: 6px;
	}

	.session-label {
		font-size: 0.75rem;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.session-id {
		font-size: 0.875rem;
		color: #4a9eff;
		font-family: monospace;
	}

	.user-count {
		font-size: 0.875rem;
		color: #4ecdc4;
		font-weight: 500;
	}

	.btn {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-primary {
		background-color: #4a9eff;
		color: #fff;
	}

	.btn-primary:hover:not(:disabled) {
		background-color: #6bb3ff;
	}

	.btn-secondary {
		background-color: #333;
		color: #fff;
	}

	.btn-secondary:hover {
		background-color: #444;
	}

	.btn-danger {
		background-color: #ff4444;
		color: #fff;
	}

	.btn-danger:hover {
		background-color: #ff6666;
	}

	.qr-code-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.5);
		z-index: 999;
		animation: fadeInBackdrop 0.2s ease-out;
	}

	@keyframes fadeInBackdrop {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.qr-code-panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		padding: 1.5rem;
		background: rgba(0, 0, 0, 0.95);
		border: 1px solid #444;
		border-radius: 8px;
		z-index: 1000;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		animation: fadeInPanel 0.2s ease-out;
	}

	@keyframes fadeInPanel {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	.qr-code-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.qr-code-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: #fff;
	}

	.qr-code-image {
		width: 300px;
		max-width: 100%;
		height: auto;
		aspect-ratio: 1;
		border: 4px solid #fff;
		border-radius: 8px;
		background-color: #fff;
	}

	.qr-code-hint {
		margin: 0;
		font-size: 0.875rem;
		color: #888;
		text-align: center;
		max-width: 300px;
	}

	.qr-code-loading {
		margin: 0;
		font-size: 0.875rem;
		color: #4a9eff;
		padding: 2rem;
	}

	@media (max-width: 1023px) {
		.header-content {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.session-controls {
			width: 100%;
			flex-wrap: wrap;
		}

		.session-info {
			flex: 1;
			min-width: 200px;
		}

		.btn {
			flex: 1;
		}
	}
</style>

