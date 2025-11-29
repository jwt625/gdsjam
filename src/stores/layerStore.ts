/**
 * Layer Visibility Store - Manages layer visibility state for the UI
 * Syncs with gdsStore for the actual layer visibility data
 * Provides updateVersion for triggering minimap re-renders
 */

import { writable } from "svelte/store";
import type { Layer } from "../types/gds";

interface LayerVisibility {
	[key: string]: boolean; // key: "layer:datatype"
}

interface LayerColors {
	[key: string]: number; // key: "layer:datatype", value: hex color as number
}

interface LayerStoreState {
	visibility: LayerVisibility;
	colors: LayerColors;
	syncEnabled: boolean; // Whether to sync with other users (for future collaboration)
	updateVersion: number; // Increments on any change (for triggering minimap re-renders)
}

function createLayerStore() {
	const { subscribe, set, update } = writable<LayerStoreState>({
		visibility: {},
		colors: {},
		syncEnabled: false, // Default: local only
		updateVersion: 0,
	});

	return {
		subscribe,

		/**
		 * Initialize layer visibility and colors from GDS document layers
		 */
		setLayers: (layers: Map<string, Layer>) => {
			update((state) => {
				const visibility: LayerVisibility = {};
				const colors: LayerColors = {};
				for (const [key, layer] of layers) {
					visibility[key] = layer.visible;
					// Convert hex string to number (e.g., "#ff0000" -> 0xff0000)
					colors[key] = parseInt(layer.color.replace("#", ""), 16);
				}
				return { ...state, visibility, colors, updateVersion: state.updateVersion + 1 };
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
				updateVersion: state.updateVersion + 1,
			}));
		},

		/**
		 * Set visibility of a single layer
		 */
		setLayerVisibility: (key: string, visible: boolean) => {
			update((state) => ({
				...state,
				visibility: {
					...state.visibility,
					[key]: visible,
				},
				updateVersion: state.updateVersion + 1,
			}));
		},

		/**
		 * Set color of a single layer
		 */
		setLayerColor: (key: string, color: number) => {
			update((state) => ({
				...state,
				colors: {
					...state.colors,
					[key]: color,
				},
				updateVersion: state.updateVersion + 1,
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
				return { ...state, visibility: newVisibility, updateVersion: state.updateVersion + 1 };
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
				return { ...state, visibility: newVisibility, updateVersion: state.updateVersion + 1 };
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
		 * Apply remote visibility state (from collaboration sync)
		 * Does not trigger re-broadcast (prevents loops)
		 */
		applyRemoteVisibility: (visibility: { [key: string]: boolean }) => {
			update((state) => ({
				...state,
				visibility: { ...state.visibility, ...visibility },
				updateVersion: state.updateVersion + 1,
			}));
		},

		/**
		 * Reset store to initial state
		 */
		reset: () => {
			set({
				visibility: {},
				colors: {},
				syncEnabled: false,
				updateVersion: 0,
			});
		},

		/**
		 * Get colors as a Map (for renderer compatibility)
		 */
		getColorsMap: (state: LayerStoreState): Map<string, number> => {
			return new Map(Object.entries(state.colors));
		},

		/**
		 * Get visibility as a Map (for renderer compatibility)
		 */
		getVisibilityMap: (state: LayerStoreState): Map<string, boolean> => {
			return new Map(Object.entries(state.visibility));
		},
	};
}

export const layerStore = createLayerStore();
