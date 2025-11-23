/**
 * Keyboard Controller
 * Handles keyboard controls for panning, zooming, and toggling features
 */

export interface KeyboardControllerCallbacks {
	onPan: (dx: number, dy: number) => void;
	onZoom: (
		zoomFactor: number,
		centerX: number,
		centerY: number,
		worldPosX: number,
		worldPosY: number,
	) => void;
	onFitToView: () => void;
	onToggleGrid: () => void;
	getScreenCenter: () => { x: number; y: number };
}

export class KeyboardController {
	private callbacks: KeyboardControllerCallbacks;
	private keyDownHandler: (e: KeyboardEvent) => void;

	constructor(callbacks: KeyboardControllerCallbacks) {
		this.callbacks = callbacks;

		// Bind event handler
		this.keyDownHandler = this.onKeyDown.bind(this);

		// Attach event listener
		window.addEventListener("keydown", this.keyDownHandler);
	}

	private onKeyDown(e: KeyboardEvent): void {
		// Arrow keys for panning
		const panStep = 50; // pixels
		if (e.code === "ArrowUp") {
			this.callbacks.onPan(0, panStep);
			e.preventDefault();
		} else if (e.code === "ArrowDown") {
			this.callbacks.onPan(0, -panStep);
			e.preventDefault();
		} else if (e.code === "ArrowLeft") {
			this.callbacks.onPan(panStep, 0);
			e.preventDefault();
		} else if (e.code === "ArrowRight") {
			this.callbacks.onPan(-panStep, 0);
			e.preventDefault();
		}

		// Enter for zoom in, Shift+Enter for zoom out
		if (e.code === "Enter") {
			const zoomFactor = e.shiftKey ? 0.9 : 1.1;
			const center = this.callbacks.getScreenCenter();

			// Note: worldPos calculation is done in the callback
			this.callbacks.onZoom(zoomFactor, center.x, center.y, 0, 0);
			e.preventDefault();
		}

		// F key for fit to view
		if (e.code === "KeyF") {
			this.callbacks.onFitToView();
			e.preventDefault();
		}

		// G key for grid toggle
		if (e.code === "KeyG") {
			this.callbacks.onToggleGrid();
			e.preventDefault();
		}
	}

	destroy(): void {
		window.removeEventListener("keydown", this.keyDownHandler);
	}
}
