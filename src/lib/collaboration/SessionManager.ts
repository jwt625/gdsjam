/**
 * SessionManager - Manages collaboration sessions
 *
 * Responsibilities:
 * - Create new sessions (generate UUID, update URL)
 * - Join existing sessions (read room parameter)
 * - Manage user ID (localStorage persistence)
 * - Track session state
 */

import { DEBUG } from "../config";
import { generateUUID } from "../utils/uuid";
import { FileTransfer } from "./FileTransfer";
import type { CollaborationEvent, SessionMetadata, UserInfo } from "./types";
import { YjsProvider } from "./YjsProvider";

const USER_ID_KEY = "gdsjam-user-id";
const USER_COLOR_PALETTE = [
	"#FF6B6B", // Red
	"#4ECDC4", // Teal
	"#45B7D1", // Blue
	"#FFA07A", // Light Salmon
	"#98D8C8", // Mint
	"#F7DC6F", // Yellow
	"#BB8FCE", // Purple
	"#85C1E2", // Sky Blue
];

export class SessionManager {
	private yjsProvider: YjsProvider;
	private userId: string;
	private sessionId: string | null = null;
	private isHost: boolean = false;
	private fileTransfer: FileTransfer | null = null;
	private uploadedFileBuffer: ArrayBuffer | null = null; // Store file for sharing with peers

	constructor() {
		// Get or create user ID
		this.userId = this.getOrCreateUserId();
		this.yjsProvider = new YjsProvider(this.userId);

		if (DEBUG) {
			console.log("[SessionManager] Initialized with user ID:", this.userId);
		}
	}

	/**
	 * Get or create user ID from localStorage
	 */
	private getOrCreateUserId(): string {
		let userId = localStorage.getItem(USER_ID_KEY);
		if (!userId) {
			userId = generateUUID();
			localStorage.setItem(USER_ID_KEY, userId);
			if (DEBUG) {
				console.log("[SessionManager] Created new user ID:", userId);
			}
		}
		return userId;
	}

	/**
	 * Create a new session
	 * Returns the session ID (room name)
	 */
	createSession(): string {
		const sessionId = generateUUID();
		this.sessionId = sessionId;
		this.isHost = true;

		// Update URL with room parameter
		const url = new URL(window.location.href);
		url.searchParams.set("room", sessionId);
		window.history.pushState({}, "", url.toString());

		// Connect to Y.js room
		this.yjsProvider.connect(sessionId);

		// Initialize session metadata
		const sessionMap = this.yjsProvider.getMap<any>("session");
		sessionMap.set("sessionId", sessionId);
		sessionMap.set("createdAt", Date.now());
		sessionMap.set("uploadedBy", this.userId);

		if (DEBUG) {
			console.log("[SessionManager] Created session:", sessionId);
		}

		return sessionId;
	}

	/**
	 * Join an existing session
	 */
	joinSession(sessionId: string): void {
		this.sessionId = sessionId;
		this.isHost = false;

		// Connect to Y.js room
		this.yjsProvider.connect(sessionId);

		if (DEBUG) {
			console.log("[SessionManager] Joined session:", sessionId);
		}
	}

	/**
	 * Leave current session
	 */
	leaveSession(): void {
		this.yjsProvider.disconnect();
		this.sessionId = null;
		this.isHost = false;

		// Remove room parameter from URL
		const url = new URL(window.location.href);
		url.searchParams.delete("room");
		window.history.pushState({}, "", url.toString());

		if (DEBUG) {
			console.log("[SessionManager] Left session");
		}
	}

	/**
	 * Get current session ID
	 */
	getSessionId(): string | null {
		return this.sessionId;
	}

	/**
	 * Check if current user is host
	 */
	getIsHost(): boolean {
		return this.isHost;
	}

	/**
	 * Get current user ID
	 */
	getUserId(): string {
		return this.userId;
	}

	/**
	 * Get user color based on user ID
	 */
	getUserColor(userId: string): string {
		// Generate consistent color based on user ID hash
		let hash = 0;
		for (let i = 0; i < userId.length; i++) {
			hash = userId.charCodeAt(i) + ((hash << 5) - hash);
		}
		const index = Math.abs(hash) % USER_COLOR_PALETTE.length;
		return USER_COLOR_PALETTE[index];
	}

