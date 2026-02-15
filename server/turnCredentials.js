const crypto = require("node:crypto");
const { authenticateRequest } = require("./auth");

const TURN_SHARED_SECRET = process.env.TURN_SHARED_SECRET || "";
const TURN_REALM = process.env.TURN_REALM || "signaling.gdsjam.com";
const TURN_TTL_SECONDS = parseInt(process.env.TURN_TTL_SECONDS || "600", 10); // 10 minutes
const TURN_USERNAME_PREFIX = process.env.TURN_USERNAME_PREFIX || "gdsjam";
const TURN_URLS = process.env.TURN_URLS
	? process.env.TURN_URLS.split(",")
			.map((u) => u.trim())
			.filter(Boolean)
	: [
			"turn:signaling.gdsjam.com:3478",
			"turn:signaling.gdsjam.com:3478?transport=tcp",
			"turns:signaling.gdsjam.com:5349?transport=tcp",
		];

function createTurnCredential(username) {
	// coturn REST API auth expects base64(HMAC-SHA1(secret, username))
	return crypto.createHmac("sha1", TURN_SHARED_SECRET).update(username).digest("base64");
}

function generateTurnCredentials() {
	if (!TURN_SHARED_SECRET) {
		throw new Error("TURN_SHARED_SECRET is not configured");
	}
	const expiresAt = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
	const nonce = crypto.randomBytes(6).toString("hex");
	const username = `${expiresAt}:${TURN_USERNAME_PREFIX}-${nonce}`;
	const credential = createTurnCredential(username);
	return {
		urls: TURN_URLS,
		username,
		credential,
		realm: TURN_REALM,
		ttl: TURN_TTL_SECONDS,
		expiresAt: expiresAt * 1000,
	};
}

function setupTurnCredentialRoutes(app) {
	app.get("/api/turn-credentials", authenticateRequest(["turn:read"]), (_req, res) => {
		try {
			const turnCreds = generateTurnCredentials();
			return res.json(turnCreds);
		} catch (error) {
			return res.status(503).json({
				error: error instanceof Error ? error.message : "TURN credential service unavailable",
			});
		}
	});

	console.log("TURN credential routes configured:");
	console.log("  - GET /api/turn-credentials");
}

module.exports = { setupTurnCredentialRoutes };
