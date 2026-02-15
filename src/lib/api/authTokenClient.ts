interface ShortLivedTokenResponse {
	token: string;
	expiresAt: number;
	expiresIn: number;
	scopes: string[];
}

interface CachedToken {
	token: string;
	expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const TOKEN_REFRESH_BUFFER_MS = 30_000; // refresh 30s before expiry

function buildCacheKey(baseUrl: string, scopes: string[]): string {
	return `${baseUrl}|${scopes.slice().sort().join(",")}`;
}

/**
 * Get a short-lived scoped API token from the server.
 * Tokens are cached in-memory and refreshed before expiration.
 */
export async function getShortLivedApiToken(baseUrl: string, scopes: string[]): Promise<string> {
	const cacheKey = buildCacheKey(baseUrl, scopes);
	const now = Date.now();
	const cached = tokenCache.get(cacheKey);

	if (cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > now) {
		return cached.token;
	}

	const response = await fetch(`${baseUrl}/api/auth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ scopes }),
	});

	if (!response.ok) {
		// Backward compatibility: auth-disabled or older server.
		if (response.status === 404 || response.status === 503) {
			return "";
		}
		throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
	}

	const result = (await response.json()) as ShortLivedTokenResponse;
	if (!result.token || !result.expiresAt) {
		throw new Error("Invalid token response from server");
	}

	tokenCache.set(cacheKey, {
		token: result.token,
		expiresAt: result.expiresAt,
	});

	return result.token;
}
