<script lang="ts">
import { collaborationStore } from "../../stores/collaborationStore";
import { getPanelZIndex, panelZIndexStore } from "../../stores/panelZIndexStore";

interface Props {
	visible?: boolean;
}

const { visible = true }: Props = $props();

// Z-index for this panel
const zIndex = getPanelZIndex("participants");

// Local state for confirmation dialog
let showTransferConfirm = $state(false);
let transferTargetId = $state<string | null>(null);
let transferTargetName = $state<string | null>(null);

// Collapsed state for the panel
let isCollapsed = $state(false);

// Drag state for panel positioning
let panelPosition = $state({ x: 10, y: 100 });
let isDragging = $state(false);
let dragStart = $state({ x: 0, y: 0 });
let mouseDownTime = $state(0);
let mouseDownPos = $state({ x: 0, y: 0 });
const CLICK_THRESHOLD_MS = 200; // Max time for a click vs drag
const DRAG_THRESHOLD_PX = 5; // Min movement to start drag

// Unified pointer handling for mouse and touch
function handlePointerStart(clientX: number, clientY: number) {
	mouseDownTime = Date.now();
	mouseDownPos = { x: clientX, y: clientY };
	dragStart = { x: clientX - panelPosition.x, y: clientY - panelPosition.y };
}

function handlePointerMove(clientX: number, clientY: number) {
	const dx = Math.abs(clientX - mouseDownPos.x);
	const dy = Math.abs(clientY - mouseDownPos.y);

	if (!isDragging && (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX)) {
		isDragging = true;
	}

	if (isDragging) {
		panelPosition = {
			x: clientX - dragStart.x,
			y: clientY - dragStart.y,
		};
	}
}

function handlePointerEnd(clientX: number, clientY: number) {
	const elapsed = Date.now() - mouseDownTime;
	const dx = Math.abs(clientX - mouseDownPos.x);
	const dy = Math.abs(clientY - mouseDownPos.y);

	if (elapsed < CLICK_THRESHOLD_MS && dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) {
		isCollapsed = !isCollapsed;
	}

	isDragging = false;
}

// Mouse event handlers
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

// Touch event handlers
function handleHeaderTouchStart(e: TouchEvent) {
	if (e.touches.length !== 1) return;
	e.preventDefault(); // Prevent synthesized mouse events (avoids double-trigger)
	const touch = e.touches[0]!;
	handlePointerStart(touch.clientX, touch.clientY);
	window.addEventListener("touchmove", handleTouchMove, { passive: false });
	window.addEventListener("touchend", handleTouchEnd);
	window.addEventListener("touchcancel", handleTouchEnd);
}

function handleTouchMove(e: TouchEvent) {
	if (e.touches.length !== 1) return;
	e.preventDefault(); // Prevent scrolling while interacting
	const touch = e.touches[0]!;
	handlePointerMove(touch.clientX, touch.clientY);
}

function handleTouchEnd(e: TouchEvent) {
	e.preventDefault(); // Prevent synthesized mouse events
	window.removeEventListener("touchmove", handleTouchMove);
	window.removeEventListener("touchend", handleTouchEnd);
	window.removeEventListener("touchcancel", handleTouchEnd);
	const touch = e.changedTouches[0]!;
	handlePointerEnd(touch.clientX, touch.clientY);
}

// Use connectedUsers from the store - it already has isHost computed correctly per user
// This automatically updates when host changes via store subscription
const currentUserId = $derived($collaborationStore.userId);
const isHost = $derived($collaborationStore.isHost);
const connectedUsers = $derived($collaborationStore.connectedUsers);

// Viewport sync state
const isBroadcasting = $derived($collaborationStore.isBroadcasting);
const isFollowing = $derived($collaborationStore.isFollowing);

function handleBroadcastToggle() {
	collaborationStore.toggleBroadcast();
}

function handleFollowToggle() {
	collaborationStore.toggleFollowing();
}

function handleMakeHost(userId: string, displayName: string) {
	transferTargetId = userId;
	transferTargetName = displayName;
	showTransferConfirm = true;
}

function confirmTransfer() {
	if (transferTargetId) {
		collaborationStore.transferHost(transferTargetId);
	}
	cancelTransfer();
}

function cancelTransfer() {
	showTransferConfirm = false;
	transferTargetId = null;
	transferTargetName = null;
}
</script>

