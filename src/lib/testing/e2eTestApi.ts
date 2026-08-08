import { get } from "svelte/store";
import { type GDSState, gdsStore } from "../../stores/gdsStore";
import type { BoundingBox } from "../../types/gds";
import type { RenderDiagnostics } from "../diagnostics/renderDiagnostics";
import type { TopCellSelection } from "../layout/LayoutSceneIndex";
import type { CompleteOverviewTelemetry } from "../renderer/overview/CompleteOverview";
import type { PixiRenderer } from "../renderer/PixiRenderer";
import { loadGDSIIFromBuffer } from "../utils/gdsLoader";

export const E2E_LIFECYCLE_EVENT = "gdsjam:e2e-lifecycle";

export type E2ELifecyclePhase =
	| "api-ready"
	| "fixture-load-started"
	| "document-loaded"
	| "render-started"
	| "render-idle"
	| "error";

export interface E2ELifecycleDetail {
	phase: E2ELifecyclePhase;
	fileName: string | null;
	completeness: RenderDiagnostics["status"];
}

export interface SemanticDigest {
	sha256: string;
	snapshot: {
		fileName: string | null;
		topCells: string[];
		cellCount: number;
		polygonCount: number;
		instanceCount: number;
		layers: string[];
		bounds: BoundingBox | null;
		units: { database: number; user: number } | null;
		semanticElements: {
			boxes: Array<{
				cellName: string;
				layer: number;
				boxType: number;
				bounds: BoundingBox;
			}>;
			textMarkers: Array<{
				cellName: string;
				content: string;
				layer: number;
				textType: number;
				origin: { x: number; y: number };
				representation: "origin-marker";
			}>;
		};
	};
}

export interface GDSJamTestApi {
	readonly version: 1;
	loadFixture(arrayBuffer: ArrayBuffer, fileName?: string): Promise<void>;
	waitForRenderIdle(options?: { timeoutMs?: number }): Promise<RenderDiagnostics>;
	getCompleteness(): RenderDiagnostics["status"];
	getDiagnostics(): RenderDiagnostics;
	getCompleteOverviewTelemetry(): CompleteOverviewTelemetry | null;
	getRenderScope(): {
		selection: TopCellSelection;
		aggregateBounds: BoundingBox | null;
		selectedBounds: BoundingBox | null;
	};
	getWorldViewport(): BoundingBox;
	setWorldViewport(bounds: BoundingBox): Promise<BoundingBox>;
	getSemanticDigest(): Promise<SemanticDigest>;
}

declare global {
	interface Window {
		__GDSJAM_TEST__?: GDSJamTestApi;
	}
}

function emit(phase: E2ELifecyclePhase, state = get(gdsStore)): void {
	window.dispatchEvent(
		new CustomEvent<E2ELifecycleDetail>(E2E_LIFECYCLE_EVENT, {
			detail: {
				phase,
				fileName: state.fileName,
				completeness: state.renderDiagnostics.status,
			},
		}),
	);
}

