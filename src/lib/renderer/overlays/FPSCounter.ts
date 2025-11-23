/**
 * FPSCounter - Tracks and displays frames per second
 *
 * Responsibilities:
 * - Count frames rendered per second
 * - Update FPS display at configurable interval
 * - Provide current FPS value for performance metrics
 *
 * Implementation:
 * - Called on every render tick via onTick()
 * - Updates display text only when update interval elapses
 * - Calculates FPS as: (frame count * 1000) / elapsed time
 */

import type { Text } from "pixi.js";

export class FPSCounter {
	private text: Text;
	private lastFrameTime: number;
	private frameCount: number;
	private updateInterval: number;
	private currentFPS = 0;

	constructor(text: Text, updateInterval: number) {
		this.text = text;
		this.updateInterval = updateInterval;
		this.lastFrameTime = performance.now();
		this.frameCount = 0;
	}

	/**
	 * Called on every render tick
	 */
	onTick(): void {
		this.frameCount++;
		const now = performance.now();
		const elapsed = now - this.lastFrameTime;

		if (elapsed >= this.updateInterval) {
			const fps = Math.round((this.frameCount * 1000) / elapsed);
			this.currentFPS = fps;
			this.text.text = `FPS: ${fps}`;
			this.frameCount = 0;
			this.lastFrameTime = now;
		}
	}

	/**
	 * Update text position (called on window resize)
	 */
	updatePosition(screenWidth: number): void {
		this.text.x = screenWidth - 80;
	}

	/**
	 * Get current FPS value
	 */
	getCurrentFPS(): number {
		return this.currentFPS;
	}
}
