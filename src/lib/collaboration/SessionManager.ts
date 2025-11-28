/**
 * SessionManager - Manages collaboration sessions
 *
 * Responsibilities:
 * - Create new sessions (generate UUID, update URL)
 * - Join existing sessions (read room parameter)
 * - Manage user ID (localStorage persistence)
 * - Track session state
 * - Coordinate HostManager and ParticipantManager (facade pattern)
 */

import { DEBUG } from "../config";
import { generateUUID } from "../utils/uuid";
import { FileTransfer } from "./FileTransfer";
import { HostManager } from "./HostManager";
import { ParticipantManager } from "./ParticipantManager";
import type {
	CollaborationEvent,
	CollaborativeViewportState,
	SessionMetadata,
	UserInfo,
} from "./types";
import { ViewportSync, type ViewportSyncCallbacks } from "./ViewportSync";
import { YjsProvider } from "./YjsProvider";

// localStorage keys (documented in DevLog-001-10)
// Format: gdsjam_user_id = persistent user UUID
const USER_ID_KEY = "gdsjam_user_id";
// Format: gdsjam_session_{sessionId} = {fileId, fileName, fileHash, fileSize}
const SESSION_STORAGE_PREFIX = "gdsjam_session_";

// Stored session info for recovery after refresh
interface StoredSessionInfo {
	fileId: string;
	fileName: string;
	fileHash: string;
	fileSize: number;
	savedAt: number;
}

// Pending file info for "upload first, then create session" workflow
interface PendingFile {
	fileId: string;
	fileName: string;
	fileHash: string;
	fileSize: number;
	arrayBuffer: ArrayBuffer;
}

export class SessionManager {
	private yjsProvider: YjsProvider;
	private hostManager: HostManager;
	private participantManager: ParticipantManager;
	private userId: string;
	private sessionId: string | null = null;
	private fileTransfer: FileTransfer | null = null;
	private uploadedFileBuffer: ArrayBuffer | null = null; // Store file for sharing with peers
	private pendingFile: PendingFile | null = null; // File uploaded before session creation
	private hostCheckInterval: ReturnType<typeof setInterval> | null = null;
	private viewportSync: ViewportSync | null = null;
	private viewportSyncCallbacks: ViewportSyncCallbacks = {};

	constructor() {
		// Get or create user ID
		this.userId = this.getOrCreateUserId();
		this.yjsProvider = new YjsProvider(this.userId);

		// Initialize managers
		this.hostManager = new HostManager(this.yjsProvider, this.userId);
		this.participantManager = new ParticipantManager(this.yjsProvider, this.userId);

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

		// Update URL with room parameter
		const url = new URL(window.location.href);
		url.searchParams.set("room", sessionId);
		window.history.pushState({}, "", url.toString());

		// Connect to Y.js room
		this.yjsProvider.connect(sessionId);

		// Initialize managers for this session
		this.hostManager.initialize(sessionId);
		this.participantManager.initialize(sessionId);

		// Initialize viewport sync
		this.initializeViewportSync();

		// Enable auto-promotion: oldest viewer becomes host when host leaves
		this.setupAutoPromotion();

		// Initialize ALL session metadata in a single transaction to avoid race conditions
		// This includes: session info, file info, host info, and initial participant
		// Multiple transactions can cause sync issues where viewers see incomplete state
		this.yjsProvider.getDoc().transact(() => {
			const sessionMap = this.yjsProvider.getMap<any>("session");
			sessionMap.set("sessionId", sessionId);
			sessionMap.set("createdAt", Date.now());
			sessionMap.set("uploadedBy", this.userId);

			// Host management fields
			sessionMap.set("currentHostId", this.userId);
			sessionMap.set("hostLastSeen", Date.now());

			// Initial participant (host)
			const hostParticipant = {
				userId: this.userId,
				displayName: this.participantManager.generateUniqueDisplayName(this.userId, []),
				joinedAt: Date.now(),
				color: this.participantManager.getLocalColor(),
			};
			sessionMap.set("participants", [hostParticipant]);

			// If there's a pending file (uploaded before session creation), add its metadata
			if (this.pendingFile) {
				sessionMap.set("fileId", this.pendingFile.fileId);
				sessionMap.set("fileName", this.pendingFile.fileName);
				sessionMap.set("fileSize", this.pendingFile.fileSize);
				sessionMap.set("fileHash", this.pendingFile.fileHash);
				sessionMap.set("uploadedAt", Date.now());

				if (DEBUG) {
					console.log("[SessionManager] Added pending file to session:", this.pendingFile.fileName);
				}
			}
		});

		// Update local state in managers (no Y.js writes, just local state)
		this.hostManager.setIsHostLocal(true);
		this.hostManager.startHostHeartbeat();
		this.participantManager.setLocalDisplayName(
			this.participantManager.generateUniqueDisplayName(this.userId, []),
		);
		this.participantManager.setLocalAwarenessState({ isHost: true });

		// Store the pending file buffer for potential re-sharing, save to localStorage, then clear pending state
		if (this.pendingFile) {
			// Save session to localStorage for recovery after refresh
			this.saveSessionToLocalStorage(
				this.pendingFile.fileId,
				this.pendingFile.fileName,
				this.pendingFile.fileHash,
				this.pendingFile.fileSize,
			);

			this.uploadedFileBuffer = this.pendingFile.arrayBuffer;
			this.pendingFile = null;
		}

		if (DEBUG) {
			console.log("[SessionManager] Created session:", sessionId);
		}

		return sessionId;
	}

