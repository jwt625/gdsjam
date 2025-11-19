/**
 * GDS Document Store - Svelte store for managing GDSII document state
 */

import { writable } from "svelte/store";
import { DEBUG } from "../lib/config";
import type { GDSDocument } from "../types/gds";

export interface GDSState {
	document: GDSDocument | null;
	isLoading: boolean;
	isRendering: boolean;
	loadingProgress: number; // 0-100
	loadingMessage: string;
	error: string | null;
	fileName: string | null;
}

const initialState: GDSState = {
	document: null,
	isLoading: false,
	isRendering: false,
	loadingProgress: 0,
	loadingMessage: "",
	error: null,
	fileName: null,
};

function createGDSStore() {
	const { subscribe, set, update } = writable<GDSState>(initialState);

	return {
		subscribe,

		/**
		 * Set the GDS document
		 */
		setDocument: (document: GDSDocument, fileName: string) => {
			if (DEBUG) {
				console.log(`[gdsStore] Setting document: ${fileName}`);
			}
			update((state) => ({
				...state,
				document,
				fileName,
				isLoading: false,
				isRendering: false,
				loadingProgress: 100,
				loadingMessage: "Loaded successfully",
				error: null,
			}));
		},

		/**
		 * Set rendering state
		 */
		setRendering: (isRendering: boolean, message = "", progress = 0) => {
			if (DEBUG) {
				console.log(`[gdsStore] setRendering: ${progress}% - ${message}`);
			}
			update((state) => ({
				...state,
				isRendering,
				loadingMessage: message,
				loadingProgress: progress,
			}));
		},

		/**
		 * Set loading state
		 */
		setLoading: (isLoading: boolean, message = "", progress = 0) => {
			update((state) => ({
				...state,
				isLoading,
				loadingMessage: message,
				loadingProgress: progress,
				error: null,
			}));
		},

		/**
		 * Update loading progress
		 */
		updateProgress: (progress: number, message: string) => {
			update((state) => ({
				...state,
				loadingProgress: progress,
				loadingMessage: message,
			}));
		},

		/**
		 * Set error state
		 */
		setError: (error: string) => {
			update((state) => ({
				...state,
				error,
				isLoading: false,
				loadingProgress: 0,
				loadingMessage: "",
			}));
		},

		/**
		 * Clear error
		 */
		clearError: () => {
			update((state) => ({
				...state,
				error: null,
			}));
		},

		/**
		 * Reset store to initial state
		 */
		reset: () => {
			set(initialState);
		},

		/**
		 * Toggle layer visibility
		 */
		toggleLayerVisibility: (layerKey: string) => {
			update((state) => {
				if (!state.document) return state;

				const layer = state.document.layers.get(layerKey);
				if (layer) {
					layer.visible = !layer.visible;
				}

				return { ...state };
			});
		},

		/**
		 * Set all layers visibility
		 */
		setAllLayersVisibility: (visible: boolean) => {
			update((state) => {
				if (!state.document) return state;

				for (const layer of state.document.layers.values()) {
					layer.visible = visible;
				}

				return { ...state };
			});
		},
	};
}

export const gdsStore = createGDSStore();
