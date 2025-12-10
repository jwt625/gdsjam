/**
 * Collaboration Store - Manages collaboration session state
 */

import { writable } from "svelte/store";
import { SessionManager } from "../lib/collaboration/SessionManager";
import type { UserInfo } from "../lib/collaboration/types";

interface CollaborationState {
	sessionManager: SessionManager | null;
	isInSession: boolean;
	sessionId: string | null;
	isHost: boolean;
	connectedUsers: UserInfo[];
	userId: string | null;
	fileTransferProgress: number; // 0-100
	fileTransferMessage: string;
	isTransferring: boolean;
	// Viewport sync state
	isBroadcasting: boolean; // Host is broadcasting viewport
	isFollowing: boolean; // Viewer is following host's viewport
	showFollowToast: boolean; // Show "Host is controlling your view" toast
	// Layer sync state
	isLayerBroadcasting: boolean;
	isLayerFollowing: boolean;
	// Fullscreen sync state
	isFullscreenEnabled: boolean; // Fullscreen mode is enabled (synced across all users)
}

const initialState: CollaborationState = {
	sessionManager: null,
	isInSession: false,
	sessionId: null,
	isHost: false,
	connectedUsers: [],
	userId: null,
	fileTransferProgress: 0,
	fileTransferMessage: "",
	isTransferring: false,
	// Viewport sync state
	isBroadcasting: false,
	isFollowing: false,
	showFollowToast: false,
	// Layer sync state
	isLayerBroadcasting: false,
	isLayerFollowing: false,
	// Fullscreen sync state
	isFullscreenEnabled: false,
};

