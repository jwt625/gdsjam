/**
 * ViewerKeyModeController
 *
 * Encapsulates key handling for viewer mode toggles:
 * - F: short press fit-to-view, hold fullscreen
 * - C: short press comment mode, double press comment panel, hold comment visibility toggle
 * - E: hold editor mode toggle
 * - M: short press minimap toggle, hold measurement mode toggle
 */

const FULLSCREEN_HOLD_DURATION_MS = 500;
const COMMENT_HOLD_DURATION_MS = 500;
const EDITOR_HOLD_DURATION_MS = 500;
const MEASUREMENT_HOLD_DURATION_MS = 500;
const DOUBLE_CLICK_INTERVAL_MS = 300;

export interface ViewerKeyModeCallbacks {
	isInputFocused: (event: KeyboardEvent) => boolean;
	toggleFullscreen: () => void;
	fitToView: () => void;
	toggleCommentVisibility: () => void;
	toggleCommentMode: () => void;
	toggleCommentPanel: () => void;
	toggleEditorMode: () => void;
	toggleMeasurementMode: () => void;
	toggleMinimap: () => void;
}

export class ViewerKeyModeController {
	private readonly callbacks: ViewerKeyModeCallbacks;

	private fKeyDownTime: number | null = null;
	private fKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;
	private fKeyTriggeredFullscreen = false;

	private cKeyDownTime: number | null = null;
	private cKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;
	private cKeyTriggeredHold = false;
	private lastCKeyPressTime: number | null = null;

	private eKeyDownTime: number | null = null;
	private eKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;

	private mKeyDownTime: number | null = null;
	private mKeyHoldTimer: ReturnType<typeof setTimeout> | null = null;
	private mKeyTriggeredHold = false;

	constructor(callbacks: ViewerKeyModeCallbacks) {
		this.callbacks = callbacks;
	}

	handleKeyDown = (event: KeyboardEvent): void => {
		if (this.callbacks.isInputFocused(event)) return;

		switch (event.code) {
			case "KeyF":
				this.handleFKeyDown(event);
				return;
			case "KeyC":
				this.handleCKeyDown(event);
				return;
			case "KeyE":
				this.handleEKeyDown(event);
				return;
			case "KeyM":
				this.handleMKeyDown(event);
				return;
		}
	};

	handleKeyUp = (event: KeyboardEvent): void => {
		switch (event.code) {
			case "KeyF":
				this.handleFKeyUp(event);
				return;
			case "KeyC":
				this.handleCKeyUp(event);
				return;
			case "KeyE":
				this.handleEKeyUp(event);
				return;
			case "KeyM":
				this.handleMKeyUp(event);
				return;
		}
	};

	destroy(): void {
		if (this.fKeyHoldTimer) clearTimeout(this.fKeyHoldTimer);
		if (this.cKeyHoldTimer) clearTimeout(this.cKeyHoldTimer);
		if (this.eKeyHoldTimer) clearTimeout(this.eKeyHoldTimer);
		if (this.mKeyHoldTimer) clearTimeout(this.mKeyHoldTimer);

		this.fKeyDownTime = null;
		this.fKeyHoldTimer = null;
		this.fKeyTriggeredFullscreen = false;
		this.cKeyDownTime = null;
		this.cKeyHoldTimer = null;
		this.cKeyTriggeredHold = false;
		this.lastCKeyPressTime = null;
		this.eKeyDownTime = null;
		this.eKeyHoldTimer = null;
		this.mKeyDownTime = null;
		this.mKeyHoldTimer = null;
		this.mKeyTriggeredHold = false;
	}

	private handleFKeyDown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
		if (event.repeat) return;

		event.preventDefault();
		this.fKeyDownTime = Date.now();
		this.fKeyTriggeredFullscreen = false;

