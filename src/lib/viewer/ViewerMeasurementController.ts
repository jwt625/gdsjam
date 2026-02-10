import type { MeasurementPoint } from "../measurements/types";
import { snapToAxis } from "../measurements/utils";
import type { PixiRenderer } from "../renderer/PixiRenderer";

interface DocumentUnits {
	database: number;
	user: number;
}

interface WorldPoint {
	worldX: number;
	worldY: number;
}

export interface ViewerMeasurementControllerCallbacks {
	getRenderer: () => PixiRenderer | null;
	getCanvas: () => HTMLCanvasElement | null;
	getDocumentUnits: () => DocumentUnits;
	getActiveMeasurementPoint1: () => MeasurementPoint | null;
	setCursorWorldPos: (point: WorldPoint | null) => void;
	addMeasurementPoint: (worldX: number, worldY: number, units: DocumentUnits) => void;
	exitMeasurementMode: () => void;
}

/**
 * Handles measurement-specific pointer/touch logic for ViewerCanvas.
 */
export class ViewerMeasurementController {
	private readonly callbacks: ViewerMeasurementControllerCallbacks;
	private readonly mobileBreakpoint: number;

	constructor(callbacks: ViewerMeasurementControllerCallbacks, mobileBreakpoint = 1024) {
		this.callbacks = callbacks;
		this.mobileBreakpoint = mobileBreakpoint;
	}

	handleMeasurementCanvasClick(event: MouseEvent | PointerEvent): boolean {
		const renderer = this.callbacks.getRenderer();
		const canvas = this.callbacks.getCanvas();
		if (!renderer || !canvas) return false;

		// For touch devices in mobile mode, use touch-and-drag gesture instead
		if (
			"pointerType" in event &&
			event.pointerType === "touch" &&
			window.innerWidth < this.mobileBreakpoint
		) {
			return true;
		}

		const point = this.toWorldPoint(event.clientX, event.clientY, canvas, renderer);
		const snappedPoint = this.maybeSnapToAxis(point, event.shiftKey);
		this.callbacks.addMeasurementPoint(
			snappedPoint.worldX,
			snappedPoint.worldY,
			this.callbacks.getDocumentUnits(),
		);
		return true;
	}

	handleMouseMove(event: MouseEvent, measurementModeActive: boolean): void {
		const renderer = this.callbacks.getRenderer();
		const canvas = this.callbacks.getCanvas();
		if (!measurementModeActive || !renderer || !canvas) {
			this.callbacks.setCursorWorldPos(null);
			return;
		}

		const point = this.toWorldPoint(event.clientX, event.clientY, canvas, renderer);
		this.callbacks.setCursorWorldPos(this.maybeSnapToAxis(point, event.shiftKey));
	}

	handleTouchStart(event: TouchEvent): void {
		const renderer = this.callbacks.getRenderer();
		const canvas = this.callbacks.getCanvas();
		if (!renderer || !canvas) return;

		// Two-finger touch: exit measurement mode and allow zoom gesture
		if (event.touches.length >= 2) {
			this.callbacks.exitMeasurementMode();
			return;
		}

		event.stopImmediatePropagation();
		event.preventDefault();

		if (event.touches.length !== 1) return;
		const touch = event.touches[0];
		if (!touch) return;

		const point = this.toWorldPoint(touch.clientX, touch.clientY, canvas, renderer);
		this.callbacks.addMeasurementPoint(
			point.worldX,
			point.worldY,
			this.callbacks.getDocumentUnits(),
		);
		this.callbacks.setCursorWorldPos(point);
	}

	handleTouchMove(event: TouchEvent): void {
		const renderer = this.callbacks.getRenderer();
		const canvas = this.callbacks.getCanvas();
		if (!renderer || !canvas) return;

		event.stopImmediatePropagation();
		event.preventDefault();

		if (event.touches.length !== 1) return;
		const touch = event.touches[0];
		if (!touch) return;

		const point = this.toWorldPoint(touch.clientX, touch.clientY, canvas, renderer);
		this.callbacks.setCursorWorldPos(this.maybeSnapToAxis(point, event.shiftKey));
	}

	handleTouchEnd(event: TouchEvent): void {
		const renderer = this.callbacks.getRenderer();
		const canvas = this.callbacks.getCanvas();
		if (!renderer || !canvas) return;

		event.stopImmediatePropagation();
		event.preventDefault();

		if (event.changedTouches.length !== 1) return;
		const touch = event.changedTouches[0];
		if (!touch) return;

		const point = this.toWorldPoint(touch.clientX, touch.clientY, canvas, renderer);
		const snappedPoint = this.maybeSnapToAxis(point, event.shiftKey);
		this.callbacks.addMeasurementPoint(
			snappedPoint.worldX,
			snappedPoint.worldY,
			this.callbacks.getDocumentUnits(),
		);
		this.callbacks.setCursorWorldPos(null);
	}

	private toWorldPoint(
		clientX: number,
		clientY: number,
		canvas: HTMLCanvasElement,
		renderer: PixiRenderer,
	): WorldPoint {
		const rect = canvas.getBoundingClientRect();
		const screenX = clientX - rect.left;
		const screenY = clientY - rect.top;

		const viewportState = renderer.getViewportState();
		const worldX = (screenX - viewportState.x) / viewportState.scale;
		const worldY = -((screenY - viewportState.y) / viewportState.scale);

		return { worldX, worldY };
	}

	private maybeSnapToAxis(point: WorldPoint, shiftKey: boolean): WorldPoint {
		if (!shiftKey) return point;
		const point1 = this.callbacks.getActiveMeasurementPoint1();
		if (!point1) return point;
		return snapToAxis(point1, point);
	}
}
