/**
 * InputController - Coordinates mouse, keyboard, and touch input controllers
 *
 * Responsibilities:
 * - Instantiate and manage MouseController and TouchController
 * - Register renderer-related keyboard shortcuts via KeyboardShortcutManager
 * - Provide unified callback interface for all input types
 * - Ensure proper cleanup of event listeners on destroy
 *
 * Supported Input:
 * - Mouse: Wheel zoom, middle-button pan, Space+drag pan, coordinate tracking
 * - Keyboard: Arrow keys pan, Enter/Shift+Enter zoom, G grid toggle
 *   (F key is handled in ViewerCanvas for hold detection: short press = fit view, hold = fullscreen)
 * - Touch: One-finger pan, two-finger pinch zoom
 */

import { KeyboardShortcutManager } from "../../keyboard/KeyboardShortcutManager";
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

const OWNER_ID = "InputController";

export class InputController {
	private mouseController: MouseController;
	private touchController: TouchController;

	constructor(canvas: HTMLCanvasElement, callbacks: InputControllerCallbacks) {
		// Create mouse controller
		this.mouseController = new MouseController(canvas, {
			onZoom: callbacks.onZoom,
			onPan: callbacks.onPan,
			onCoordinatesUpdate: callbacks.onCoordinatesUpdate,
		});

		// Create touch controller
		this.touchController = new TouchController(canvas, {
			onPan: callbacks.onPan,
			onZoom: callbacks.onZoom,
			onCoordinatesUpdate: callbacks.onCoordinatesUpdate,
		});

		// Register keyboard shortcuts via centralized manager
		this.registerKeyboardShortcuts(callbacks);
	}

	/**
	 * Register renderer-related keyboard shortcuts
	 */
	private registerKeyboardShortcuts(callbacks: InputControllerCallbacks): void {
		const panStep = 50; // pixels

		KeyboardShortcutManager.registerMany(OWNER_ID, [
			// Arrow keys for panning
			{
				id: "pan-up",
				key: "ArrowUp",
				callback: () => callbacks.onPan(0, panStep),
				description: "Pan up",
			},
			{
				id: "pan-down",
				key: "ArrowDown",
				callback: () => callbacks.onPan(0, -panStep),
				description: "Pan down",
			},
			{
				id: "pan-left",
				key: "ArrowLeft",
				callback: () => callbacks.onPan(panStep, 0),
				description: "Pan left",
			},
			{
				id: "pan-right",
				key: "ArrowRight",
				callback: () => callbacks.onPan(-panStep, 0),
				description: "Pan right",
			},
			// Enter for zoom in
			{
				id: "zoom-in",
				key: "Enter",
				callback: () => {
					const center = callbacks.getScreenCenter();
					callbacks.onZoom(1.1, center.x, center.y, 0, 0);
				},
				description: "Zoom in",
			},
			// Shift+Enter for zoom out
			{
				id: "zoom-out",
				key: "Enter",
				modifiers: { shift: true },
				callback: () => {
					const center = callbacks.getScreenCenter();
					callbacks.onZoom(0.9, center.x, center.y, 0, 0);
				},
				description: "Zoom out",
			},
			// G key for grid toggle
			// Note: F key is handled in ViewerCanvas with hold detection for fullscreen
			{
				id: "toggle-grid",
				key: "KeyG",
				callback: () => callbacks.onToggleGrid(),
				description: "Toggle grid",
			},
		]);
	}

	destroy(): void {
		this.mouseController.destroy();
		this.touchController.destroy();
		KeyboardShortcutManager.unregisterByOwner(OWNER_ID);
	}
}
