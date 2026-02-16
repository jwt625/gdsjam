<script lang="ts">
import type { PixiRenderer } from "../../lib/renderer/PixiRenderer";

interface Props {
	renderer: PixiRenderer | null;
	onTogglePerformance: () => void;
	onToggleLayers: () => void;
	onToggleMinimap?: () => void;
	onToggleFullscreen?: (enabled: boolean) => void;
	onToggleCommentMode?: () => void;
	onToggleCommentsVisibility?: () => void;
	onToggleCommentPanel?: () => void;
	onToggleEditorMode?: () => void;
	onToggleMeasurementMode?: () => void;
	onClearMeasurements?: () => void;
	performanceVisible: boolean;
	layersVisible: boolean;
	minimapVisible?: boolean;
	fullscreenMode?: boolean;
	commentModeActive?: boolean;
	commentsVisible?: boolean;
	commentPanelVisible?: boolean;
	editorModeActive?: boolean;
	measurementModeActive?: boolean;
}

const {
	renderer,
	onTogglePerformance,
	onToggleLayers,
	onToggleMinimap,
	onToggleFullscreen,
	onToggleCommentMode,
	onToggleCommentsVisibility,
	onToggleCommentPanel,
	onToggleEditorMode,
	onToggleMeasurementMode,
	onClearMeasurements,
	performanceVisible,
	layersVisible,
	minimapVisible = true,
	fullscreenMode = false,
	commentModeActive = false,
	commentsVisible = true,
	commentPanelVisible = false,
	editorModeActive = false,
	measurementModeActive = false,
}: Props = $props();

let menuOpen = $state(false);
let commentsSubmenuOpen = $state(false);
let measurementsSubmenuOpen = $state(false);

function toggleMenu() {
	menuOpen = !menuOpen;
	// Close submenus when main menu closes
	if (!menuOpen) {
		commentsSubmenuOpen = false;
		measurementsSubmenuOpen = false;
	}
}

function toggleCommentsSubmenu() {
	commentsSubmenuOpen = !commentsSubmenuOpen;
	// Close measurements submenu when opening comments
	if (commentsSubmenuOpen) {
		measurementsSubmenuOpen = false;
	}
}

function toggleMeasurementsSubmenu() {
	measurementsSubmenuOpen = !measurementsSubmenuOpen;
	// Close comments submenu when opening measurements
	if (measurementsSubmenuOpen) {
		commentsSubmenuOpen = false;
	}
}

function handleFitView() {
	renderer?.fitToView();
	menuOpen = false;
}

function handleToggleFill() {
	renderer?.toggleFill();
	menuOpen = false;
}

function handleToggleGrid() {
	renderer?.toggleGrid();
	menuOpen = false;
}

function handleTogglePerformance() {
	onTogglePerformance();
	menuOpen = false;
}

function handleToggleLayers() {
	onToggleLayers();
	menuOpen = false;
}

function handleToggleMinimap() {
	onToggleMinimap?.();
	menuOpen = false;
}

function handleToggleFullscreen() {
	onToggleFullscreen?.(!fullscreenMode);
	menuOpen = false;
}

function handleToggleCommentMode() {
	onToggleCommentMode?.();
	menuOpen = false;
	commentsSubmenuOpen = false;
}

function handleToggleCommentsVisibility() {
	onToggleCommentsVisibility?.();
	menuOpen = false;
	commentsSubmenuOpen = false;
}

function handleToggleCommentPanel() {
	onToggleCommentPanel?.();
	menuOpen = false;
	commentsSubmenuOpen = false;
}

function handleToggleEditorMode() {
	onToggleEditorMode?.();
	menuOpen = false;
}

function handleToggleMeasurementMode() {
	onToggleMeasurementMode?.();
	menuOpen = false;
	measurementsSubmenuOpen = false;
}

function handleClearMeasurements() {
	onClearMeasurements?.();
	menuOpen = false;
	measurementsSubmenuOpen = false;
}
</script>

