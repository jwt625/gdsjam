/**
 * Hash Utility - Compute SHA-256 hashes for file validation
 */

/**
 * Compute SHA-256 hash of an ArrayBuffer
 * @param buffer - The data to hash
 * @returns Hex string representation of the hash
 * @throws Error if crypto.subtle is not available (requires HTTPS or localhost)
 */
export async function computeSHA256(buffer: ArrayBuffer): Promise<string> {
	// Check if crypto.subtle is available (requires secure context: HTTPS or localhost)
	if (!crypto.subtle) {
		throw new Error(
			"crypto.subtle is not available. File hashing requires a secure context (HTTPS or localhost).",
		);
	}

	// Use Web Crypto API for efficient hashing
	const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

	// Convert ArrayBuffer to hex string
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

	return hashHex;
}
