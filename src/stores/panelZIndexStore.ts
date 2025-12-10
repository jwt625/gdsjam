/**
 * Panel Z-Index Store - Manages z-index for movable panels
 * Ensures clicked panels come to front
 */

import { derived, writable } from "svelte/store";

// Panel identifiers
export type PanelId = "participants" | "minimap" | "performance" | "layers" | "comments";

// Base z-index for panels (high enough to be above canvas, below modals)
const BASE_Z_INDEX = 100;

interface PanelZIndexState {
	// Track order of panels (last = front)
	order: PanelId[];
}

function createPanelZIndexStore() {
	const { subscribe, update } = writable<PanelZIndexState>({
		order: ["participants", "minimap", "performance", "layers", "comments"],
	});

	return {
		subscribe,

		/**
		 * Bring a panel to the front
		 */
		bringToFront: (panelId: PanelId) => {
			update((state) => {
				// Remove panel from current position and add to end (front)
				const newOrder = state.order.filter((id) => id !== panelId);
				newOrder.push(panelId);
				return { order: newOrder };
			});
		},

		/**
		 * Get z-index for a specific panel
		 */
		getZIndex: (panelId: PanelId, state: PanelZIndexState): number => {
			const index = state.order.indexOf(panelId);
			return BASE_Z_INDEX + (index >= 0 ? index : 0);
		},
	};
}

export const panelZIndexStore = createPanelZIndexStore();

/**
 * Derived store for getting z-index of a specific panel
 * Usage: $panelZIndex('minimap')
 */
export function getPanelZIndex(panelId: PanelId) {
	return derived(panelZIndexStore, ($store) => {
		const index = $store.order.indexOf(panelId);
		return BASE_Z_INDEX + (index >= 0 ? index : 0);
	});
}
