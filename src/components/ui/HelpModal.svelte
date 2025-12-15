<script lang="ts">
/**
 * HelpModal - First-time user help modal
 *
 * Features:
 * - Shows on first page load only (tracked via localStorage)
 * - Displays keyboard shortcuts and basic usage
 * - ESC or any key to close
 * - No animations (instant display)
 */

interface Props {
	visible: boolean;
	onClose: () => void;
}

const { visible, onClose }: Props = $props();

// Collapsible section state
let measurementExpanded = $state(false);
let commentsExpanded = $state(false);
let mobileExpanded = $state(false);
let collaborationExpanded = $state(false);

/**
 * Handle backdrop click (close modal)
 */
function handleBackdropClick(event: MouseEvent) {
	if (event.target === event.currentTarget) {
		onClose();
	}
}

/**
 * Handle keyboard events - any key closes the modal
 */
function handleKeyDown(event: KeyboardEvent) {
	event.preventDefault();
	onClose();
}

/**
 * Attach/detach global keyboard listener when modal visibility changes
 */
$effect(() => {
	if (visible) {
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}
});
</script>

{#if visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal-backdrop" onclick={handleBackdropClick}>
		<div class="modal-content">
			<div class="modal-header">
				<h2>Welcome to GDSJam!</h2>
				<button type="button" class="close-btn" onclick={onClose} aria-label="Close">×</button>
			</div>

			<div class="modal-body">
				<section>
					<h3>Quick Start</h3>
					<ul>
						<li>Drag & drop a GDS/DXF file or click to browse</li>
						<li>Your file stays local - nothing is uploaded (unless you create a session)</li>
						<li>Use mouse wheel to zoom, middle-click or Space+Drag to pan</li>
					</ul>
				</section>

				<section>
					<h3>Keyboard Shortcuts</h3>
					<div class="shortcuts-grid">
						<div class="shortcut-item">
							<kbd>Ctrl/Cmd+O</kbd>
							<span>Open file</span>
						</div>
						<div class="shortcut-item">
							<kbd>F</kbd>
							<span>Fit to view (hold for fullscreen)</span>
						</div>
						<div class="shortcut-item">
							<kbd>G</kbd>
							<span>Toggle grid</span>
						</div>
						<div class="shortcut-item">
							<kbd>O</kbd>
							<span>Toggle fill/outline</span>
						</div>
						<div class="shortcut-item">
							<kbd>P</kbd>
							<span>Toggle performance panel</span>
						</div>
						<div class="shortcut-item">
							<kbd>L</kbd>
							<span>Toggle layer panel</span>
						</div>
						<div class="shortcut-item">
							<kbd>M</kbd>
							<span>Toggle minimap (hold to toggle measurement mode)</span>
						</div>
						<div class="shortcut-item">
							<kbd>C</kbd>
							<span>Add comment (double-tap for panel, hold to toggle visibility)</span>
						</div>
						<div class="shortcut-item">
							<kbd>Ctrl/Cmd+K</kbd>
							<span>Clear all measurements</span>
						</div>
						<div class="shortcut-item">
							<kbd>H</kbd>
							<span>Toggle help modal</span>
						</div>
						<div class="shortcut-item">
							<kbd>Arrow Keys</kbd>
							<span>Pan view</span>
						</div>
						<div class="shortcut-item">
							<kbd>Enter</kbd>
							<span>Zoom in</span>
						</div>
						<div class="shortcut-item">
							<kbd>Shift+Enter</kbd>
							<span>Zoom out</span>
						</div>
						<div class="shortcut-item">
							<kbd>Esc</kbd>
							<span>Exit fullscreen / Cancel comment/measurement mode</span>
						</div>
					</div>
				</section>

				<section class="collapsible-section">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<h3 class="collapsible-header" onclick={() => measurementExpanded = !measurementExpanded}>
						<svg class="chevron-icon" class:rotated={!measurementExpanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="6 9 12 15 18 9"></polyline>
						</svg>
						Measurement Mode
					</h3>
					{#if measurementExpanded}
						<ul>
							<li><strong>Desktop:</strong> Hold M (500ms) to enter/exit measurement mode</li>
							<li>Click first point, then click second point to measure distance</li>
							<li>Hold <kbd>Shift</kbd> after first click to snap to horizontal, vertical, or ±45°</li>
							<li>Click completed measurement to highlight it</li>
							<li>Press <kbd>Ctrl/Cmd+K</kbd> to clear all measurements</li>
							<li>Maximum 50 measurements (oldest auto-deleted when limit reached)</li>
							<li><strong>Mobile:</strong> Use FAB menu to toggle, touch-and-drag to measure, two-finger touch to exit</li>
						</ul>
					{/if}
				</section>

				<section class="collapsible-section">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<h3 class="collapsible-header" onclick={() => commentsExpanded = !commentsExpanded}>
						<svg class="chevron-icon" class:rotated={!commentsExpanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="6 9 12 15 18 9"></polyline>
						</svg>
						Comments
					</h3>
					{#if commentsExpanded}
						<ul>
							<li><strong>Single tap C:</strong> Enter comment mode, click/tap to place comment</li>
							<li><strong>Double tap C:</strong> Toggle comment panel (view all comments)</li>
							<li><strong>Hold C (500ms):</strong> Toggle visibility of all comments</li>
							<li>Comments are synced in collaboration sessions</li>
							<li>Host can control viewer comment permissions</li>
							<li><strong>Mobile:</strong> Use FAB menu to add comments</li>
						</ul>
					{/if}
				</section>

				<section class="collapsible-section">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<h3 class="collapsible-header" onclick={() => mobileExpanded = !mobileExpanded}>
						<svg class="chevron-icon" class:rotated={!mobileExpanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="6 9 12 15 18 9"></polyline>
						</svg>
						Mobile/Touch
					</h3>
					{#if mobileExpanded}
						<ul>
							<li>One finger to pan</li>
							<li>Two fingers to zoom (pinch)</li>
							<li>Use the floating action button (FAB) for controls</li>
						</ul>
					{/if}
				</section>

				<section class="collapsible-section">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<h3 class="collapsible-header" onclick={() => collaborationExpanded = !collaborationExpanded}>
						<svg class="chevron-icon" class:rotated={!collaborationExpanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="6 9 12 15 18 9"></polyline>
						</svg>
						Collaboration
					</h3>
					{#if collaborationExpanded}
						<ul>
							<li>Click "Create Session" to start a collaborative session</li>
							<li>Share the link or QR code with others</li>
							<li>Host controls file loading, viewers can follow along</li>
						</ul>
					{/if}
				</section>
			</div>

			<div class="modal-footer">
				<button type="button" class="primary-btn" onclick={onClose}>Got it!</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background-color: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
		padding: 1rem;
	}

	.modal-content {
		background-color: #2a2a2a;
		border-radius: 8px;
		max-width: 700px;
		max-height: 90vh;
		width: 100%;
		display: flex;
		flex-direction: column;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.5rem;
		border-bottom: 1px solid #3a3a3a;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.5rem;
		color: #ffffff;
	}

	.close-btn {
		background: none;
		border: none;
		color: #999;
		font-size: 2rem;
		cursor: pointer;
		padding: 0;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		transition: color 0.2s;
	}

	.close-btn:hover {
		color: #fff;
	}

	.modal-body {
		padding: 1.5rem;
		overflow-y: auto;
		flex: 1;
	}

	.modal-body section {
		margin-bottom: 1.5rem;
	}

	.modal-body section:last-child {
		margin-bottom: 0;
	}

	.modal-body h3 {
		margin: 0 0 0.75rem 0;
		font-size: 1.1rem;
		color: #e0e0e0;
		font-weight: 600;
	}

	.collapsible-section {
		margin-bottom: 1rem;
	}

	.collapsible-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		user-select: none;
		padding: 0.5rem;
		margin: 0 -0.5rem 0.5rem -0.5rem;
		border-radius: 4px;
		transition: background-color 0.2s;
	}

	.collapsible-header:hover {
		background-color: #3a3a3a;
	}

	.chevron-icon {
		width: 1rem;
		height: 1rem;
		transition: transform 0.2s;
		flex-shrink: 0;
	}

	.chevron-icon.rotated {
		transform: rotate(-90deg);
	}

	.modal-body ul {
		margin: 0;
		padding-left: 1.5rem;
		color: #ccc;
	}

	.modal-body li {
		margin-bottom: 0.5rem;
	}

	.shortcuts-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 0.75rem;
	}

	.shortcut-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		background-color: #1a1a1a;
		border-radius: 4px;
	}

	.shortcut-item kbd {
		background-color: #3a3a3a;
		border: 1px solid #4a4a4a;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-family: monospace;
		font-size: 0.85rem;
		color: #e0e0e0;
		white-space: nowrap;
		min-width: fit-content;
	}

	.shortcut-item span {
		color: #ccc;
		font-size: 0.9rem;
	}

	.modal-footer {
		padding: 1rem 1.5rem;
		border-top: 1px solid #3a3a3a;
		display: flex;
		justify-content: flex-end;
	}

	.primary-btn {
		background-color: #4a4a4a;
		color: #e0e0e0;
		border: 1px solid #666;
		padding: 0.75rem 2rem;
		border-radius: 4px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.primary-btn:hover {
		background-color: #5a5a5a;
		border-color: #777;
	}

	/* Mobile responsive */
	@media (max-width: 768px) {
		.modal-content {
			max-width: 100%;
			max-height: 95vh;
			margin: 0.5rem;
		}

		.shortcuts-grid {
			grid-template-columns: 1fr;
		}

		.modal-header h2 {
			font-size: 1.25rem;
		}

		.modal-body {
			padding: 1rem;
		}

		.modal-header {
			padding: 1rem;
		}
	}
</style>

