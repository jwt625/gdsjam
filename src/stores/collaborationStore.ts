/**
 * Collaboration Store - Manages collaboration session state
 */

import { writable } from "svelte/store";
import { SessionManager } from "../lib/collaboration/SessionManager";
import type { UserInfo } from "../lib/collaboration/types";
import { DEBUG } from "../lib/config";

interface CollaborationState {
	sessionManager: SessionManager | null;
	isInSession: boolean;
	sessionId: string | null;
	isHost: boolean;
	connectedUsers: UserInfo[];
	userId: string | null;
}

const initialState: CollaborationState = {
	sessionManager: null,
	isInSession: false,
	sessionId: null,
	isHost: false,
	connectedUsers: [],
	userId: null,
};

function createCollaborationStore() {
	const { subscribe, set, update } = writable<CollaborationState>(initialState);

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
		window.addEventListener("beforeunload", () => {
			sessionManager.destroy();
		});
	}

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
		 * Join an existing session
		 */
		joinSession: (sessionId: string) => {
			update((state) => {
				if (!state.sessionManager) return state;

				state.sessionManager.joinSession(sessionId);

				if (DEBUG) {
					console.log("[collaborationStore] Joined session:", sessionId);
				}

				return {
					...state,
					isInSession: true,
					sessionId,
					isHost: false,
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
		 */
		getSessionManager: (): SessionManager | null => {
			let manager: SessionManager | null = null;
			update((state) => {
				manager = state.sessionManager;
				return state;
			});
			return manager;
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
	};
}

export const collaborationStore = createCollaborationStore();