		this.fKeyHoldTimer = setTimeout(() => {
			this.fKeyTriggeredFullscreen = true;
			this.callbacks.toggleFullscreen();
		}, FULLSCREEN_HOLD_DURATION_MS);
	}

	private handleFKeyUp(_event: KeyboardEvent): void {
		if (this.fKeyHoldTimer) {
			clearTimeout(this.fKeyHoldTimer);
			this.fKeyHoldTimer = null;
		}

		if (!this.fKeyTriggeredFullscreen && this.fKeyDownTime !== null) {
			const holdDuration = Date.now() - this.fKeyDownTime;
			if (holdDuration < FULLSCREEN_HOLD_DURATION_MS) {
				this.callbacks.fitToView();
			}
		}

		this.fKeyDownTime = null;
		this.fKeyTriggeredFullscreen = false;
	}

	private handleCKeyDown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
		if (event.repeat) return;

		event.preventDefault();
		this.cKeyDownTime = Date.now();
		this.cKeyTriggeredHold = false;

		this.cKeyHoldTimer = setTimeout(() => {
			this.cKeyTriggeredHold = true;
			this.callbacks.toggleCommentVisibility();
		}, COMMENT_HOLD_DURATION_MS);
	}

	private handleCKeyUp(_event: KeyboardEvent): void {
		if (this.cKeyHoldTimer) {
			clearTimeout(this.cKeyHoldTimer);
			this.cKeyHoldTimer = null;
		}

		if (this.cKeyTriggeredHold) {
			this.cKeyDownTime = null;
			this.cKeyTriggeredHold = false;
			return;
		}

		const now = Date.now();
		const isDoubleClick =
			this.lastCKeyPressTime !== null && now - this.lastCKeyPressTime < DOUBLE_CLICK_INTERVAL_MS;

		if (isDoubleClick) {
			this.callbacks.toggleCommentPanel();
			this.lastCKeyPressTime = null;
		} else {
			if (this.cKeyDownTime !== null) {
				const holdDuration = now - this.cKeyDownTime;
				if (holdDuration < COMMENT_HOLD_DURATION_MS) {
					this.callbacks.toggleCommentMode();
				}
			}
			this.lastCKeyPressTime = now;
		}

		this.cKeyDownTime = null;
		this.cKeyTriggeredHold = false;
	}

	private handleEKeyDown(_event: KeyboardEvent): void {
		if (this.eKeyDownTime !== null) return;
		this.eKeyDownTime = Date.now();

		this.eKeyHoldTimer = setTimeout(() => {
			this.callbacks.toggleEditorMode();
		}, EDITOR_HOLD_DURATION_MS);
	}

	private handleEKeyUp(_event: KeyboardEvent): void {
		if (this.eKeyHoldTimer) {
			clearTimeout(this.eKeyHoldTimer);
			this.eKeyHoldTimer = null;
		}
		this.eKeyDownTime = null;
	}

	private handleMKeyDown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
		if (event.repeat) return;

		event.preventDefault();
		this.mKeyDownTime = Date.now();
		this.mKeyTriggeredHold = false;

		this.mKeyHoldTimer = setTimeout(() => {
			this.mKeyTriggeredHold = true;
			this.callbacks.toggleMeasurementMode();
		}, MEASUREMENT_HOLD_DURATION_MS);
	}

	private handleMKeyUp(_event: KeyboardEvent): void {
		if (this.mKeyHoldTimer) {
			clearTimeout(this.mKeyHoldTimer);
			this.mKeyHoldTimer = null;
		}

		if (this.mKeyTriggeredHold) {
			this.mKeyDownTime = null;
			this.mKeyTriggeredHold = false;
			return;
		}

		if (this.mKeyDownTime !== null) {
			const holdDuration = Date.now() - this.mKeyDownTime;
			if (holdDuration < MEASUREMENT_HOLD_DURATION_MS) {
				this.callbacks.toggleMinimap();
			}
		}

		this.mKeyDownTime = null;
		this.mKeyTriggeredHold = false;
	}
}
