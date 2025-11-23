/**
 * Mouse Controller
 * Handles mouse wheel zoom and mouse pan (middle button + Space+drag)
 */

export interface MouseControllerCallbacks {
	onZoom: (
		zoomFactor: number,
		centerX: number,
		centerY: number,
		worldPosX: number,
		worldPosY: number,
	) => void;
	onPan: (dx: number, dy: number) => void;
	onCoordinatesUpdate: (mouseX: number, mouseY: number) => void;
}

export class MouseController {
	private canvas: HTMLCanvasElement;
	private callbacks: MouseControllerCallbacks;
	private isPanning = false;
	private lastMouseX = 0;
	private lastMouseY = 0;
	private isSpacePressed = false;

	// Event handler references for cleanup
	private wheelHandler: (e: WheelEvent) => void;
	private mouseDownHandler: (e: MouseEvent) => void;
	private mouseMoveHandler: (e: MouseEvent) => void;
	private mouseUpHandler: () => void;
	private keyDownHandler: (e: KeyboardEvent) => void;
	private keyUpHandler: (e: KeyboardEvent) => void;
	private canvasMouseMoveHandler: (e: MouseEvent) => void;

	constructor(canvas: HTMLCanvasElement, callbacks: MouseControllerCallbacks) {
		this.canvas = canvas;
		this.callbacks = callbacks;

		// Bind event handlers
		this.wheelHandler = this.onWheel.bind(this);
		this.mouseDownHandler = this.onMouseDown.bind(this);
		this.mouseMoveHandler = this.onMouseMove.bind(this);
		this.mouseUpHandler = this.onMouseUp.bind(this);
		this.keyDownHandler = this.onKeyDown.bind(this);
		this.keyUpHandler = this.onKeyUp.bind(this);
		this.canvasMouseMoveHandler = this.onCanvasMouseMove.bind(this);

		// Attach event listeners
		this.canvas.addEventListener("wheel", this.wheelHandler);
		this.canvas.addEventListener("mousedown", this.mouseDownHandler);
		this.canvas.addEventListener("mousemove", this.canvasMouseMoveHandler);
		window.addEventListener("mousemove", this.mouseMoveHandler);
		window.addEventListener("mouseup", this.mouseUpHandler);
		window.addEventListener("keydown", this.keyDownHandler);
		window.addEventListener("keyup", this.keyUpHandler);
	}

	private onWheel(e: WheelEvent): void {
		e.preventDefault();
		const delta = e.deltaY;
		const zoomFactor = delta > 0 ? 0.9 : 1.1;

		// Zoom to cursor position
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;

		// Note: worldPos calculation is done in the callback
		// We pass the screen coordinates and let the renderer calculate world position
		this.callbacks.onZoom(zoomFactor, mouseX, mouseY, 0, 0);
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (e.code === "Space") {
			this.isSpacePressed = true;
			e.preventDefault();
		}
	}

	private onKeyUp(e: KeyboardEvent): void {
		if (e.code === "Space") {
			this.isSpacePressed = false;
		}
	}

	private onMouseDown(e: MouseEvent): void {
		if (e.button === 1 || (e.button === 0 && this.isSpacePressed)) {
			this.isPanning = true;
			this.lastMouseX = e.clientX;
			this.lastMouseY = e.clientY;
			e.preventDefault();
		}
	}

	private onMouseMove(e: MouseEvent): void {
		if (this.isPanning) {
			const dx = e.clientX - this.lastMouseX;
			const dy = e.clientY - this.lastMouseY;

			this.callbacks.onPan(dx, dy);

			this.lastMouseX = e.clientX;
			this.lastMouseY = e.clientY;
		}
	}

	private onMouseUp(): void {
		this.isPanning = false;
	}

	private onCanvasMouseMove(e: MouseEvent): void {
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;

		this.callbacks.onCoordinatesUpdate(mouseX, mouseY);
	}

	destroy(): void {
		// Remove all event listeners
		this.canvas.removeEventListener("wheel", this.wheelHandler);
		this.canvas.removeEventListener("mousedown", this.mouseDownHandler);
		this.canvas.removeEventListener("mousemove", this.canvasMouseMoveHandler);
		window.removeEventListener("mousemove", this.mouseMoveHandler);
		window.removeEventListener("mouseup", this.mouseUpHandler);
		window.removeEventListener("keydown", this.keyDownHandler);
		window.removeEventListener("keyup", this.keyUpHandler);
	}
}
