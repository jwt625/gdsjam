/**
 * Touch Controller
 * Handles touch controls for panning and pinch zoom
 */

export interface TouchControllerCallbacks {
	onPan: (dx: number, dy: number) => void;
	onZoom: (
		zoomFactor: number,
		centerX: number,
		centerY: number,
		worldPosX: number,
		worldPosY: number,
	) => void;
	onCoordinatesUpdate: (canvasX: number, canvasY: number) => void;
}

export class TouchController {
	private canvas: HTMLCanvasElement;
	private callbacks: TouchControllerCallbacks;
	private touches: Map<number, { x: number; y: number }> = new Map();
	private lastTouchDistance = 0;

	// Event handler references for cleanup
	private touchStartHandler: (e: TouchEvent) => void;
	private touchMoveHandler: (e: TouchEvent) => void;
	private touchEndHandler: (e: TouchEvent) => void;
	private touchCancelHandler: (e: TouchEvent) => void;

	constructor(canvas: HTMLCanvasElement, callbacks: TouchControllerCallbacks) {
		this.canvas = canvas;
		this.callbacks = callbacks;

		// Bind event handlers
		this.touchStartHandler = this.onTouchStart.bind(this);
		this.touchMoveHandler = this.onTouchMove.bind(this);
		this.touchEndHandler = this.onTouchEnd.bind(this);
		this.touchCancelHandler = this.onTouchCancel.bind(this);

		// Attach event listeners
		this.canvas.addEventListener("touchstart", this.touchStartHandler);
		this.canvas.addEventListener("touchmove", this.touchMoveHandler);
		this.canvas.addEventListener("touchend", this.touchEndHandler);
		this.canvas.addEventListener("touchcancel", this.touchCancelHandler);
	}

	private onTouchStart(e: TouchEvent): void {
		e.preventDefault();

		// Update touch tracking
		for (let i = 0; i < e.touches.length; i++) {
			const touch = e.touches.item(i);
			if (touch) {
				this.touches.set(touch.identifier, {
					x: touch.clientX,
					y: touch.clientY,
				});
			}
		}

		// Initialize pinch distance for two-finger zoom
		if (e.touches.length === 2) {
			const touch1 = e.touches.item(0);
			const touch2 = e.touches.item(1);
			if (touch1 && touch2) {
				const dx = touch2.clientX - touch1.clientX;
				const dy = touch2.clientY - touch1.clientY;
				this.lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
			}
		}
	}

	private onTouchMove(e: TouchEvent): void {
		e.preventDefault();

		if (e.touches.length === 1) {
			// One-finger pan
			const touch = e.touches.item(0);
			if (!touch) return;

			const lastTouch = this.touches.get(touch.identifier);

			if (lastTouch) {
				const dx = touch.clientX - lastTouch.x;
				const dy = touch.clientY - lastTouch.y;

				this.callbacks.onPan(dx, dy);
			}

			// Update touch position
			this.touches.set(touch.identifier, {
				x: touch.clientX,
				y: touch.clientY,
			});

			// Update coordinates display for touch
			const rect = this.canvas.getBoundingClientRect();
			const canvasX = touch.clientX - rect.left;
			const canvasY = touch.clientY - rect.top;

			this.callbacks.onCoordinatesUpdate(canvasX, canvasY);
		} else if (e.touches.length === 2) {
			// Two-finger pinch zoom
			const touch1 = e.touches.item(0);
			const touch2 = e.touches.item(1);
			if (!touch1 || !touch2) return;

			// Calculate current distance between touches
			const dx = touch2.clientX - touch1.clientX;
			const dy = touch2.clientY - touch1.clientY;
			const currentDistance = Math.sqrt(dx * dx + dy * dy);

			if (this.lastTouchDistance > 0) {
				// Calculate zoom factor based on pinch distance change
				const zoomFactor = currentDistance / this.lastTouchDistance;

				// Calculate center point between two touches
				const rect = this.canvas.getBoundingClientRect();
				const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
				const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

				// Note: worldPos calculation is done in the callback
				this.callbacks.onZoom(zoomFactor, centerX, centerY, 0, 0);
			}

			// Update distance for next frame
			this.lastTouchDistance = currentDistance;

			// Update touch positions
			this.touches.set(touch1.identifier, {
				x: touch1.clientX,
				y: touch1.clientY,
			});
			this.touches.set(touch2.identifier, {
				x: touch2.clientX,
				y: touch2.clientY,
			});
		}
	}

	private onTouchEnd(e: TouchEvent): void {
		e.preventDefault();

		// Remove ended touches from tracking
		const activeTouchIds = new Set<number>();
		for (let i = 0; i < e.touches.length; i++) {
			const touch = e.touches.item(i);
			if (touch) {
				activeTouchIds.add(touch.identifier);
			}
		}

		// Clean up touches that ended
		for (const touchId of this.touches.keys()) {
			if (!activeTouchIds.has(touchId)) {
				this.touches.delete(touchId);
			}
		}

		// Reset pinch distance when not exactly 2 touches
		if (e.touches.length !== 2) {
			this.lastTouchDistance = 0;
		}
	}

	private onTouchCancel(e: TouchEvent): void {
		e.preventDefault();
		// Clear all touch tracking on cancel
		this.touches.clear();
		this.lastTouchDistance = 0;
	}

	destroy(): void {
		// Remove all event listeners
		this.canvas.removeEventListener("touchstart", this.touchStartHandler);
		this.canvas.removeEventListener("touchmove", this.touchMoveHandler);
		this.canvas.removeEventListener("touchend", this.touchEndHandler);
		this.canvas.removeEventListener("touchcancel", this.touchCancelHandler);
	}
}