	/**
	 * Get all connected users
	 */
	getConnectedUsers(): UserInfo[] {
		// Try to get peers from WebRTC first
		const webrtcPeerIds = this.yjsProvider.getPeerIds();

		// Fallback: Get peers from awareness (works even if WebRTC fails)
		const awareness = this.yjsProvider.getAwareness();
		const awarenessStates = awareness.getStates();

		if (DEBUG) {
			console.log("[SessionManager] Getting connected users:");
			console.log("  - WebRTC peer IDs:", webrtcPeerIds);
			console.log("  - Awareness states:", Array.from(awarenessStates.entries()));
			console.log("  - Current user ID:", this.userId);
			console.log("  - Awareness client ID:", awareness.clientID);
		}

		// Awareness uses numeric client IDs, not our UUID user IDs
		// We need to count unique awareness clients, excluding ourselves
		const myClientId = awareness.clientID;
		const otherClientIds = Array.from(awarenessStates.keys()).filter((id) => id !== myClientId);

		// Use whichever has more peers (WebRTC is preferred, but awareness is fallback)
		const peerIds =
			webrtcPeerIds.length > 0 ? webrtcPeerIds : otherClientIds.map((id) => `client-${id}`);

		const users: UserInfo[] = [];

		// Add current user
		users.push({
			id: this.userId,
			color: this.getUserColor(this.userId),
			isHost: this.isHost,
			joinedAt: Date.now(),
		});

		// Add peers
		for (const peerId of peerIds) {
			users.push({
				id: peerId,
				color: this.getUserColor(peerId),
				isHost: false, // TODO: Track actual host
				joinedAt: Date.now(), // TODO: Track actual join time
			});
		}

		if (DEBUG) {
			console.log("[SessionManager] Total users:", users.length);
		}

		return users;
	}

	/**
	 * Get Y.js provider
	 */
	getProvider(): YjsProvider {
		return this.yjsProvider;
	}

	/**
	 * Check if in a session
	 */
	isInSession(): boolean {
		return this.sessionId !== null && this.yjsProvider.isConnected();
	}

	/**
	 * Upload a file to the session (host only)
	 * Stores the file in Y.js for automatic sync to peers
	 */
	async uploadFile(
		arrayBuffer: ArrayBuffer,
		fileName: string,
		onProgress?: (progress: number, message: string) => void,
		onEvent?: (event: CollaborationEvent) => void,
	): Promise<void> {
		if (!this.isHost) {
			throw new Error("Only the host can upload files");
		}

		if (!this.sessionId) {
			throw new Error("Not in a session");
		}

		// Store file buffer for potential re-sharing
		this.uploadedFileBuffer = arrayBuffer;

		// Create file transfer instance
		this.fileTransfer = new FileTransfer(this.yjsProvider.getDoc(), onProgress, onEvent);

		// Upload file
		await this.fileTransfer.uploadFile(arrayBuffer, fileName, this.userId);

		if (DEBUG) {
			console.log("[SessionManager] File uploaded to session");
		}
	}

	/**
	 * Download file from session (peer only)
	 * Waits for file chunks to sync, then downloads and validates
	 */
	async downloadFile(
		onProgress?: (progress: number, message: string) => void,
		onEvent?: (event: CollaborationEvent) => void,
	): Promise<{ arrayBuffer: ArrayBuffer; fileName: string; fileHash: string }> {
		if (!this.sessionId) {
			throw new Error("Not in a session");
		}

		// Create file transfer instance
		this.fileTransfer = new FileTransfer(this.yjsProvider.getDoc(), onProgress, onEvent);

		// Download file
		const result = await this.fileTransfer.downloadFile();

		if (DEBUG) {
			console.log("[SessionManager] File downloaded from session:", result.fileName);
		}

		return result;
	}

	/**
	 * Check if a file is available in the session
	 */
	isFileAvailable(): boolean {
		if (!this.fileTransfer) {
			this.fileTransfer = new FileTransfer(this.yjsProvider.getDoc());
		}
		return this.fileTransfer.isFileAvailable();
	}

	/**
	 * Get file metadata from session
	 */
	getFileMetadata(): Partial<SessionMetadata> | null {
		if (!this.fileTransfer) {
			this.fileTransfer = new FileTransfer(this.yjsProvider.getDoc());
		}
		return this.fileTransfer.getFileMetadata();
	}

	/**
	 * Get file transfer progress
	 */
	getFileTransferProgress() {
		if (!this.fileTransfer) {
			return null;
		}
		return this.fileTransfer.getProgress();
	}

	/**
	 * Destroy session manager
	 */
	destroy(): void {
		this.yjsProvider.destroy();
		this.uploadedFileBuffer = null;
		this.fileTransfer = null;
	}
}
