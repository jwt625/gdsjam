import { beforeEach, describe, expect, it, vi } from "vitest";

const providerSpy = vi.fn();

vi.mock("y-webrtc", () => {
	class MockWebrtcProvider {
		public on = vi.fn();
		public off = vi.fn();
		public destroy = vi.fn();
		public synced = false;

		constructor(...args: unknown[]) {
			providerSpy(...args);
		}
	}
	return { WebrtcProvider: MockWebrtcProvider };
});

vi.mock("../../src/lib/api/turnCredentialsClient", () => ({
	getTurnCredentials: vi.fn(),
}));

describe("YjsProvider TURN configuration", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		providerSpy.mockClear();
	});

	it("uses ephemeral TURN credentials when available", async () => {
		const turnModule = await import("../../src/lib/api/turnCredentialsClient");
		vi.mocked(turnModule.getTurnCredentials).mockResolvedValue({
			urls: ["turn:turn.example.com:3478"],
			username: "user1",
			credential: "cred1",
			ttl: 600,
			expiresAt: Date.now() + 600_000,
		});

		const { YjsProvider } = await import("../../src/lib/collaboration/YjsProvider");
		const y = new YjsProvider("user-1");
		await y.connect("room-1");

		expect(turnModule.getTurnCredentials).toHaveBeenCalled();
		expect(providerSpy).toHaveBeenCalledTimes(1);
		const options = providerSpy.mock.calls[0]?.[2] as any;
		const iceServers = options.peerOpts.config.iceServers as RTCIceServer[];
		expect(iceServers.some((s) => s.urls === "stun:stun.l.google.com:19302")).toBe(true);
		expect(
			iceServers.some((s) =>
				Array.isArray(s.urls)
					? s.urls.includes("turn:turn.example.com:3478")
					: s.urls === "turn:turn.example.com:3478",
			),
		).toBe(true);
		expect(iceServers.find((s) => s.username === "user1")?.credential).toBe("cred1");
	});
});