{#if visible && $collaborationStore.isInSession}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="participant-list"
		class:collapsed={isCollapsed}
		class:dragging={isDragging}
		style="left: {panelPosition.x}px; top: {panelPosition.y}px; z-index: {$zIndex};"
		onmousedown={() => panelZIndexStore.bringToFront("participants")}
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
			<h3>Participants ({connectedUsers.length})</h3>
			<svg class="chevron-icon" class:rotated={isCollapsed} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</div>

		{#if !isCollapsed}
			<div class="participant-items">
				{#each connectedUsers as user (user.id)}
					<div class="participant-item">
						<div class="color-indicator" style="background-color: {user.color}"></div>
						<span class="participant-name">
							{user.displayName}
							{#if user.id === currentUserId}
								<span class="you-badge">You</span>
							{/if}
						</span>
						{#if user.isHost}
							<span class="host-badge">Host</span>
						{:else if isHost}
							<button
								type="button"
								class="make-host-btn"
								onclick={() => handleMakeHost(user.id, user.displayName)}
							>
								Make Host
							</button>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Viewport Sync Controls -->
			<div class="viewport-sync-controls">
				{#if isHost}
					<!-- Host: Broadcast toggle -->
					<label class="sync-toggle">
						<input
							type="checkbox"
							checked={isBroadcasting}
							onchange={handleBroadcastToggle}
						/>
						<span class="toggle-label">Broadcast viewport</span>
					</label>
				{:else}
					<!-- Viewer: Follow toggle -->
					<label class="sync-toggle">
						<input
							type="checkbox"
							checked={isFollowing}
							onchange={handleFollowToggle}
						/>
						<span class="toggle-label">Follow host</span>
					</label>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<!-- Transfer Confirmation Dialog -->
{#if showTransferConfirm}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="dialog-backdrop" onclick={cancelTransfer}>
		<div class="dialog-panel" onclick={(e) => e.stopPropagation()}>
			<h3 class="dialog-title">Transfer Host?</h3>
			<p class="dialog-message">
				Are you sure you want to make <strong>{transferTargetName}</strong> the host?
				You will become a viewer.
			</p>
			<div class="dialog-actions">
				<button type="button" class="btn btn-secondary" onclick={cancelTransfer}>
					Cancel
				</button>
				<button type="button" class="btn btn-primary" onclick={confirmTransfer}>
					Transfer Host
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.participant-list {
		position: fixed;
		min-width: 180px;
		max-width: 320px;
		width: auto;
		max-height: 300px;
		background: rgba(0, 0, 0, 0.9);
		color: #ccc;
		border-radius: 4px;
		font-family: monospace;
		font-size: 12px;
		/* z-index set via inline style from panelZIndexStore */
		display: flex;
		flex-direction: column;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
		transition: max-height 0.2s ease-out;
		user-select: none;
	}

	.participant-list.collapsed {
		max-height: 44px;
	}

	.participant-list.dragging {
		cursor: grabbing;
		opacity: 0.9;
	}

	.panel-header {
		padding: 12px;
		border-bottom: 1px solid #444;
		display: flex;
		align-items: center;
		justify-content: space-between;
		cursor: grab;
		background: transparent;
		border: none;
		border-bottom: 1px solid #444;
		width: 100%;
		text-align: left;
		color: inherit;
		font-family: inherit;
	}

	.participant-list.dragging .panel-header {
		cursor: grabbing;
	}

	.panel-header:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.panel-header h3 {
		margin: 0;
		font-size: 14px;
		color: #fff;
	}

	.chevron-icon {
		width: 16px;
		height: 16px;
		color: #888;
		transition: transform 0.2s ease-out;
		flex-shrink: 0;
	}

	.chevron-icon.rotated {
		transform: rotate(-90deg);
	}

	.participant-items {
		overflow-y: auto;
		padding: 8px;
		flex: 1;
	}

	.participant-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
		border-radius: 3px;
	}

	.participant-item:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.color-indicator {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.participant-name {
		flex: 1;
		color: #ddd;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.you-badge {
		margin-left: 4px;
		font-size: 10px;
		color: #4ecdc4;
		font-weight: 500;
	}

	.host-badge {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 3px;
		background-color: #4a9eff;
		color: #fff;
		text-transform: uppercase;
	}

	.make-host-btn {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 3px;
		background: #333;
		color: #aaa;
		border: 1px solid #555;
		cursor: pointer;
		transition: all 0.2s;
	}

	.make-host-btn:hover {
		background: #444;
		color: #fff;
		border-color: #4a9eff;
	}

	/* Viewport sync controls */
	.viewport-sync-controls {
		padding: 8px 12px;
		border-top: 1px solid #333;
		background: rgba(255, 255, 255, 0.02);
	}

	.sync-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		user-select: none;
	}

	.sync-toggle input[type="checkbox"] {
		width: 14px;
		height: 14px;
		accent-color: #4a9eff;
		cursor: pointer;
	}

	.toggle-label {
		font-size: 11px;
		color: #aaa;
	}

	.sync-toggle:hover .toggle-label {
		color: #ddd;
	}

	/* Dialog styles */
	.dialog-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.6);
		z-index: 2000;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.dialog-panel {
		background: #1a1a1a;
		border: 1px solid #444;
		border-radius: 8px;
		padding: 1.5rem;
		max-width: 400px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}

	.dialog-title {
		margin: 0 0 1rem 0;
		font-size: 1.125rem;
		color: #fff;
	}

	.dialog-message {
		margin: 0 0 1.5rem 0;
		color: #aaa;
		line-height: 1.5;
	}

	.dialog-message strong {
		color: #4ecdc4;
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
	}

	.btn {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-primary {
		background-color: #4a9eff;
		color: #fff;
	}

	.btn-primary:hover {
		background-color: #6bb3ff;
	}

	.btn-secondary {
		background-color: #333;
		color: #fff;
	}

	.btn-secondary:hover {
		background-color: #444;
	}
</style>

