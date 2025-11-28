/**
 * Collaboration Store - Manages collaboration session state
 */

import { writable } from "svelte/store";
import { SessionManager } from "../lib/collaboration/SessionManager";
import type { CollaborationEvent, UserInfo } from "../lib/collaboration/types";
import { DEBUG } from "../lib/config";

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
			if (DEBUG) {
				console.log("[collaborationStore] Peer event:", event);
			}
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
			if (DEBUG) {
				console.log("[collaborationStore] Awareness changed, updating user list");
			}
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
		if (DEBUG) {
			console.log("[collaborationStore] Host changed to:", newHostId);
		}
		update((state) => ({
			...state,
			isHost: newHostId === sessionManager.getUserId(),
			connectedUsers: state.sessionManager?.getConnectedUsers() ?? [],
		}));
	});

	return {
		subscribe,

		/**
		 * Create a new collaboration session
		 */
		createSession: () => {
			update((state) => {
				if (!state.sessionManager) return state;

				const sessionId = state.sessionManager.createSession();

				if (DEBUG) {
					console.log("[collaborationStore] Created session:", sessionId);
				}

				return {
					...state,
					isInSession: true,
					sessionId,
					isHost: true,
					connectedUsers: state.sessionManager.getConnectedUsers(),
				};
			});
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

			if (DEBUG) {
				console.log("[collaborationStore] Joined session:", sessionId);
			}

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

				if (DEBUG) {
					console.log("[collaborationStore] Left session");
				}

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
					(event: CollaborationEvent) => {
						if (DEBUG) {
							console.log("[collaborationStore] File transfer event:", event);
						}
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
					(event: CollaborationEvent) => {
						if (DEBUG) {
							console.log("[collaborationStore] File transfer event:", event);
						}
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
					(event: CollaborationEvent) => {
						if (DEBUG) {
							console.log("[collaborationStore] File recovery event:", event);
						}
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
		 * Upload file as pending (before session creation)
		 */
		uploadFilePending: async (arrayBuffer: ArrayBuffer, fileName: string) => {
			const getManager = (): SessionManager => {
				let mgr: SessionManager | null = null;
				update((state) => {
					mgr = state.sessionManager;
					return state;
				});
				if (!mgr) {
					throw new Error("Session manager not initialized");
				}
				return mgr;
			};

			const manager = getManager();

			update((state) => ({
				...state,
				isTransferring: true,
				fileTransferProgress: 0,
				fileTransferMessage: "Uploading file...",
			}));

			try {
				await manager.uploadFilePending(
					arrayBuffer,
					fileName,
					(progress: number, message: string) => {
						update((state) => ({
							...state,
							fileTransferProgress: progress,
							fileTransferMessage: message,
						}));
					},
				);

				update((state) => ({
					...state,
					isTransferring: false,
					fileTransferProgress: 100,
					fileTransferMessage: "File ready, create session to share",
				}));
			} catch (error) {
				console.error("[collaborationStore] Pending file upload failed:", error);
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

				if (DEBUG) {
					console.log("[collaborationStore] Claim host:", success);
				}

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

				if (DEBUG) {
					console.log("[collaborationStore] Transfer host to:", targetUserId, "success:", success);
				}

				if (success) {
					return {
						...state,
						isHost: false,
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
		 */
		enableBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;

				state.sessionManager.enableViewportBroadcast();

				if (DEBUG) {
					console.log("[collaborationStore] Viewport broadcast enabled");
				}

				return {
					...state,
					isBroadcasting: true,
				};
			});
		},

		/**
		 * Disable viewport broadcast (host only)
		 */
		disableBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;

				state.sessionManager.disableViewportBroadcast();

				if (DEBUG) {
					console.log("[collaborationStore] Viewport broadcast disabled");
				}

				return {
					...state,
					isBroadcasting: false,
				};
			});
		},

		/**
		 * Toggle viewport broadcast (host only)
		 */
		toggleBroadcast: () => {
			update((state) => {
				if (!state.sessionManager || !state.isHost) return state;

				if (state.isBroadcasting) {
					state.sessionManager.disableViewportBroadcast();
				} else {
					state.sessionManager.enableViewportBroadcast();
				}

				if (DEBUG) {
					console.log("[collaborationStore] Viewport broadcast toggled:", !state.isBroadcasting);
				}

				return {
					...state,
					isBroadcasting: !state.isBroadcasting,
				};
			});
		},

		/**
		 * Enable following host's viewport (viewer only)
		 */
		enableFollowing: () => {
			update((state) => {
				if (state.isHost) return state; // Host doesn't follow

				if (DEBUG) {
					console.log("[collaborationStore] Following enabled");
				}

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

				if (DEBUG) {
					console.log("[collaborationStore] Following disabled");
				}

				return {
					...state,
					isFollowing: false,
					showFollowToast: false,
				};
			});
		},

		/**
		 * Toggle following host's viewport (viewer only)
		 */
		toggleFollowing: () => {
			update((state) => {
				if (state.isHost) return state;

				const newFollowing = !state.isFollowing;

				if (DEBUG) {
					console.log("[collaborationStore] Following toggled:", newFollowing);
				}

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
		 * Handle broadcast state change from Y.js
		 * Called when host enables/disables broadcast
		 */
		handleBroadcastStateChanged: (enabled: boolean, _hostId: string | null) => {
			update((state) => {
				// If broadcast just enabled and we're a viewer, auto-follow
				const shouldAutoFollow = enabled && !state.isHost && !state.isFollowing;
				// If broadcast disabled and we're a viewer, stop following
				const shouldStopFollowing = !enabled && !state.isHost && state.isFollowing;

				if (DEBUG) {
					console.log("[collaborationStore] Broadcast state changed:", {
						enabled,
						shouldAutoFollow,
						shouldStopFollowing,
					});
				}

				return {
					...state,
					isBroadcasting: state.isHost ? enabled : state.isBroadcasting,
					isFollowing: shouldStopFollowing ? false : shouldAutoFollow ? true : state.isFollowing,
					showFollowToast: shouldStopFollowing
						? false
						: shouldAutoFollow
							? true
							: state.showFollowToast,
				};
			});
		},

		/**
		 * Check if broadcast is enabled
		 */
		isBroadcastEnabled: (): boolean => {
			return sessionManager?.isViewportBroadcastEnabled() ?? false;
		},
	};
}

export const collaborationStore = createCollaborationStore();
