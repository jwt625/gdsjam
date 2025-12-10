<script lang="ts">
import QRCode from "qrcode";
import type { YjsParticipant } from "../../lib/collaboration/types";
import { loadGDSIIFromBuffer } from "../../lib/utils/gdsLoader";
import { collaborationStore } from "../../stores/collaborationStore";
import { gdsStore } from "../../stores/gdsStore";
import DesktopFileControls from "./DesktopFileControls.svelte";

let showQRCode = $state(false);
let qrCodeDataUrl = $state("");

// File upload
let fileInputElement: HTMLInputElement;

// Leave session dialog state
let showLeaveDialog = $state(false);
let participants = $state<YjsParticipant[]>([]);
let selectedNewHost = $state<string | null>(null);

async function handleCreateSession() {
	try {
		await collaborationStore.createSession();
	} catch (error) {
		console.error("[HeaderBar] Failed to create session:", error);
		gdsStore.setError(
			`Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function handleLeaveSession() {
	// If host with other users, show confirmation dialog
	if ($collaborationStore.isHost && $collaborationStore.connectedUsers.length > 1) {
		// Get participants for the dialog
		const sessionManager = collaborationStore.getSessionManager();
		if (sessionManager) {
			const participantManager = sessionManager.getParticipantManager();
			const currentUserId = $collaborationStore.userId;
			// Get all participants except self
			participants = participantManager.getParticipants().filter((p) => p.userId !== currentUserId);
			// Pre-select the oldest participant (first in list)
			selectedNewHost = participants[0]?.userId ?? null;
		}
		showLeaveDialog = true;
	} else {
		// Not host or no other users, leave directly
		collaborationStore.leaveSession();
	}
}

function confirmLeave() {
	// Transfer host if a new host is selected
	if (selectedNewHost) {
		collaborationStore.transferHost(selectedNewHost);
	}
	// Leave the session
	collaborationStore.leaveSession();
	cancelLeave();
}

function leaveWithoutTransfer() {
	// Just leave - auto-promotion will handle the rest
	collaborationStore.leaveSession();
	cancelLeave();
}

function cancelLeave() {
	showLeaveDialog = false;
	selectedNewHost = null;
	participants = [];
}

async function copySessionLink() {
	const sessionId = $collaborationStore.sessionId;
	if (!sessionId) return;

	const url = new URL(window.location.href);
	url.searchParams.set("room", sessionId);
	const link = url.toString();

	try {
		await navigator.clipboard.writeText(link);
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

// Determine if upload button should be shown
// Show when: layout rendered AND (not in session OR is host)
const canUpload = $derived(
	$gdsStore.document !== null && (!$collaborationStore.isInSession || $collaborationStore.isHost),
);

/**
 * Trigger file input click
 */
function triggerFileInput() {
	fileInputElement.click();
}

/**
 * Handle file input change
 */
async function handleFileInput(event: Event) {
	const target = event.target as HTMLInputElement;
	const file = target.files?.[0];
	if (!file) return;

	try {
		gdsStore.setLoading(true, "Reading file...", 0);

		const arrayBuffer = await file.arrayBuffer();

		// Load file locally first
		await loadGDSIIFromBuffer(arrayBuffer, file.name);

		// If in a session and is host, upload file to session
		if ($collaborationStore.isInSession && $collaborationStore.isHost) {
			try {
				await collaborationStore.uploadFile(arrayBuffer, file.name);
			} catch (error) {
				console.error("[HeaderBar] Failed to upload file to session:", error);
				gdsStore.setError(
					`File loaded locally but failed to upload to session: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} else if (!$collaborationStore.isInSession) {
			// Not in a session - store locally only (NO server upload)
			// File will be uploaded when session is created

			try {
				collaborationStore.storePendingFile(arrayBuffer, file.name);
			} catch (error) {
				console.error("[HeaderBar] Failed to store pending file:", error);
				// Don't show error - file is loaded locally, just won't be shareable
			}
		}
	} catch (error) {
		console.error("[HeaderBar] Failed to read file:", error);
		gdsStore.setError(
			`Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// Reset file input so the same file can be uploaded again
	target.value = "";
}
</script>

<!-- Hidden file input for upload button -->
<input
	type="file"
	accept=".gds,.gdsii,.dxf"
	bind:this={fileInputElement}
	onchange={handleFileInput}
	style="display: none;"
/>

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
			<!-- Desktop file controls (Tauri only) -->
			<DesktopFileControls />

			{#if canUpload}
				<button type="button" class="btn btn-upload" onclick={triggerFileInput}>
					<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
					</svg>
					Upload File
				</button>
			{/if}
			{#if $collaborationStore.isInSession}
				<div class="session-info">
					<span class="role-badge" class:host={$collaborationStore.isHost}>
						{$collaborationStore.isHost ? 'Host' : 'Viewer'}
					</span>
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

<!-- Leave Session Confirmation Dialog -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
{#if showLeaveDialog}
	<div class="dialog-backdrop" onclick={cancelLeave}>
		<div class="dialog-panel" onclick={(e) => e.stopPropagation()}>
			<h3 class="dialog-title">Leave Session</h3>
			<p class="dialog-message">
				You are the host. Before leaving, you can transfer host status to another participant.
			</p>

			{#if participants.length > 0}
				<div class="participant-select">
					<label for="new-host-select">Transfer host to:</label>
					<select id="new-host-select" bind:value={selectedNewHost}>
						{#each participants as participant}
							<option value={participant.userId}>
								{participant.displayName}
							</option>
						{/each}
					</select>
				</div>
			{:else}
				<p class="dialog-note">No other participants to transfer to.</p>
			{/if}

			<div class="dialog-actions">
				<button type="button" class="btn btn-secondary" onclick={cancelLeave}>
					Cancel
				</button>
				<button type="button" class="btn btn-warning" onclick={leaveWithoutTransfer}>
					Leave Without Transfer
				</button>
				{#if participants.length > 0 && selectedNewHost}
					<button type="button" class="btn btn-primary" onclick={confirmLeave}>
						Transfer & Leave
					</button>
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
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		text-decoration: none;
		width: fit-content;
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

	.role-badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		background-color: #333;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.role-badge.host {
		background-color: #4a9eff;
		color: #fff;
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

	.btn-upload {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background-color: #2d5a3d;
		color: #fff;
	}

	.btn-upload:hover {
		background-color: #3a7350;
	}

	.btn-icon {
		width: 1rem;
		height: 1rem;
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

	/* Leave Session Dialog Styles */
	.dialog-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.7);
		z-index: 1000;
		animation: fadeInBackdrop 0.2s ease-out;
	}

	.dialog-panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		padding: 1.5rem;
		background: #1a1a1a;
		border: 1px solid #444;
		border-radius: 8px;
		z-index: 1001;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
		min-width: 320px;
		max-width: 90vw;
		animation: fadeInPanel 0.2s ease-out;
	}

	.dialog-title {
		margin: 0 0 1rem 0;
		font-size: 1.25rem;
		font-weight: 600;
		color: #fff;
	}

	.dialog-message {
		margin: 0 0 1rem 0;
		font-size: 0.875rem;
		color: #aaa;
		line-height: 1.5;
	}

	.dialog-note {
		margin: 0 0 1rem 0;
		font-size: 0.875rem;
		color: #888;
		font-style: italic;
	}

	.participant-select {
		margin-bottom: 1.5rem;
	}

	.participant-select label {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
		color: #ccc;
	}

	.participant-select select {
		width: 100%;
		padding: 0.5rem;
		font-size: 0.875rem;
		background: #2a2a2a;
		border: 1px solid #444;
		border-radius: 4px;
		color: #fff;
		cursor: pointer;
	}

	.participant-select select:focus {
		outline: none;
		border-color: #4a9eff;
	}

	.dialog-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.btn-warning {
		background-color: #ff9800;
		color: #000;
	}

	.btn-warning:hover {
		background-color: #ffb74d;
	}
</style>

