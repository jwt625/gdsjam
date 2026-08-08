/**
 * GDS Document Store - Svelte store for managing GDSII document state
 */

import { writable } from "svelte/store";
import {
	pendingRenderDiagnostics,
	type RenderDiagnostics,
} from "../lib/diagnostics/renderDiagnostics";
import {
	createLayoutSceneIndex,
	type LayoutSceneIndex,
	type TopCellSelection,
} from "../lib/layout/LayoutSceneIndex";
import type { BoundingBox, FileStatistics, GDSDocument } from "../types/gds";

export interface GDSState {
	document: GDSDocument | null;
	/** Hierarchy-preserving index for the original, aggregate document. */
	sceneIndex: LayoutSceneIndex | null;
	/** Explicit render scope. Multiple-top documents start in `required`. */
	topCellSelection: TopCellSelection;
	/** Shallow document view consumed by renderers; null until a required choice is made. */
	renderDocument: GDSDocument | null;
	aggregateBounds: BoundingBox | null;
	selectedBounds: BoundingBox | null;
	statistics: FileStatistics | null;
	isLoading: boolean;
	isRendering: boolean;
	loadingProgress: number; // 0-100
	loadingMessage: string;
	error: string | null;
	fileName: string | null;
	renderDiagnostics: RenderDiagnostics;
}

const initialState: GDSState = {
	document: null,
	sceneIndex: null,
	topCellSelection: { mode: "required" },
	renderDocument: null,
	aggregateBounds: null,
	selectedBounds: null,
	statistics: null,
	isLoading: false,
	isRendering: false,
	loadingProgress: 0,
	loadingMessage: "",
	error: null,
	fileName: null,
	renderDiagnostics: pendingRenderDiagnostics(),
};

function createGDSStore() {
	const { subscribe, set, update } = writable<GDSState>(initialState);

	return {
		subscribe,

		/**
		 * Set the GDS document
		 */
		setDocument: (
			document: GDSDocument,
			fileName: string,
			statistics: FileStatistics | null = null,
		) => {
			const sceneIndex = createLayoutSceneIndex(document);
			const topCellSelection = sceneIndex.initialSelection;
			const selectedBounds = sceneIndex.getSelectedBounds(topCellSelection);
			const renderDocument = createRenderDocument(document, topCellSelection, selectedBounds);
			update((state) => ({
				...state,
				document,
				sceneIndex,
				topCellSelection,
				renderDocument,
				aggregateBounds: { ...sceneIndex.aggregateBounds },
				selectedBounds,
				statistics,
				fileName,
				isLoading: false,
				isRendering: false,
				loadingProgress: 100,
				loadingMessage: "Loaded successfully",
				error: null,
				renderDiagnostics: pendingRenderDiagnostics(),
			}));
		},

		selectTopCell: (cellName: string) => {
			update((state) => {
				if (!state.document || !state.sceneIndex) return state;
				const topCellSelection = state.sceneIndex.selectTopCell(cellName);
				const selectedBounds = state.sceneIndex.getSelectedBounds(topCellSelection);
				return {
					...state,
					topCellSelection,
					selectedBounds,
					renderDocument: createRenderDocument(state.document, topCellSelection, selectedBounds),
					renderDiagnostics: pendingRenderDiagnostics(),
				};
			});
		},

		showAllTopCells: () => {
			update((state) => {
				if (!state.document || !state.sceneIndex) return state;
				const topCellSelection = state.sceneIndex.showAllTopCells();
				const selectedBounds = state.sceneIndex.getSelectedBounds(topCellSelection);
				return {
					...state,
					topCellSelection,
					selectedBounds,
					renderDocument: createRenderDocument(state.document, topCellSelection, selectedBounds),
					renderDiagnostics: pendingRenderDiagnostics(),
				};
			});
		},

		/**
		 * Set rendering state
		 */
		setRendering: (isRendering: boolean, message = "", progress = 0) => {
			update((state) => ({
				...state,
				isRendering,
				loadingMessage: message,
				loadingProgress: progress,
				renderDiagnostics:
					isRendering && progress === 0 ? pendingRenderDiagnostics() : state.renderDiagnostics,
			}));
		},

		setRenderDiagnostics: (renderDiagnostics: RenderDiagnostics) => {
			update((state) => ({ ...state, renderDiagnostics }));
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
				renderDiagnostics: isLoading ? pendingRenderDiagnostics() : state.renderDiagnostics,
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

function createRenderDocument(
	document: GDSDocument,
	selection: TopCellSelection,
	bounds: BoundingBox | null,
): GDSDocument | null {
	if (selection.mode === "required" || !bounds) return null;
	return {
		...document,
		topCells: selection.mode === "all" ? [...document.topCells] : [selection.cellName],
		boundingBox: { ...bounds },
	};
}
