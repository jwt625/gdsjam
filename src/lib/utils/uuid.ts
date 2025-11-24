/**
 * UUID Generation Utility
 *
 * Provides UUID v4 generation with Safari iOS compatibility.
 * Safari on iOS doesn't support crypto.randomUUID() in older versions,
 * so we provide a fallback implementation.
 */

/**
 * Generate UUID v4 compatible with Safari on iOS
 * Fallback for crypto.randomUUID() which is not supported in older Safari versions
 */
export function generateUUID(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}

	// Fallback implementation for Safari iOS
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}