<div class="mobile-controls">
	<!-- Menu Items (shown when open) -->
	{#if menuOpen}
		<button type="button" class="menu-backdrop" onclick={toggleMenu} aria-label="Close menu"></button>
		<div class="menu-items">
			<!-- Layers -->
			<button class="menu-item" onclick={handleToggleLayers} class:active={layersVisible} title="Toggle Layers (L)">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12 2L2 7l10 5 10-5-10-5z"/>
					<path d="M2 17l10 5 10-5"/>
					<path d="M2 12l10 5 10-5"/>
				</svg>
				<span>Layers</span>
			</button>

			<!-- Performance -->
			<button class="menu-item" onclick={handleTogglePerformance} class:active={performanceVisible} title="Toggle Performance (P)">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M3 3v18h18"/>
					<path d="M18 17V9"/>
					<path d="M13 17V5"/>
					<path d="M8 17v-3"/>
				</svg>
				<span>Metrics</span>
			</button>

			<!-- Fill/Outline Toggle -->
			<button class="menu-item" onclick={handleToggleFill} title="Toggle Fill/Outline (O)">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="18" height="18" rx="0"/>
					<path d="M9 9h6v6H9z"/>
				</svg>
				<span>Fill/Outline</span>
			</button>

			<!-- Fit View -->
			<button class="menu-item" onclick={handleFitView} title="Fit to View (F)">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
				</svg>
				<span>Fit View</span>
			</button>

			<!-- Grid Toggle -->
			<button class="menu-item" onclick={handleToggleGrid} title="Toggle Grid (G)">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="7" height="7"/>
					<rect x="14" y="3" width="7" height="7"/>
					<rect x="14" y="14" width="7" height="7"/>
					<rect x="3" y="14" width="7" height="7"/>
				</svg>
				<span>Grid</span>
			</button>

			<!-- Minimap Toggle -->
			<button class="menu-item" onclick={handleToggleMinimap} class:active={minimapVisible} title="Toggle Minimap (M)">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="18" height="18" rx="0"/>
					<rect x="13" y="13" width="6" height="6" rx="0"/>
				</svg>
				<span>Minimap</span>
			</button>

			<!-- Fullscreen Toggle -->
			<button class="menu-item" onclick={handleToggleFullscreen} class:active={fullscreenMode} title="Toggle Fullscreen">
				{#if fullscreenMode}
					<!-- Exit fullscreen icon (compress) -->
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M4 14h6v6"/>
						<path d="M20 10h-6V4"/>
						<path d="M14 10l7-7"/>
						<path d="M3 21l7-7"/>
					</svg>
					<span>Exit Fullscreen</span>
				{:else}
					<!-- Enter fullscreen icon (expand) -->
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M15 3h6v6"/>
						<path d="M9 21H3v-6"/>
						<path d="M21 3l-7 7"/>
						<path d="M3 21l7-7"/>
					</svg>
					<span>Fullscreen</span>
				{/if}
			</button>

			<!-- Comments Submenu -->
			<button class="menu-item" onclick={toggleCommentsSubmenu} class:active={commentsSubmenuOpen} title="Comments">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
				</svg>
				<span>Comments</span>
				<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:open={commentsSubmenuOpen}>
					<polyline points="9 18 15 12 9 6"/>
				</svg>
			</button>

			<!-- Comments Submenu Items -->
			{#if commentsSubmenuOpen}
				<div class="submenu-items">
					<button class="submenu-item" onclick={handleToggleCommentMode} class:active={commentModeActive} title="Toggle Comment Mode (C)">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
							<circle cx="12" cy="10" r="1" fill="currentColor"/>
						</svg>
						<span>Add Comment</span>
					</button>

					<button class="submenu-item" onclick={handleToggleCommentsVisibility} class:active={commentsVisible} title="Show/Hide Comments">
						{#if commentsVisible}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
								<circle cx="12" cy="12" r="3"/>
							</svg>
							<span>Hide Comments</span>
						{:else}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
								<line x1="1" y1="1" x2="23" y2="23"/>
							</svg>
							<span>Show Comments</span>
						{/if}
					</button>

					<button class="submenu-item" onclick={handleToggleCommentPanel} class:active={commentPanelVisible} title="Toggle Comment Panel">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
							<line x1="9" y1="9" x2="15" y2="9"/>
							<line x1="9" y1="13" x2="15" y2="13"/>
						</svg>
						<span>Comment Panel</span>
					</button>
				</div>
			{/if}

			<!-- Editor Mode Toggle -->
			<button class="menu-item" onclick={handleToggleEditorMode} class:active={editorModeActive} title="Toggle Editor Mode (Hold E)">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="16 18 22 12 16 6"/>
					<polyline points="8 6 2 12 8 18"/>
				</svg>
				<span>Editor Mode</span>
			</button>

			<!-- Measurements Submenu -->
			<button class="menu-item" onclick={toggleMeasurementsSubmenu} class:active={measurementsSubmenuOpen} title="Measurements">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M3 3l18 18"/>
					<path d="M3 21V3h18"/>
					<path d="M7 7v14"/>
					<path d="M11 11v10"/>
					<path d="M15 15v6"/>
					<path d="M19 19v2"/>
				</svg>
				<span>Measurements</span>
				<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:open={measurementsSubmenuOpen}>
					<polyline points="9 18 15 12 9 6"/>
				</svg>
			</button>

			<!-- Measurements Submenu Items -->
			{#if measurementsSubmenuOpen}
				<div class="submenu-items">
					<button class="submenu-item" onclick={handleToggleMeasurementMode} class:active={measurementModeActive} title="Toggle Measurement Mode (Hold M)">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M3 3l18 18"/>
							<path d="M3 21V3h18"/>
							<path d="M7 7v14"/>
							<path d="M11 11v10"/>
							<path d="M15 15v6"/>
							<path d="M19 19v2"/>
						</svg>
						<span>Measure Distance</span>
					</button>

					<button class="submenu-item" onclick={handleClearMeasurements} title="Clear All Measurements (Ctrl/Cmd+K)">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="3 6 5 6 21 6"/>
							<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
							<line x1="10" y1="11" x2="10" y2="17"/>
							<line x1="14" y1="11" x2="14" y2="17"/>
						</svg>
						<span>Clear Measurements</span>
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- FAB (Floating Action Button) -->
	<button class="fab" onclick={toggleMenu} class:open={menuOpen} title="Controls Menu">
		{#if menuOpen}
			<!-- Close icon -->
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M18 6L6 18M6 6l12 12"/>
			</svg>
		{:else}
			<!-- Menu icon -->
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="1"/>
				<circle cx="12" cy="5" r="1"/>
				<circle cx="12" cy="19" r="1"/>
			</svg>
		{/if}
	</button>
</div>

<style>
	.mobile-controls {
		position: fixed;
		bottom: 20px;
		right: 20px;
		z-index: 1000;
	}

	.menu-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.3);
		border: none;
		z-index: 998;
		cursor: pointer;
	}

	.menu-items {
		position: absolute;
		bottom: 70px;
		right: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 999;
		animation: slideUp 0.2s ease-out;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		background: rgba(30, 30, 30, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0;
		color: #ffffff;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		white-space: nowrap;
		min-width: 160px;
		backdrop-filter: blur(10px);
	}

	.menu-item:hover {
		background: rgba(50, 50, 50, 0.95);
		border-color: rgba(255, 255, 255, 0.2);
		transform: translateX(-2px);
	}

	.menu-item:active {
		transform: translateX(-2px) scale(0.98);
	}

	.menu-item.active {
		background: rgba(59, 130, 246, 0.2);
		border-color: rgba(59, 130, 246, 0.5);
	}

	.menu-item svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}

	.menu-item .chevron {
		margin-left: auto;
		width: 16px;
		height: 16px;
		transition: transform 0.2s ease;
	}

	.menu-item .chevron.open {
		transform: rotate(90deg);
	}

	.submenu-items {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-left: 12px;
		margin-top: -2px;
	}

	.submenu-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: rgba(20, 20, 20, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 0;
		color: rgba(255, 255, 255, 0.9);
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		white-space: nowrap;
		min-width: 148px;
		backdrop-filter: blur(10px);
	}

	.submenu-item:hover {
		background: rgba(40, 40, 40, 0.95);
		border-color: rgba(255, 255, 255, 0.15);
		transform: translateX(-2px);
	}

	.submenu-item:active {
		transform: translateX(-2px) scale(0.98);
	}

	.submenu-item.active {
		background: rgba(59, 130, 246, 0.15);
		border-color: rgba(59, 130, 246, 0.4);
	}

	.submenu-item svg {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.fab {
		width: 56px;
		height: 56px;
		border-radius: 0;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		border: none;
		color: white;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		transition: all 0.3s ease;
		z-index: 999;
	}

	.fab:hover {
		transform: scale(1.05);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
	}

	.fab:active {
		transform: scale(0.95);
	}

	.fab.open {
		background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
		transform: rotate(90deg);
	}

	.fab svg {
		width: 24px;
		height: 24px;
		stroke-width: 2.5;
	}
</style>

