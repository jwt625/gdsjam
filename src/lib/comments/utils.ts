/**
 * Comment Utilities - Helper functions for comment feature
 */

/**
 * Extract user initials from display name
 * Examples:
 * - "Anonymous Aardvark" → "AA"
 * - "Clever Koala 2" → "CK" (ignore numeric suffix)
 * - "Swift Fox" → "SF"
 */
export function extractInitials(displayName: string): string {
	// Split by spaces and filter out numeric-only words
	const words = displayName.split(" ").filter((word) => !/^\d+$/.test(word));

	if (words.length === 0) {
		return "??";
	}

	if (words.length === 1) {
		// Single word: take first two characters
		const firstWord = words[0];
		if (!firstWord || firstWord.length === 0) return "??";
		return firstWord.substring(0, 2).toUpperCase();
	}

	// Multiple words: take first letter of first two words
	const firstWord = words[0];
	const secondWord = words[1];
	if (!firstWord || !secondWord || firstWord.length === 0 || secondWord.length === 0) {
		return "??";
	}
	const firstChar = firstWord.charAt(0);
	const secondChar = secondWord.charAt(0);
	return (firstChar + secondChar).toUpperCase();
}

/**
 * Format timestamp as ISO string (YYYY-MM-DD HH:MM:SS)
 */
export function formatTimestampISO(timestamp: number): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format timestamp as relative time (e.g., "5 minutes ago", "2 hours ago")
 * Always uses proper units, no "just now"
 */
export function formatTimestampRelative(timestamp: number): string {
	const now = Date.now();
	const diffMs = now - timestamp;

	// Convert to seconds
	const diffSeconds = Math.floor(diffMs / 1000);

	if (diffSeconds < 60) {
		return `${diffSeconds} second${diffSeconds !== 1 ? "s" : ""} ago`;
	}

	// Convert to minutes
	const diffMinutes = Math.floor(diffSeconds / 60);
	if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
	}

	// Convert to hours
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) {
		return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
	}

	// Convert to days
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) {
		return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
	}

	// Convert to months
	const diffMonths = Math.floor(diffDays / 30);
	if (diffMonths < 12) {
		return `${diffMonths} month${diffMonths !== 1 ? "s" : ""} ago`;
	}

	// Convert to years
	const diffYears = Math.floor(diffMonths / 12);
	return `${diffYears} year${diffYears !== 1 ? "s" : ""} ago`;
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.substring(0, maxLength) + "...";
}