	/**
	 * Upload a file before creating a session (pending upload)
	 * The file will be associated with the session when createSession() is called
	 */
	async uploadFilePending(
		arrayBuffer: ArrayBuffer,
		fileName: string,
		onProgress?: (progress: number, message: string) => void,
	): Promise<void> {
		if (DEBUG) {
			console.log(
				"[SessionManager] Uploading file as pending (before session creation):",
				fileName,
			);
		}

		onProgress?.(0, "Uploading file to server...");

		// Upload file to server
		const fileServerUrl = import.meta.env.VITE_FILE_SERVER_URL || "https://signaling.gdsjam.com";
		const fileServerToken = import.meta.env.VITE_FILE_SERVER_TOKEN;

		const formData = new FormData();
		formData.append("file", new Blob([arrayBuffer]));

		const response = await fetch(`${fileServerUrl}/api/files`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${fileServerToken}`,
			},
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`File upload failed: ${response.status} ${response.statusText}`);
		}

		const { fileId } = await response.json();

		// fileId is the SHA-256 hash computed by the server
		const fileHash = fileId;

		onProgress?.(100, "File uploaded, ready to create session");

		// Store as pending file
		this.pendingFile = {
			fileId,
			fileName,
			fileHash,
			fileSize: arrayBuffer.byteLength,
			arrayBuffer,
		};

		if (DEBUG) {
			console.log("[SessionManager] Pending file stored:", {
				fileId,
				fileName,
				fileSize: arrayBuffer.byteLength,
			});
		}
	}

	/**
	 * Check if there's a pending file ready for session creation
	 */
	hasPendingFile(): boolean {
		return this.pendingFile !== null;
	}

	/**
	 * Get pending file info (without the buffer)
	 */
	getPendingFileInfo(): { fileName: string; fileSize: number } | null {
		if (!this.pendingFile) return null;
		return {
			fileName: this.pendingFile.fileName,
			fileSize: this.pendingFile.fileSize,
		};
	}

	/**
	 * Clear pending file (e.g., if user cancels)
	 */
	clearPendingFile(): void {
		this.pendingFile = null;
	}

	/**
	 * Join an existing session
	 *
	 * Ground Truth Architecture (from DevLog-001-10):
	 * - HOST: localStorage is ground truth. Can always restore after refresh.
	 * - VIEWER: Y.js (from host/peers) is ground truth. Defer to host.
	 *
	 * Flow:
	 * 1. Check localStorage FIRST: Am I the host?
	 * 2a. HOST path: I am source of truth -> Load from localStorage, connect to Y.js, write to Y.js
	 * 2b. VIEWER path: Host is source of truth -> Connect to Y.js, wait for sync
	 */
	async joinSession(sessionId: string): Promise<void> {
		this.sessionId = sessionId;

		// Initialize managers with sessionId (sets up observers, no Y.js writes yet)
		// Must happen before checking host flag so hasHostRecoveryFlag() works
		this.hostManager.initialize(sessionId);
		this.participantManager.initialize(sessionId);

		// Initialize viewport sync (after managers, before auto-promotion)
		this.initializeViewportSync();

		// Enable auto-promotion: oldest viewer becomes host when host leaves
		this.setupAutoPromotion();

		// STEP 1: Check localStorage FIRST - Am I the host?
		const wasHost = this.hostManager.hasHostRecoveryFlag();

		if (DEBUG) {
			console.log("[SessionManager] joinSession - checking host status:", {
				sessionId,
				wasHost,
			});
		}

		if (wasHost) {
			// ======================================
			// HOST REFRESH PATH: I am source of truth for metadata
			// File buffer comes from signaling server (not peers)
			// ======================================
			if (DEBUG) {
				console.log("[SessionManager] HOST PATH: Restoring from localStorage");
			}

			// Load file metadata from localStorage
			const storedSession = this.loadSessionFromLocalStorage();
			if (DEBUG) {
				console.log("[SessionManager] Loaded session info from localStorage:", storedSession);
			}

			// Connect to Y.js room - no need to wait for sync
			// Host has metadata in localStorage, file is on signaling server
			this.yjsProvider.connect(sessionId);

			// Write session data to Y.js (host is authoritative for metadata)
			this.yjsProvider.getDoc().transact(() => {
				const sessionMap = this.yjsProvider.getMap<any>("session");

				// Restore session identity
				sessionMap.set("sessionId", sessionId);
				sessionMap.set("createdAt", Date.now());
				sessionMap.set("uploadedBy", this.userId);

				// Restore host management fields
				sessionMap.set("currentHostId", this.userId);
				sessionMap.set("hostLastSeen", Date.now());

				// Restore file metadata if we have it
				if (storedSession) {
					sessionMap.set("fileId", storedSession.fileId);
					sessionMap.set("fileName", storedSession.fileName);
					sessionMap.set("fileSize", storedSession.fileSize);
					sessionMap.set("fileHash", storedSession.fileHash);
					sessionMap.set("uploadedAt", storedSession.savedAt);
				}

				// Re-register as participant
				const existingParticipants = (sessionMap.get("participants") as any[]) || [];
				const existingNames = existingParticipants.map((p) => p.displayName);
				const displayName = this.participantManager.generateUniqueDisplayName(
					this.userId,
					existingNames.filter((n) => n !== undefined),
				);
				const hostParticipant = {
					userId: this.userId,
					displayName,
					joinedAt: Date.now(),
					color: this.participantManager.getLocalColor(),
				};

				// Replace or add self to participants
				const filteredParticipants = existingParticipants.filter((p) => p.userId !== this.userId);
				sessionMap.set("participants", [...filteredParticipants, hostParticipant]);
				this.participantManager.setLocalDisplayName(displayName);
			});

			// Update local state
			this.hostManager.setIsHostLocal(true);
			this.hostManager.startHostHeartbeat();
			this.participantManager.setLocalAwarenessState({ isHost: true });

			// Clear recovery flag (successfully reclaimed)
			this.hostManager.clearHostRecoveryFlag();

			if (DEBUG) {
				console.log("[SessionManager] HOST PATH complete - restored from localStorage");
			}
		} else {
			// ======================================
			// VIEWER PATH: Host is source of truth
			// ======================================
			if (DEBUG) {
				console.log("[SessionManager] VIEWER PATH: Waiting for sync from host");
			}

			// Set awareness immediately (safe - uses awareness protocol, not Y.js doc)
			this.participantManager.setLocalAwarenessState({ isHost: false });

			// Connect to Y.js room
			this.yjsProvider.connect(sessionId);

			// Wait for Y.js to sync with peers before any document writes
			const synced = await this.yjsProvider.waitForSync(5000);

			if (DEBUG) {
				console.log("[SessionManager] Sync completed:", synced);
			}

			// Now safe to write - document has host's data
			this.participantManager.registerParticipant();
			this.participantManager.setLocalAwarenessState({ isHost: false });

			if (DEBUG) {
				console.log("[SessionManager] VIEWER PATH complete - synced from host/peers");
			}
		}
	}

	/**
	 * Leave current session
	 */
	leaveSession(): void {
		// Stop periodic host check
		if (this.hostCheckInterval) {
			clearInterval(this.hostCheckInterval);
			this.hostCheckInterval = null;
		}

		// Cleanup host state if we're host (updates shared state for all peers)
		if (this.hostManager.getIsHost()) {
			this.hostManager.cleanupHostState();
		}

		// Unregister from participants
		this.participantManager.unregisterParticipant();

		// Disconnect from Y.js
		this.yjsProvider.disconnect();
		this.sessionId = null;

		// Destroy managers
		this.hostManager.destroy();
		this.participantManager.destroy();

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
		return this.hostManager.getIsHost();
	}

	/**
	 * Get current user ID
	 */
	getUserId(): string {
		return this.userId;
	}

	/**
	 * Get user color based on user ID
	 * Delegates to ParticipantManager
	 */
	getUserColor(userId: string): string {
		return this.participantManager.getUserColor(userId);
	}

	/**
	 * Get all connected users
	 * Uses Y.js participants for accurate tracking
	 */
	getConnectedUsers(): UserInfo[] {
		const participants = this.participantManager.getParticipants();
		const currentHostId = this.hostManager.getCurrentHostId();

		// Convert YjsParticipant to UserInfo
		const users: UserInfo[] = participants.map((p) => ({
			id: p.userId,
			displayName: p.displayName,
			color: p.color,
			isHost: p.userId === currentHostId,
			joinedAt: p.joinedAt,
		}));

		// If no participants in Y.js yet, return at least ourselves
		if (users.length === 0) {
			users.push({
				id: this.userId,
				displayName: this.participantManager.getLocalDisplayName() || "You",
				color: this.participantManager.getLocalColor(),
				isHost: this.hostManager.getIsHost(),
				joinedAt: Date.now(),
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
		if (!this.hostManager.getIsHost()) {
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
	 * Download file by ID directly (for session recovery)
	 */
	async downloadFileById(
		fileId: string,
		fileName: string,
		fileHash: string,
		onProgress?: (progress: number, message: string) => void,
		onEvent?: (event: CollaborationEvent) => void,
	): Promise<{ arrayBuffer: ArrayBuffer; fileName: string; fileHash: string }> {
		// Create file transfer instance
		this.fileTransfer = new FileTransfer(this.yjsProvider.getDoc(), onProgress, onEvent);

		// Download file by ID
		const result = await this.fileTransfer.downloadFileById(fileId, fileName, fileHash);

		if (DEBUG) {
			console.log("[SessionManager] File recovered from server:", result.fileName);
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
	getFileMetadata(): (Partial<SessionMetadata> & { fileId?: string }) | null {
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
	 * Save session info to localStorage for recovery after refresh
	 */
	saveSessionToLocalStorage(
		fileId: string,
		fileName: string,
		fileHash: string,
		fileSize: number,
	): void {
		if (!this.sessionId) {
			if (DEBUG) {
				console.log("[SessionManager] Cannot save to localStorage - no session ID");
			}
			return;
		}

		const key = `${SESSION_STORAGE_PREFIX}${this.sessionId}`;
		const info: StoredSessionInfo = {
			fileId,
			fileName,
			fileHash,
			fileSize,
			savedAt: Date.now(),
		};

		try {
			localStorage.setItem(key, JSON.stringify(info));
			if (DEBUG) {
				console.log("[SessionManager] Saved session info to localStorage:", key);
			}
		} catch (error) {
			console.error("[SessionManager] Failed to save session to localStorage:", error);
		}
	}

	/**
	 * Load session info from localStorage
	 */
	loadSessionFromLocalStorage(): StoredSessionInfo | null {
		if (!this.sessionId) {
			return null;
		}

		const key = `${SESSION_STORAGE_PREFIX}${this.sessionId}`;

		try {
			const stored = localStorage.getItem(key);
			if (!stored) {
				return null;
			}

			const info = JSON.parse(stored) as StoredSessionInfo;

			// Check if session info is too old (24 hours)
			const maxAge = 24 * 60 * 60 * 1000;
			if (Date.now() - info.savedAt > maxAge) {
				if (DEBUG) {
					console.log("[SessionManager] Stored session info expired, removing");
				}
				localStorage.removeItem(key);
				return null;
			}

			if (DEBUG) {
				console.log("[SessionManager] Loaded session info from localStorage:", info);
			}
			return info;
		} catch (error) {
			console.error("[SessionManager] Failed to load session from localStorage:", error);
			return null;
		}
	}

	/**
	 * Clear session info from localStorage
	 */
	clearSessionFromLocalStorage(): void {
		if (!this.sessionId) {
			return;
		}

		const key = `${SESSION_STORAGE_PREFIX}${this.sessionId}`;
		try {
			localStorage.removeItem(key);
			if (DEBUG) {
				console.log("[SessionManager] Cleared session info from localStorage:", key);
			}
		} catch (error) {
			console.error("[SessionManager] Failed to clear session from localStorage:", error);
		}
	}

	/**
	 * Destroy session manager
	 */
	destroy(): void {
		// Clean up periodic host check
		if (this.hostCheckInterval) {
			clearInterval(this.hostCheckInterval);
			this.hostCheckInterval = null;
		}

		this.hostManager.destroy();
		this.participantManager.destroy();
		this.yjsProvider.destroy();
		this.uploadedFileBuffer = null;
		this.fileTransfer = null;
	}

	// ==========================================
	// Host Management Facade Methods
	// ==========================================

	/**
	 * Get HostManager instance (for advanced use)
	 */
	getHostManager(): HostManager {
		return this.hostManager;
	}

	/**
	 * Get ParticipantManager instance (for advanced use)
	 */
	getParticipantManager(): ParticipantManager {
		return this.participantManager;
	}

	/**
	 * Mark host for recovery before page unload
	 */
	markHostForRecovery(): void {
		this.hostManager.markHostForRecovery();
	}

	/**
	 * Check if viewer can claim host
	 */
	canClaimHost(): boolean {
		return this.hostManager.canClaimHost();
	}

	/**
	 * Claim host status
	 */
	claimHost(): boolean {
		const result = this.hostManager.claimHost();
		if (result) {
			this.participantManager.setLocalAwarenessState({ isHost: true });
		}
		return result;
	}

	/**
	 * Transfer host to another user
	 */
	transferHost(targetUserId: string): boolean {
		const result = this.hostManager.transferHost(targetUserId);
		if (result) {
			this.participantManager.setLocalAwarenessState({ isHost: false });
		}
		return result;
	}

	/**
	 * Get transfer candidates (viewers sorted by userId)
	 * Returns user IDs of all participants except current host
	 */
	getTransferCandidates(): string[] {
		const currentHostId = this.hostManager.getCurrentHostId();
		const participants = this.participantManager.getParticipants();

		// Filter out current host, return sorted by userId (already sorted by getParticipants)
		return participants.filter((p) => p.userId !== currentHostId).map((p) => p.userId);
	}

	/**
	 * Check if beforeunload warning is needed
	 */
	getHostWarningNeeded(): boolean {
		return this.hostManager.getHostWarningNeeded();
	}

	/**
	 * Register callback for host changes
	 */
	onHostChanged(callback: (newHostId: string) => void): void {
		this.hostManager.onHostChanged(callback);
	}

	/**
	 * Register callback for when host becomes absent
	 */
	onHostAbsent(callback: () => void): void {
		this.hostManager.onHostAbsent(callback);
	}

	/**
	 * Set up auto-promotion: when host leaves, the oldest viewer becomes host
	 * This ensures there's always a host in an active session
	 */
	setupAutoPromotion(): void {
		// React to host being cleared
		this.hostManager.onHostAbsent(() => {
			// Small delay to allow Y.js state to settle
			setTimeout(() => {
				this.tryAutoPromote();
			}, 100);
		});

		// Periodic check: THERE SHOULD ALWAYS BE A HOST
		// This catches edge cases where Y.js events are missed
		this.hostCheckInterval = setInterval(() => {
			this.ensureHostExists();
		}, 2000); // Check every 2 seconds

		if (DEBUG) {
			console.log("[SessionManager] Auto-promotion enabled with periodic check");
		}
	}

	/**
	 * Ensure there is always a host in the session
	 * Called periodically to catch any edge cases
	 */
	private ensureHostExists(): void {
		// Only check if we're in a session
		if (!this.sessionId) return;

		// Already host, nothing to do
		if (this.hostManager.getIsHost()) return;

		const currentHostId = this.hostManager.getCurrentHostId();

		// Case 1: No host at all (currentHostId is empty)
		if (!currentHostId) {
			if (DEBUG) {
				console.log("[SessionManager] No host detected, triggering auto-promotion");
			}
			this.tryAutoPromote();
			return;
		}

		// Case 2: Host exists but is stale (closed tab without proper leave)
		// canClaimHost() checks if hostLastSeen is past DISCONNECT_GRACE_PERIOD
		if (this.hostManager.canClaimHost()) {
			if (DEBUG) {
				console.log("[SessionManager] Host is stale (closed tab?), triggering auto-promotion");
			}
			this.tryAutoPromote();
		}
	}

	/**
	 * Try to auto-promote to host if this user is the oldest participant
	 * Uses deterministic ordering to avoid race conditions
	 */
	private tryAutoPromote(): void {
		// Don't auto-promote if already host
		if (this.hostManager.getIsHost()) {
			if (DEBUG) {
				console.log("[SessionManager] Already host, skipping auto-promotion");
			}
			return;
		}

		// Check if we can claim (no current host)
		if (!this.hostManager.canClaimHost()) {
			if (DEBUG) {
				console.log("[SessionManager] Cannot claim host, skipping auto-promotion");
			}
			return;
		}

		// Get participants sorted by joinedAt
		const participants = this.participantManager.getParticipants();
		if (participants.length === 0) {
			// No participants registered yet, claim host
			if (DEBUG) {
				console.log("[SessionManager] No participants, claiming host");
			}
			this.claimHost();
			return;
		}

		// Check if we're the first participant (lowest userId in sorted list)
		// Sorting by userId ensures deterministic, unambiguous selection across all clients
		const firstParticipant = participants[0];
		if (!firstParticipant) {
			// Edge case: empty participants array
			if (DEBUG) {
				console.log("[SessionManager] No participants found, claiming host");
			}
			this.claimHost();
			return;
		}

		if (firstParticipant.userId === this.userId) {
			if (DEBUG) {
				console.log("[SessionManager] I have lowest userId, claiming host");
			}
			this.claimHost();
		} else {
			if (DEBUG) {
				console.log("[SessionManager] Not first in order, waiting for:", firstParticipant.userId);
			}
		}
	}

	// ==========================================
	// Viewport Sync Facade Methods
	// ==========================================

	/**
	 * Initialize ViewportSync with current callbacks
	 */
	private initializeViewportSync(): void {
		// Destroy existing instance if any
		if (this.viewportSync) {
			this.viewportSync.destroy();
		}

		this.viewportSync = new ViewportSync(this.yjsProvider, this.userId, this.viewportSyncCallbacks);

		if (DEBUG) {
			console.log("[SessionManager] ViewportSync initialized");
		}
	}

	/**
	 * Set viewport sync callbacks
	 * Call this before creating/joining a session, or call again to update callbacks
	 */
	setViewportSyncCallbacks(callbacks: ViewportSyncCallbacks): void {
		this.viewportSyncCallbacks = callbacks;

		// Update existing ViewportSync if already initialized
		if (this.viewportSync) {
			this.viewportSync.setCallbacks(callbacks);
		}
	}

	/**
	 * Enable viewport broadcast (host only)
	 */
	enableViewportBroadcast(): void {
		if (!this.hostManager.getIsHost()) {
			console.warn("[SessionManager] Only host can enable viewport broadcast");
			return;
		}
		this.viewportSync?.enableBroadcast();
	}

	/**
	 * Disable viewport broadcast (host only)
	 */
	disableViewportBroadcast(): void {
		if (!this.hostManager.getIsHost()) {
			console.warn("[SessionManager] Only host can disable viewport broadcast");
			return;
		}
		this.viewportSync?.disableBroadcast();
	}

	/**
	 * Check if viewport broadcast is enabled
	 */
	isViewportBroadcastEnabled(): boolean {
		return this.viewportSync?.isBroadcastEnabled() ?? false;
	}

	/**
	 * Broadcast current viewport state (called by renderer on viewport change)
	 */
	broadcastViewport(x: number, y: number, scale: number): void {
		this.viewportSync?.broadcastViewport(x, y, scale);
	}

	/**
	 * Get host's current viewport (for viewers to follow)
	 */
	getHostViewport(): CollaborativeViewportState | null {
		return this.viewportSync?.getHostViewport() ?? null;
	}

	/**
	 * Get ViewportSync instance (for advanced use)
	 */
	getViewportSync(): ViewportSync | null {
		return this.viewportSync;
	}
}