function createCollaborationStore() {
	const { subscribe, set, update } = writable<CollaborationState>(initialState);

	// Toast auto-hide timeout
	let toastTimeout: ReturnType<typeof setTimeout> | null = null;
	const TOAST_DURATION = 2000; // 2 seconds

	// Initialize session manager
	const sessionManager = new SessionManager();

	// Set initial state with session manager
	set({
		...initialState,
		sessionManager,
		userId: sessionManager.getUserId(),
	});

	// Set up event listener for peer changes
	sessionManager.getProvider().onEvent((event) => {
		if (event.type === "peer-joined" || event.type === "peer-left") {
			// Update connected users list
			update((state) => {
				if (!state.sessionManager) return state;
				return {
					...state,
					connectedUsers: state.sessionManager.getConnectedUsers(),
				};
			});
		}
	});

	// WORKAROUND: Also listen to awareness changes (fallback if WebRTC peers event doesn't fire)
	sessionManager
		.getProvider()
		.getAwareness()
		.on("change", () => {
			update((state) => {
				if (!state.sessionManager) return state;
				return {
					...state,
					connectedUsers: state.sessionManager.getConnectedUsers(),
				};
			});
		});

	// Clean up on page unload
	if (typeof window !== "undefined") {
		window.addEventListener("beforeunload", (event) => {
			// Mark host for recovery if we're host (for page refresh)
			sessionManager.markHostForRecovery();

			// Show warning if host is leaving with viewers
			if (sessionManager.getHostWarningNeeded()) {
				event.preventDefault();
				// Modern browsers require returnValue to be set
				event.returnValue = "You are the session host. Leaving will affect other viewers.";
				return event.returnValue;
			}

			sessionManager.destroy();
		});
	}

	// Subscribe to host changes
	sessionManager.onHostChanged((newHostId) => {
		const isNowHost = newHostId === sessionManager.getUserId();
		update((state) => {
			// When becoming host, reset broadcast states to start fresh
			// When losing host, also reset broadcast states (old host)
			const newState: CollaborationState = {
				...state,
				isHost: isNowHost,
				connectedUsers: state.sessionManager?.getConnectedUsers() ?? [],
			};

			// Reset broadcast states on host change
			// New host starts with broadcasts disabled, old host loses broadcast rights
			if (isNowHost !== state.isHost) {
				newState.isBroadcasting = false;
				newState.isLayerBroadcasting = false;
				// Reset follow states when becoming host
				if (isNowHost) {
					newState.isFollowing = false;
					newState.isLayerFollowing = false;
				}
			}

			return newState;
		});
	});

	return {
		subscribe,

		/**
		 * Create a new collaboration session
		 * If there's a pending file stored locally, it will be uploaded during session creation
		 */
		createSession: async () => {
			if (!sessionManager) {
				console.error("[collaborationStore] Session manager not initialized");
				return;
			}

			// Check if there's a pending file that needs to be uploaded
			const hasPending = sessionManager.hasPendingFile();

			if (hasPending) {
				// Show upload progress during session creation
				update((state) => ({
					...state,
					isTransferring: true,
					fileTransferProgress: 0,
					fileTransferMessage: "Creating session...",
				}));
			}

			try {
				const sessionId = await sessionManager.createSession(
					hasPending
						? (progress: number, message: string) => {
								update((state) => ({
									...state,
									fileTransferProgress: progress,
									fileTransferMessage: message,
								}));
							}
						: undefined,
				);

				update((state) => ({
					...state,
					isInSession: true,
					sessionId,
					isHost: true,
					isTransferring: false,
					fileTransferProgress: 0,
					fileTransferMessage: "",
					connectedUsers: sessionManager.getConnectedUsers(),
				}));
			} catch (error) {
				console.error("[collaborationStore] Failed to create session:", error);
				update((state) => ({
					...state,
					isTransferring: false,
					fileTransferProgress: 0,
					fileTransferMessage: "",
				}));
				throw error;
			}
		},

		/**
		 * Join an existing session (async - waits for Y.js sync)
		 */
		joinSession: async (sessionId: string) => {
			let sessionManager: SessionManager | null = null;

			update((state) => {
				sessionManager = state.sessionManager;
				return state;
			});

			if (!sessionManager) return;

			await (sessionManager as SessionManager).joinSession(sessionId);

			update((state) => {
				if (!state.sessionManager) return state;

				return {
					...state,
					isInSession: true,
					sessionId,
					isHost: state.sessionManager.getIsHost(),
					connectedUsers: state.sessionManager.getConnectedUsers(),
				};
			});
		},

		/**
		 * Leave current session
		 */
		leaveSession: () => {
			update((state) => {
				if (!state.sessionManager) return state;

				state.sessionManager.leaveSession();

				return {
					...state,
					isInSession: false,
					sessionId: null,
					isHost: false,
					connectedUsers: [],
				};
			});
		},

		/**
		 * Update connected users list
		 */
		updateConnectedUsers: () => {
			update((state) => {
				if (!state.sessionManager) return state;

				return {
					...state,
					connectedUsers: state.sessionManager.getConnectedUsers(),
				};
			});
		},

		/**
		 * Get session manager instance
		 * Note: Returns the closure-scoped sessionManager directly to avoid state mutation during render
		 */
		getSessionManager: (): SessionManager | null => {
			return sessionManager;
		},

		/**
		 * Upload file to session (host only)
		 */
		uploadFile: async (arrayBuffer: ArrayBuffer, fileName: string) => {
			if (!sessionManager) {
				throw new Error("Session manager not initialized");
			}

			update((state) => ({
				...state,
				isTransferring: true,
				fileTransferProgress: 0,
				fileTransferMessage: "Starting upload...",
			}));

			try {
				await sessionManager.uploadFile(
					arrayBuffer,
					fileName,
					(progress: number, message: string) => {
						update((state) => ({
							...state,
							fileTransferProgress: progress,
							fileTransferMessage: message,
						}));
					},
					() => {
						// Unused event handler
					},
				);

				// Save to localStorage for session recovery
				const metadata = sessionManager.getFileMetadata();
				if (
					metadata &&
					metadata.fileId &&
					metadata.fileName &&
					metadata.fileHash &&
					metadata.fileSize
				) {
					sessionManager.saveSessionToLocalStorage(
						metadata.fileId,
						metadata.fileName,
						metadata.fileHash,
						metadata.fileSize,
					);
				}

				update((state) => ({
					...state,
					isTransferring: false,
					fileTransferProgress: 100,
					fileTransferMessage: "Upload complete",
				}));
			} catch (error) {
				console.error("[collaborationStore] File upload failed:", error);
				update((state) => ({
					...state,
					isTransferring: false,
					fileTransferProgress: 0,
					fileTransferMessage: "",
				}));
				throw error;
			}
		},

		/**
		 * Download file from session (peer only)
		 */
		downloadFile: async (): Promise<{
			arrayBuffer: ArrayBuffer;
			fileName: string;
			fileHash: string;
		}> => {
			if (!sessionManager) {
				throw new Error("Session manager not initialized");
			}

			update((state) => ({
				...state,
				isTransferring: true,
				fileTransferProgress: 0,
				fileTransferMessage: "Starting download...",
			}));

			try {
				const result = await sessionManager.downloadFile(
					(progress: number, message: string) => {
						update((state) => ({
							...state,
							fileTransferProgress: progress,
							fileTransferMessage: message,
						}));
					},
					() => {
						// Unused event handler
					},
				);

				// Save to localStorage for session recovery
				const metadata = sessionManager.getFileMetadata();
				if (
					metadata &&
					metadata.fileId &&
					metadata.fileName &&
					metadata.fileHash &&
					metadata.fileSize
				) {
					sessionManager.saveSessionToLocalStorage(
						metadata.fileId,
						metadata.fileName,
						metadata.fileHash,
						metadata.fileSize,
					);
				}

				update((state) => ({
					...state,
					isTransferring: false,
					fileTransferProgress: 100,
					fileTransferMessage: "Download complete",
				}));

				return result;
			} catch (error) {
				console.error("[collaborationStore] File download failed:", error);
				update((state) => ({
					...state,
					isTransferring: false,
					fileTransferProgress: 0,
					fileTransferMessage: "",
				}));
				throw error;
			}
		},

		/**
		 * Check if file is available in session
		 */
		isFileAvailable: (): boolean => {
			return sessionManager?.isFileAvailable() ?? false;
		},

		/**
		 * Download file by ID directly (for session recovery)
		 */
		downloadFileById: async (
			fileId: string,
			fileName: string,
			fileHash: string,
		): Promise<{
			arrayBuffer: ArrayBuffer;
			fileName: string;
			fileHash: string;
		}> => {
			if (!sessionManager) {
				throw new Error("Session manager not initialized");
			}

			update((state) => ({
				...state,
				isTransferring: true,
				fileTransferProgress: 0,
				fileTransferMessage: "Recovering file...",
			}));

			try {
				const result = await sessionManager.downloadFileById(
					fileId,
					fileName,
					fileHash,
					(progress: number, message: string) => {
						update((state) => ({
							...state,
							fileTransferProgress: progress,
							fileTransferMessage: message,
						}));
					},
					() => {
						// Unused event handler
					},
				);

				update((state) => ({
					...state,
					isTransferring: false,
					fileTransferProgress: 100,
					fileTransferMessage: "File recovered",
				}));

				return result;
			} catch (error) {
				console.error("[collaborationStore] File recovery failed:", error);
				update((state) => ({
					...state,
					isTransferring: false,
					fileTransferProgress: 0,
					fileTransferMessage: "",
				}));
				throw error;
			}
		},

		/**
		 * Store file locally for future session creation (NO server upload)
		 * The file will be uploaded when createSession() is called
		 *
		 * This ensures no server communication happens until a session is actually created,
		 * maintaining the "pure frontend-only viewer" principle when not in a session.
		 */
		storePendingFile: (arrayBuffer: ArrayBuffer, fileName: string) => {
			if (!sessionManager) {
				throw new Error("Session manager not initialized");
			}

			// Store locally only - no server communication, no loading indicator
			sessionManager.storePendingFile(arrayBuffer, fileName);
		},

		/**
		 * Check if there's a pending file
		 */
		hasPendingFile: (): boolean => {
			let hasPending = false;
			update((state) => {
				if (state.sessionManager) {
					hasPending = state.sessionManager.hasPendingFile();
				}
				return state;
			});
			return hasPending;
		},

		/**
		 * Get pending file info
		 */
		getPendingFileInfo: (): { fileName: string; fileSize: number } | null => {
			let info: { fileName: string; fileSize: number } | null = null;
			update((state) => {
				if (state.sessionManager) {
					info = state.sessionManager.getPendingFileInfo();
				}
				return state;
			});
			return info;
		},

		/**
		 * Get stored session info from localStorage
		 */
		getStoredSessionInfo: (): {
			fileId: string;
			fileName: string;
			fileHash: string;
			fileSize: number;
		} | null => {
			let info: {
				fileId: string;
				fileName: string;
				fileHash: string;
				fileSize: number;
			} | null = null;
			update((state) => {
				if (state.sessionManager) {
					info = state.sessionManager.loadSessionFromLocalStorage();
				}
				return state;
			});
			return info;
		},

		/**
		 * Update file transfer progress
		 */
		updateFileTransferProgress: (progress: number, message: string) => {
			update((state) => ({
				...state,
				fileTransferProgress: progress,
				fileTransferMessage: message,
			}));
		},

		/**
		 * Reset store
		 */
		reset: () => {
			update((state) => {
				if (state.sessionManager) {
					state.sessionManager.destroy();
				}
				return initialState;
			});
		},

		// ==========================================
		// Host Management Actions
		// ==========================================

		/**
		 * Check if viewer can claim host
		 */
		canClaimHost: (): boolean => {
			let canClaim = false;
			update((state) => {
				if (state.sessionManager) {
					canClaim = state.sessionManager.canClaimHost();
				}
				return state;
			});
			return canClaim;
		},

		/**
		 * Claim host status (viewer becomes host)
		 */
		claimHost: () => {
			update((state) => {
				if (!state.sessionManager) return state;

				const success = state.sessionManager.claimHost();

				if (success) {
					return {
						...state,
						isHost: true,
						connectedUsers: state.sessionManager.getConnectedUsers(),
					};
				}
				return state;
			});
		},

		/**
		 * Transfer host to another user
		 */
		transferHost: (targetUserId: string) => {
			update((state) => {
				if (!state.sessionManager) return state;

				const success = state.sessionManager.transferHost(targetUserId);

				if (success) {
					return {
						...state,
						isHost: false,
						// Reset broadcast state when no longer host
						isBroadcasting: false,
						isLayerBroadcasting: false,
						connectedUsers: state.sessionManager.getConnectedUsers(),
					};
				}
				return state;
			});
		},

		/**
		 * Check if host warning is needed before leaving
		 */
		getHostWarningNeeded: (): boolean => {
			let needed = false;
			update((state) => {
				if (state.sessionManager) {
					needed = state.sessionManager.getHostWarningNeeded();
				}
				return state;
			});
			return needed;
		},

		/**
		 * Get transfer candidates (viewers sorted by joinedAt)
		 */
		getTransferCandidates: (): string[] => {
			let candidates: string[] = [];
			update((state) => {
				if (state.sessionManager) {
					candidates = state.sessionManager.getTransferCandidates();
				}
				return state;
			});
			return candidates;
		},

		// ==========================================
		// Viewport Sync Actions
		// ==========================================

		/**
		 * Enable viewport broadcast (host only)
		 * Also auto-enables fullscreen mode and layer sync for all users
		 */
		enableBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;

				// enableViewportBroadcast() also enables layer broadcast (Issue #46)
				state.sessionManager.enableViewportBroadcast();
				// Auto-enable fullscreen when broadcast starts
				state.sessionManager.enableFullscreen();

				return {
					...state,
					isBroadcasting: true,
					isFullscreenEnabled: true,
					isLayerBroadcasting: true,
				};
			});
		},

		/**
		 * Disable viewport broadcast (host only)
		 * Also disables fullscreen mode and layer sync
		 */
		disableBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;

				// disableViewportBroadcast() also disables layer broadcast
				state.sessionManager.disableViewportBroadcast();
				// Disable fullscreen when broadcast stops
				state.sessionManager.disableFullscreen();

				return {
					...state,
					isBroadcasting: false,
					isFullscreenEnabled: false,
					isLayerBroadcasting: false,
				};
			});
		},

		/**
		 * Toggle viewport broadcast (host only)
		 * Also toggles fullscreen mode and layer sync
		 */
		toggleBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;

				if (state.isBroadcasting) {
					// disable methods also handle layer broadcast
					state.sessionManager.disableViewportBroadcast();
					state.sessionManager.disableFullscreen();
				} else {
					// enable methods also handle layer broadcast
					state.sessionManager.enableViewportBroadcast();
					state.sessionManager.enableFullscreen();
				}

				return {
					...state,
					isBroadcasting: !state.isBroadcasting,
					isFullscreenEnabled: !state.isBroadcasting,
					isLayerBroadcasting: !state.isBroadcasting,
				};
			});
		},

		/**
		 * Enable following host's viewport (viewer only)
		 */
		enableFollowing: () => {
			update((state) => {
				if (state.isHost) return state; // Host doesn't follow

				return {
					...state,
					isFollowing: true,
					showFollowToast: true,
				};
			});
		},

		/**
		 * Disable following host's viewport (viewer only)
		 */
		disableFollowing: () => {
			update((state) => {
				if (state.isHost) return state;

				return {
					...state,
					isFollowing: false,
					showFollowToast: false,
				};
			});
		},

		/**
		 * Toggle following host's viewport (viewer only)
		 * This sets a P1 override in ViewportSync
		 */
		toggleFollowing: () => {
			update((state) => {
				if (state.isHost) return state;

				const newFollowing = !state.isFollowing;

				// Set P1 override in ViewportSync
				state.sessionManager?.getViewportSync()?.setFollowOverride(newFollowing);

				return {
					...state,
					isFollowing: newFollowing,
					showFollowToast: newFollowing,
				};
			});
		},

		/**
		 * Show follow toast (called when user tries to interact while following)
		 * Auto-hides after TOAST_DURATION
		 */
		showFollowToast: () => {
			// Clear any existing timeout
			if (toastTimeout) {
				clearTimeout(toastTimeout);
			}

			update((state) => ({
				...state,
				showFollowToast: true,
			}));

			// Auto-hide after duration
			toastTimeout = setTimeout(() => {
				update((state) => ({
					...state,
					showFollowToast: false,
				}));
				toastTimeout = null;
			}, TOAST_DURATION);
		},

		/**
		 * Hide follow toast
		 */
		hideFollowToast: () => {
			if (toastTimeout) {
				clearTimeout(toastTimeout);
				toastTimeout = null;
			}
			update((state) => ({
				...state,
				showFollowToast: false,
			}));
		},

		/**
		 * Handle broadcast state change from ViewportSync
		 * Called from either P0 (Y.Map) or P2 (awareness heartbeat)
		 *
		 * For P2 calls: ViewportSync already checked followOverride before calling
		 * So if we get here via P2, we should sync with the broadcast state
		 */
		handleBroadcastStateChanged: (enabled: boolean, _hostId: string | null) => {
			update((state) => {
				// Skip if we're the host
				if (state.isHost) {
					return {
						...state,
						isBroadcasting: enabled,
					};
				}

				// For viewers: sync with the broadcast state
				// ViewportSync handles P1 override filtering before calling this
				return {
					...state,
					isFollowing: enabled,
					showFollowToast: enabled,
				};
			});
		},

		/**
		 * Check if broadcast is enabled
		 */
		isBroadcastEnabled: (): boolean => {
			return sessionManager?.isViewportBroadcastEnabled() ?? false;
		},

		// ==========================================
		// Layer Sync Actions
		// ==========================================

		enableLayerBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;
				state.sessionManager.enableLayerBroadcast();
				return { ...state, isLayerBroadcasting: true };
			});
		},

		disableLayerBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;
				state.sessionManager.disableLayerBroadcast();
				return { ...state, isLayerBroadcasting: false };
			});
		},

		toggleLayerBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;
				if (state.isLayerBroadcasting) {
					state.sessionManager.disableLayerBroadcast();
				} else {
					state.sessionManager.enableLayerBroadcast();
				}
				return { ...state, isLayerBroadcasting: !state.isLayerBroadcasting };
			});
		},

		toggleLayerFollowing: () => {
			update((state) => {
				if (state.isHost) return state;
				const newFollowing = !state.isLayerFollowing;
				state.sessionManager?.getLayerSync()?.setFollowOverride(newFollowing);
				return { ...state, isLayerFollowing: newFollowing };
			});
		},

		handleLayerBroadcastStateChanged: (enabled: boolean) => {
			update((state) => {
				if (state.isHost) return { ...state, isLayerBroadcasting: enabled };
				return { ...state, isLayerFollowing: enabled };
			});
		},

		isLayerBroadcastEnabled: (): boolean => {
			return sessionManager?.isLayerBroadcastEnabled() ?? false;
		},

		// ==========================================
		// Fullscreen Sync Actions
		// ==========================================

		/**
		 * Handle fullscreen state changes from P0 (Y.Map) or P2 (awareness heartbeat)
		 * Auto-enables fullscreen for all users when host starts broadcasting
		 */
		handleFullscreenStateChanged: (enabled: boolean, _hostId: string | null) => {
			update((state) => {
				return { ...state, isFullscreenEnabled: enabled };
			});
		},

		isFullscreenEnabled: (): boolean => {
			return sessionManager?.isFullscreenEnabled() ?? false;
		},
	};
}

export const collaborationStore = createCollaborationStore();
