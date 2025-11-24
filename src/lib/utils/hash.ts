/**
 * Hash Utility - Compute SHA-256 hashes for file validation
 */

import { DEBUG } from "../config";

/**
 * Compute SHA-256 hash of an ArrayBuffer
 * @param buffer - The data to hash
 * @returns Hex string representation of the hash
 * @throws Error if crypto.subtle is not available (requires HTTPS or localhost)
 */
export async function computeSHA256(buffer: ArrayBuffer): Promise<string> {
	if (DEBUG) {
		console.log(`[hash] Computing SHA-256 hash for ${buffer.byteLength} bytes`);
	}

	// Check if crypto.subtle is available (requires secure context: HTTPS or localhost)
	if (!crypto.subtle) {
		throw new Error(
			"crypto.subtle is not available. File hashing requires a secure context (HTTPS or localhost).",
		);
	}

	const startTime = performance.now();

	// Use Web Crypto API for efficient hashing
	const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

	// Convert ArrayBuffer to hex string
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

	const elapsed = performance.now() - startTime;
	if (DEBUG) {
		console.log(`[hash] Hash computed in ${elapsed.toFixed(0)}ms: ${hashHex.substring(0, 16)}...`);
	}

	return hashHex;
}
