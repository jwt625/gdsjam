const crypto = require("crypto");

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const API_TOKEN_SECRET = process.env.API_TOKEN_SECRET || AUTH_TOKEN || "";
const API_TOKEN_TTL_SECONDS = parseInt(process.env.API_TOKEN_TTL_SECONDS || "300", 10); // 5 min

const ALLOWED_SCOPES = new Set(["files:read", "files:write", "python:execute"]);

function toBase64Url(input) {
	return Buffer.from(input)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function fromBase64Url(input) {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
	return Buffer.from(normalized + pad, "base64").toString("utf8");
}

function normalizeIp(req) {
	// Respect common proxy headers when present.
	const forwarded = req.headers["x-forwarded-for"];
	const candidate = Array.isArray(forwarded)
		? forwarded[0]
		: typeof forwarded === "string"
			? forwarded.split(",")[0]
			: req.ip || req.socket?.remoteAddress || "";
	return String(candidate).trim();
}

function parseBearerToken(req) {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
	return authHeader.substring(7);
}

function getValidatedScopes(scopes) {
	if (!Array.isArray(scopes) || scopes.length === 0) return [];
	const unique = [...new Set(scopes.map((s) => String(s)))];
	for (const scope of unique) {
		if (!ALLOWED_SCOPES.has(scope)) {
			throw new Error(`Invalid scope: ${scope}`);
		}
	}
	return unique;
}

function signApiToken(payload) {
	if (!API_TOKEN_SECRET) {
		throw new Error("API_TOKEN_SECRET (or AUTH_TOKEN) is required to sign API tokens");
	}
	const body = toBase64Url(JSON.stringify(payload));
	const signature = crypto.createHmac("sha256", API_TOKEN_SECRET).update(body).digest("base64url");
	return `${body}.${signature}`;
}

function verifyApiToken(token) {
	if (!API_TOKEN_SECRET) return { valid: false, reason: "Server auth secret not configured" };
	const parts = token.split(".");
	if (parts.length !== 2) return { valid: false, reason: "Invalid token format" };

	const [body, signature] = parts;
	const expectedSignature = crypto
		.createHmac("sha256", API_TOKEN_SECRET)
		.update(body)
		.digest("base64url");
	if (signature !== expectedSignature) return { valid: false, reason: "Invalid token signature" };

	let payload;
	try {
		payload = JSON.parse(fromBase64Url(body));
	} catch {
		return { valid: false, reason: "Invalid token payload" };
	}

	const now = Date.now();
	if (typeof payload.exp !== "number" || payload.exp <= now) {
		return { valid: false, reason: "Token expired" };
	}
	if (!Array.isArray(payload.scopes)) {
		return { valid: false, reason: "Invalid token scopes" };
	}
	return { valid: true, payload };
}

function hasRequiredScopes(tokenScopes, requiredScopes) {
	if (!requiredScopes || requiredScopes.length === 0) return true;
	if (!Array.isArray(tokenScopes)) return false;
	return requiredScopes.every((scope) => tokenScopes.includes(scope));
}

function authenticateRequest(requiredScopes = []) {
	return (req, res, next) => {
		if (!AUTH_TOKEN) {
			return next(); // auth disabled
		}

		const token = parseBearerToken(req);
		if (!token) {
			return res.status(401).json({ error: "Missing or invalid authorization header" });
		}

		// Backward compatibility: allow long-lived AUTH_TOKEN for operators/tools.
		if (token === AUTH_TOKEN) {
			return next();
		}

		const verification = verifyApiToken(token);
		if (!verification.valid) {
			return res.status(401).json({ error: verification.reason || "Invalid token" });
		}

		const requestIp = normalizeIp(req);
		if (verification.payload.ip && verification.payload.ip !== requestIp) {
			return res.status(401).json({ error: "Token IP mismatch" });
		}
		if (!hasRequiredScopes(verification.payload.scopes, requiredScopes)) {
			return res.status(403).json({ error: "Insufficient token scope" });
		}

		req.apiToken = verification.payload;
		next();
	};
}

function issueShortLivedToken(req, scopes = []) {
	const validatedScopes = getValidatedScopes(scopes);
	const now = Date.now();
	const expiresAt = now + API_TOKEN_TTL_SECONDS * 1000;
	const payload = {
		iat: now,
		exp: expiresAt,
		ip: normalizeIp(req),
		scopes: validatedScopes,
	};
	return {
		token: signApiToken(payload),
		expiresAt,
		expiresIn: API_TOKEN_TTL_SECONDS,
		scopes: validatedScopes,
	};
}

module.exports = {
	ALLOWED_SCOPES,
	AUTH_TOKEN,
	API_TOKEN_TTL_SECONDS,
	authenticateRequest,
	getValidatedScopes,
	issueShortLivedToken,
};
