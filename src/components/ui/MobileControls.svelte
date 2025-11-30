<script lang="ts">
import type { PixiRenderer } from "../../lib/renderer/PixiRenderer";

interface Props {
	renderer: PixiRenderer | null;
	onTogglePerformance: () => void;
	onToggleLayers: () => void;
	onToggleMinimap?: () => void;
	onToggleFullscreen?: (enabled: boolean) => void;
	performanceVisible: boolean;
	layersVisible: boolean;
	minimapVisible?: boolean;
	fullscreenMode?: boolean;
}

const {
	renderer,
	onTogglePerformance,
	onToggleLayers,
	onToggleMinimap,
	onToggleFullscreen,
	performanceVisible,
	layersVisible,
	minimapVisible = true,
	fullscreenMode = false,
}: Props = $props();

let menuOpen = $state(false);

function toggleMenu() {
	menuOpen = !menuOpen;
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
					<rect x="3" y="3" width="18" height="18" rx="2"/>
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
					<rect x="3" y="3" width="18" height="18" rx="2"/>
					<rect x="13" y="13" width="6" height="6" rx="1"/>
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
		border-radius: 8px;
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

	.fab {
		width: 56px;
		height: 56px;
		border-radius: 50%;
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

