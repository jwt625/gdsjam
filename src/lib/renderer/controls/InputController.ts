/**
 * InputController - Coordinates mouse, keyboard, and touch input controllers
 *
 * Responsibilities:
 * - Instantiate and manage MouseController, KeyboardController, and TouchController
 * - Provide unified callback interface for all input types
 * - Ensure proper cleanup of event listeners on destroy
 *
 * Supported Input:
 * - Mouse: Wheel zoom, middle-button pan, Space+drag pan, coordinate tracking
 * - Keyboard: Arrow keys pan, Enter/Shift+Enter zoom, F fit-to-view, G grid toggle
 * - Touch: One-finger pan, two-finger pinch zoom
 */

import { KeyboardController } from "./KeyboardController";
import { MouseController } from "./MouseController";
import { TouchController } from "./TouchController";

export interface InputControllerCallbacks {
	onZoom: (
		zoomFactor: number,
		centerX: number,
		centerY: number,
		worldPosX: number,
		worldPosY: number,
	) => void;
	onPan: (dx: number, dy: number) => void;
	onFitToView: () => void;
	onToggleGrid: () => void;
	onCoordinatesUpdate: (mouseX: number, mouseY: number) => void;
	getScreenCenter: () => { x: number; y: number };
}

export class InputController {
	private mouseController: MouseController;
	private keyboardController: KeyboardController;
	private touchController: TouchController;

	constructor(canvas: HTMLCanvasElement, callbacks: InputControllerCallbacks) {
		// Create mouse controller
		this.mouseController = new MouseController(canvas, {
			onZoom: callbacks.onZoom,
			onPan: callbacks.onPan,
			onCoordinatesUpdate: callbacks.onCoordinatesUpdate,
		});

		// Create keyboard controller
		this.keyboardController = new KeyboardController({
			onPan: callbacks.onPan,
			onZoom: callbacks.onZoom,
			onFitToView: callbacks.onFitToView,
			onToggleGrid: callbacks.onToggleGrid,
			getScreenCenter: callbacks.getScreenCenter,
		});

		// Create touch controller
		this.touchController = new TouchController(canvas, {
			onPan: callbacks.onPan,
			onZoom: callbacks.onZoom,
			onCoordinatesUpdate: callbacks.onCoordinatesUpdate,
		});
	}

	destroy(): void {
		this.mouseController.destroy();
		this.keyboardController.destroy();
		this.touchController.destroy();
	}
}
