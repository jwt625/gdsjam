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

describe("server/turnCredentials route", () => {
	beforeEach(() => {
		vi.resetModules();
		process.env.AUTH_TOKEN = "master-token";
		process.env.API_TOKEN_SECRET = "api-secret";
		process.env.TURN_SHARED_SECRET = "turn-secret";
		process.env.TURN_REALM = "signaling.example.com";
		process.env.TURN_TTL_SECONDS = "600";
		process.env.TURN_URLS = "turn:signaling.example.com:3478";
	});

	it("returns ephemeral TURN credentials through route handler", async () => {
		const registered: Record<string, any> = {};
		const app = {
			get: vi.fn((path: string, mw: any, handler: any) => {
				registered[path] = { mw, handler };
			}),
		};
		const { setupTurnCredentialRoutes } = await import("../../server/turnCredentials.js");
		setupTurnCredentialRoutes(app as any);

		const route = registered["/api/turn-credentials"];
		expect(route).toBeDefined();

		const req: any = {
			headers: { authorization: "Bearer master-token" },
			ip: "1.2.3.4",
			socket: { remoteAddress: "1.2.3.4" },
		};
		const res = createRes();
		const next = vi.fn(() => route.handler(req, res));

		route.mw(req, res, next);
		expect(next).toHaveBeenCalled();
		expect(res.statusCode).toBe(200);
		expect((res.body as any).urls).toEqual(["turn:signaling.example.com:3478"]);
		expect((res.body as any).username).toContain(":");
		expect((res.body as any).credential).toBeTypeOf("string");
	});
});
