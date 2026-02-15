import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/api/authTokenClient", () => ({
	getShortLivedApiToken: vi.fn(),
}));

describe("turnCredentialsClient", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("fetches TURN credentials with turn:read token and caches response", async () => {
		const now = 5_000_000;
		vi.spyOn(Date, "now").mockReturnValue(now);

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				urls: ["turn:turn.example.com:3478"],
				username: "u",
				credential: "c",
				ttl: 600,
				expiresAt: now + 600_000,
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const authModule = await import("../../src/lib/api/authTokenClient");
		vi.mocked(authModule.getShortLivedApiToken).mockResolvedValue("ephemeral-token");

		const { getTurnCredentials } = await import("../../src/lib/api/turnCredentialsClient");
		const c1 = await getTurnCredentials("https://api.test");
		const c2 = await getTurnCredentials("https://api.test");

		expect(authModule.getShortLivedApiToken).toHaveBeenCalledWith("https://api.test", [
			"turn:read",
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			method: "GET",
			headers: { Authorization: "Bearer ephemeral-token" },
		});
		expect(c1?.username).toBe("u");
		expect(c2?.username).toBe("u");
	});

	it("returns null on compatibility status codes", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" })
			.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" })
			.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Unavailable" });
		vi.stubGlobal("fetch", fetchMock);

		const authModule = await import("../../src/lib/api/authTokenClient");
		vi.mocked(authModule.getShortLivedApiToken).mockResolvedValue("");

		const { getTurnCredentials } = await import("../../src/lib/api/turnCredentialsClient");
		expect(await getTurnCredentials("https://api.test")).toBeNull();
		expect(await getTurnCredentials("https://api.test")).toBeNull();
		expect(await getTurnCredentials("https://api.test")).toBeNull();
	});
});
