import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { FileTransfer } from "../../src/lib/collaboration/FileTransfer";

vi.mock("../../src/lib/api/authTokenClient", () => ({
	getShortLivedApiToken: vi.fn(),
}));

vi.mock("../../src/lib/utils/hash", () => ({
	computeSHA256: vi.fn(),
}));

describe("FileTransfer auth scopes", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("uses files:write token for upload", async () => {
		const authModule = await import("../../src/lib/api/authTokenClient");
		vi.mocked(authModule.getShortLivedApiToken).mockResolvedValue("write-token");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ fileId: "abc" }),
			}),
		);

		const ydoc = new Y.Doc();
		const transfer = new FileTransfer(ydoc);
		await transfer.uploadFile(new Uint8Array([1, 2, 3]).buffer, "demo.gds", "user-1");

		expect(authModule.getShortLivedApiToken).toHaveBeenCalledWith("https://signaling.gdsjam.com", [
			"files:write",
		]);
		const fetchMock = vi.mocked(fetch);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			method: "POST",
			headers: { Authorization: "Bearer write-token" },
		});
	});

	it("uses files:read token for download", async () => {
		const authModule = await import("../../src/lib/api/authTokenClient");
		const hashModule = await import("../../src/lib/utils/hash");
		vi.mocked(authModule.getShortLivedApiToken).mockResolvedValue("read-token");
		vi.mocked(hashModule.computeSHA256).mockResolvedValue("expected-hash");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
			}),
		);

		const ydoc = new Y.Doc();
		const sessionMap = ydoc.getMap<unknown>("session");
		sessionMap.set("fileId", "f123");
		sessionMap.set("fileName", "demo.gds");
		sessionMap.set("fileHash", "expected-hash");

		const transfer = new FileTransfer(ydoc);
		await transfer.downloadFile();

		expect(authModule.getShortLivedApiToken).toHaveBeenCalledWith("https://signaling.gdsjam.com", [
			"files:read",
		]);
		const fetchMock = vi.mocked(fetch);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			headers: { Authorization: "Bearer read-token" },
		});
	});
});
