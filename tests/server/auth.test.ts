import { beforeEach, describe, expect, it, vi } from "vitest";

function createRes() {
	return {
		statusCode: 200,
		body: null as unknown,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		json(payload: unknown) {
			this.body = payload;
			return this;
		},
	};
}

describe("server/auth middleware", () => {
	beforeEach(() => {
		vi.resetModules();
		delete process.env.AUTH_TOKEN;
		delete process.env.API_TOKEN_SECRET;
	});

	it("allows requests when AUTH_TOKEN is disabled", async () => {
		const auth = await import("../../server/auth.js");
		const req: any = { headers: {}, ip: "1.1.1.1", socket: { remoteAddress: "1.1.1.1" } };
		const res = createRes();
		const next = vi.fn();

		auth.authenticateRequest(["files:read"])(req, res as any, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	it("accepts valid short-lived token with required scope", async () => {
		process.env.AUTH_TOKEN = "master-token";
		process.env.API_TOKEN_SECRET = "secret-123";
		const auth = await import("../../server/auth.js");
		const issueReq: any = {
			headers: {},
			ip: "2.2.2.2",
			socket: { remoteAddress: "2.2.2.2" },
		};
		const { token } = auth.issueShortLivedToken(issueReq, ["files:read"]);

		const req: any = {
			headers: { authorization: `Bearer ${token}` },
			ip: "2.2.2.2",
			socket: { remoteAddress: "2.2.2.2" },
		};
		const res = createRes();
		const next = vi.fn();

		auth.authenticateRequest(["files:read"])(req, res as any, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	it("rejects token with insufficient scope", async () => {
		process.env.AUTH_TOKEN = "master-token";
		process.env.API_TOKEN_SECRET = "secret-123";
		const auth = await import("../../server/auth.js");
		const issueReq: any = {
			headers: {},
			ip: "3.3.3.3",
			socket: { remoteAddress: "3.3.3.3" },
		};
		const { token } = auth.issueShortLivedToken(issueReq, ["files:read"]);
		const req: any = {
			headers: { authorization: `Bearer ${token}` },
			ip: "3.3.3.3",
			socket: { remoteAddress: "3.3.3.3" },
		};
		const res = createRes();
		const next = vi.fn();

		auth.authenticateRequest(["python:execute"])(req, res as any, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(403);
		expect(res.body).toEqual({ error: "Insufficient token scope" });
	});

	it("rejects token when request IP does not match token IP", async () => {
		process.env.AUTH_TOKEN = "master-token";
		process.env.API_TOKEN_SECRET = "secret-123";
		const auth = await import("../../server/auth.js");
		const issueReq: any = {
			headers: {},
			ip: "4.4.4.4",
			socket: { remoteAddress: "4.4.4.4" },
		};
		const { token } = auth.issueShortLivedToken(issueReq, ["files:read"]);
		const req: any = {
			headers: { authorization: `Bearer ${token}` },
			ip: "9.9.9.9",
			socket: { remoteAddress: "9.9.9.9" },
		};
		const res = createRes();
		const next = vi.fn();

		auth.authenticateRequest(["files:read"])(req, res as any, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(401);
		expect(res.body).toEqual({ error: "Token IP mismatch" });
	});
});
