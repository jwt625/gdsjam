import { getShortLivedApiToken } from "./authTokenClient";

export interface TurnCredentialsResponse {
	urls: string[];
	username: string;
	credential: string;
	realm?: string;
	ttl: number;
	expiresAt: number;
}

let cachedTurnCredentials: TurnCredentialsResponse | null = null;
const TURN_REFRESH_BUFFER_MS = 30_000;

export async function getTurnCredentials(baseUrl: string): Promise<TurnCredentialsResponse | null> {
	const now = Date.now();
	if (
		cachedTurnCredentials &&
		cachedTurnCredentials.expiresAt - TURN_REFRESH_BUFFER_MS > now &&
		cachedTurnCredentials.urls.length > 0
	) {
		return cachedTurnCredentials;
	}

	const apiToken = await getShortLivedApiToken(baseUrl, ["turn:read"]);
	const headers: HeadersInit = {};
	if (apiToken) {
		headers.Authorization = `Bearer ${apiToken}`;
	}

	const response = await fetch(`${baseUrl}/api/turn-credentials`, {
		method: "GET",
		headers,
	});

	if (!response.ok) {
		// Backward compatibility for older servers.
		if (response.status === 404 || response.status === 503 || response.status === 401) {
			return null;
		}
		throw new Error(`TURN credential request failed: ${response.status} ${response.statusText}`);
	}

	const result = (await response.json()) as TurnCredentialsResponse;
	if (!result.username || !result.credential || !Array.isArray(result.urls)) {
		throw new Error("Invalid TURN credential response");
	}

	cachedTurnCredentials = result;
	return result;
}
