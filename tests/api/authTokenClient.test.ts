import { beforeEach, describe, expect, it, vi } from "vitest";

describe("authTokenClient", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("caches token by baseUrl+scopes and avoids duplicate fetch", async () => {
		const now = 1_000_000;
		vi.spyOn(Date, "now").mockReturnValue(now);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				token: "token-1",
				expiresAt: now + 300_000,
				expiresIn: 300,
				scopes: ["files:read"],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { getShortLivedApiToken } = await import("../../src/lib/api/authTokenClient");
		const t1 = await getShortLivedApiToken("https://api.test", ["files:read"]);
		const t2 = await getShortLivedApiToken("https://api.test", ["files:read"]);

		expect(t1).toBe("token-1");
		expect(t2).toBe("token-1");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refreshes token when near expiry", async () => {
		const now = 2_000_000;
		vi.spyOn(Date, "now").mockReturnValue(now);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					token: "short-lived",
					expiresAt: now + 10_000,
					expiresIn: 10,
					scopes: ["files:read"],
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					token: "refreshed",
					expiresAt: now + 300_000,
					expiresIn: 300,
					scopes: ["files:read"],
				}),
			});
		vi.stubGlobal("fetch", fetchMock);

		const { getShortLivedApiToken } = await import("../../src/lib/api/authTokenClient");
		const t1 = await getShortLivedApiToken("https://api.test", ["files:read"]);
		const t2 = await getShortLivedApiToken("https://api.test", ["files:read"]);

		expect(t1).toBe("short-lived");
		expect(t2).toBe("refreshed");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns empty token on 404/503 compatibility path", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" })
			.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Unavailable" });
		vi.stubGlobal("fetch", fetchMock);

		const { getShortLivedApiToken } = await import("../../src/lib/api/authTokenClient");
		const t1 = await getShortLivedApiToken("https://api.test", ["files:read"]);
		const t2 = await getShortLivedApiToken("https://api.test", ["files:write"]);

		expect(t1).toBe("");
		expect(t2).toBe("");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
