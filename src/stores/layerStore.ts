/**
 * Layer Visibility Store - Manages layer visibility state for the UI
 * Syncs with gdsStore for the actual layer visibility data
 */

import { writable } from "svelte/store";
import type { Layer } from "../types/gds";

interface LayerVisibility {
	[key: string]: boolean; // key: "layer:datatype"
}

interface LayerStoreState {
	visibility: LayerVisibility;
	syncEnabled: boolean; // Whether to sync with other users (for future collaboration)
}

function createLayerStore() {
	const { subscribe, set, update } = writable<LayerStoreState>({
		visibility: {},
		syncEnabled: false, // Default: local only
	});

	return {
		subscribe,

		/**
		 * Initialize layer visibility from GDS document layers
		 */
		setLayers: (layers: Map<string, Layer>) => {
			update((state) => {
				const visibility: LayerVisibility = {};
				for (const [key, layer] of layers) {
					visibility[key] = layer.visible;
				}
				return { ...state, visibility };
			});
		},

		/**
		 * Toggle visibility of a single layer
		 */
		toggleLayer: (key: string) => {
			update((state) => ({
				...state,
				visibility: {
					...state.visibility,
					[key]: !state.visibility[key],
				},
			}));
		},

		/**
		 * Show all layers
		 */
		showAll: () => {
			update((state) => {
				const newVisibility = { ...state.visibility };
				for (const key in newVisibility) {
					newVisibility[key] = true;
				}
				return { ...state, visibility: newVisibility };
			});
		},

		/**
		 * Hide all layers
		 */
		hideAll: () => {
			update((state) => {
				const newVisibility = { ...state.visibility };
				for (const key in newVisibility) {
					newVisibility[key] = false;
				}
				return { ...state, visibility: newVisibility };
			});
		},

		/**
		 * Toggle sync mode (for future collaboration features)
		 */
		toggleSync: () => {
			update((state) => ({
				...state,
				syncEnabled: !state.syncEnabled,
			}));
		},

		/**
		 * Set sync enabled state
		 */
		setSyncEnabled: (enabled: boolean) => {
			update((state) => ({
				...state,
				syncEnabled: enabled,
			}));
		},

		/**
		 * Reset store to initial state
		 */
		reset: () => {
			set({
				visibility: {},
				syncEnabled: false,
			});
		},
	};
}

export const layerStore = createLayerStore();
