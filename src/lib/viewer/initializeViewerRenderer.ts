import type { GDSDocument } from "../../types/gds";
import type { RenderDiagnostics } from "../diagnostics/renderDiagnostics";
import { PixiRenderer, type ViewportState } from "../renderer/PixiRenderer";

export interface InitialRenderProgress {
	progress: number;
	message: string;
	diagnostics?: RenderDiagnostics;
}

export interface ViewerRendererBootstrapOptions {
	canvas: HTMLCanvasElement;
	initialDocument: GDSDocument | null;
	onViewportChanged: (viewportState: ViewportState) => void;
	onInitialRenderProgress: (update: InitialRenderProgress) => void;
}

export interface ViewerRendererBootstrapResult {
	renderer: PixiRenderer;
	initialDocumentRendered: boolean;
}

/**
 * Creates and initializes PixiRenderer, including optional initial document render.
 */
export async function initializeViewerRenderer(
	options: ViewerRendererBootstrapOptions,
): Promise<ViewerRendererBootstrapResult> {
	const renderer = new PixiRenderer();
	await renderer.init(options.canvas);
	renderer.setOnViewportChanged(options.onViewportChanged);

	let initialDocumentRendered = false;
	if (options.initialDocument) {
		await renderer.renderGDSDocument(options.initialDocument, (progress, message, diagnostics) => {
			options.onInitialRenderProgress({ progress, message, diagnostics });
		});
		initialDocumentRendered = true;
	}

	return { renderer, initialDocumentRendered };
}