function cloneDiagnostics(diagnostics: RenderDiagnostics): RenderDiagnostics {
	return {
		...diagnostics,
		issues: diagnostics.issues.map((issue) => ({ ...issue })),
	};
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function sha256(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function installE2ETestApi(getRenderer: () => PixiRenderer | null): () => void {
	let previous: Pick<GDSState, "fileName" | "isRendering" | "isLoading" | "error"> | null = null;
	const unsubscribe = gdsStore.subscribe((state) => {
		if (state.error && state.error !== previous?.error) emit("error", state);
		if (state.fileName && state.fileName !== previous?.fileName) emit("document-loaded", state);
		if (state.isRendering && !previous?.isRendering) emit("render-started", state);
		if (
			previous?.isRendering &&
			!state.isRendering &&
			!state.isLoading &&
			state.renderDiagnostics.status !== "pending"
		) {
			emit("render-idle", state);
		}
		previous = {
			fileName: state.fileName,
			isRendering: state.isRendering,
			isLoading: state.isLoading,
			error: state.error,
		};
	});

	const api: GDSJamTestApi = {
		version: 1,
		async loadFixture(arrayBuffer, fileName = "e2e-fixture.gds") {
			emit("fixture-load-started");
			await loadGDSIIFromBuffer(arrayBuffer, fileName);
			const state = get(gdsStore);
			if (state.error) throw new Error(state.error);
		},
		waitForRenderIdle({ timeoutMs = 15_000 } = {}) {
			return new Promise((resolve, reject) => {
				const isIdle = (state: GDSState) =>
					getRenderer()?.isReady() &&
					!state.isLoading &&
					!state.isRendering &&
					state.renderDiagnostics.status !== "pending";
				const current = get(gdsStore);
				if (current.error) {
					reject(new Error(current.error));
					return;
				}
				if (isIdle(current)) {
					resolve(cloneDiagnostics(current.renderDiagnostics));
					return;
				}

				let stop: () => void;
				const timeout = window.setTimeout(() => {
					stop();
					reject(new Error(`Render did not become idle within ${timeoutMs} ms`));
				}, timeoutMs);
				stop = gdsStore.subscribe((state) => {
					if (state.error) {
						window.clearTimeout(timeout);
						stop();
						reject(new Error(state.error));
						return;
					}
					if (isIdle(state)) {
						window.clearTimeout(timeout);
						stop();
						resolve(cloneDiagnostics(state.renderDiagnostics));
					}
				});
			});
		},
		getCompleteness() {
			return get(gdsStore).renderDiagnostics.status;
		},
		getDiagnostics() {
			return cloneDiagnostics(get(gdsStore).renderDiagnostics);
		},
		getCompleteOverviewTelemetry() {
			return getRenderer()?.getCompleteOverviewTelemetry() ?? null;
		},
		getRenderScope() {
			const state = get(gdsStore);
			return {
				selection: { ...state.topCellSelection },
				aggregateBounds: state.aggregateBounds ? { ...state.aggregateBounds } : null,
				selectedBounds: state.selectedBounds ? { ...state.selectedBounds } : null,
			};
		},
		getWorldViewport() {
			const renderer = getRenderer();
			if (!renderer) throw new Error("Renderer is not ready");
			return { ...renderer.getPublicViewportBounds() };
		},
		async setWorldViewport(bounds) {
			const renderer = getRenderer();
			if (!renderer) throw new Error("Renderer is not ready");
			renderer.setPublicViewportBounds(bounds);
			await nextFrame();
			return { ...renderer.getPublicViewportBounds() };
		},
		async getSemanticDigest() {
			const state = get(gdsStore);
			const document = state.document;
			const cells = document
				? Array.from(document.cells.values()).sort((a, b) => compareStrings(a.name, b.name))
				: [];
			const snapshot: SemanticDigest["snapshot"] = {
				fileName: state.fileName,
				topCells: document ? [...document.topCells].sort() : [],
				cellCount: document?.cells.size ?? 0,
				polygonCount: document
					? Array.from(document.cells.values()).reduce((sum, cell) => sum + cell.polygons.length, 0)
					: 0,
				instanceCount: document
					? Array.from(document.cells.values()).reduce(
							(sum, cell) => sum + cell.instances.length,
							0,
						)
					: 0,
				layers: document ? Array.from(document.layers.keys()).sort() : [],
				bounds: document ? { ...document.boundingBox } : null,
				units: document ? { ...document.units } : null,
				semanticElements: {
					boxes: cells
						.flatMap((cell) =>
							cell.polygons
								.filter((polygon) => polygon.sourceType === "box")
								.map((polygon) => ({
									cellName: cell.name,
									layer: polygon.layer,
									boxType: polygon.boxType ?? polygon.datatype,
									bounds: { ...polygon.boundingBox },
								})),
						)
						.sort(
							(a, b) =>
								compareStrings(a.cellName, b.cellName) ||
								a.layer - b.layer ||
								a.boxType - b.boxType ||
								a.bounds.minX - b.bounds.minX ||
								a.bounds.minY - b.bounds.minY ||
								a.bounds.maxX - b.bounds.maxX ||
								a.bounds.maxY - b.bounds.maxY,
						),
					textMarkers: cells
						.flatMap((cell) =>
							cell.texts.map((label) => ({
								cellName: cell.name,
								content: label.content,
								layer: label.layer,
								textType: label.textType,
								origin: { ...label.origin },
								representation: label.boundsKind,
							})),
						)
						.sort(
							(a, b) =>
								compareStrings(a.cellName, b.cellName) ||
								a.layer - b.layer ||
								a.textType - b.textType ||
								compareStrings(a.content, b.content) ||
								a.origin.x - b.origin.x ||
								a.origin.y - b.origin.y,
						),
				},
			};
			return { sha256: await sha256(JSON.stringify(snapshot)), snapshot };
		},
	};

	window.__GDSJAM_TEST__ = api;
	emit("api-ready");
	return () => {
		unsubscribe();
		delete window.__GDSJAM_TEST__;
	};
}
