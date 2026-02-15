import { beforeEach, describe, expect, it, vi } from "vitest";
import { PythonExecutor } from "../../src/lib/api/pythonExecutor";

vi.mock("../../src/lib/api/authTokenClient", () => ({
	getShortLivedApiToken: vi.fn(),
}));

describe("PythonExecutor auth scopes", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("uses python:execute token for execute()", async () => {
		const authModule = await import("../../src/lib/api/authTokenClient");
		vi.mocked(authModule.getShortLivedApiToken).mockResolvedValue("py-token");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				json: async () => ({ success: true, stdout: "", stderr: "" }),
			}),
		);

		const executor = new PythonExecutor();
		(executor as any).baseUrl = "https://api.test";
		await executor.execute("print('ok')");

		expect(authModule.getShortLivedApiToken).toHaveBeenCalledWith("https://api.test", [
			"python:execute",
		]);
		const fetchMock = vi.mocked(fetch);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer py-token",
			},
		});
	});

	it("uses files:read token for downloadFile()", async () => {
		const authModule = await import("../../src/lib/api/authTokenClient");
		vi.mocked(authModule.getShortLivedApiToken).mockResolvedValue("read-token");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
			}),
		);

		const executor = new PythonExecutor();
		(executor as any).baseUrl = "https://api.test";
		await executor.downloadFile("file-id");

		expect(authModule.getShortLivedApiToken).toHaveBeenCalledWith("https://api.test", [
			"files:read",
		]);
		const fetchMock = vi.mocked(fetch);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			method: "GET",
			headers: { Authorization: "Bearer read-token" },
		});
	});
});
