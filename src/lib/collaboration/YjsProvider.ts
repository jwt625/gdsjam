/**
 * YjsProvider - Wrapper for Y.js and y-webrtc
 *
 * Responsibilities:
 * - Initialize Y.Doc and y-webrtc provider
 * - Manage WebRTC connections
 * - Provide access to shared Y.js data structures
 * - Handle peer connection events
 */

// @ts-expect-error - y-protocols types may not be available
import { Awareness } from "y-protocols/awareness.js";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";
import { DEBUG } from "../config";
import type { CollaborationEventCallback } from "./types";

export class YjsProvider {
	private ydoc: Y.Doc;
	private awareness: Awareness;
	private provider: WebrtcProvider | null = null;
	private roomName: string | null = null;
	private userId: string;
	private eventCallbacks: CollaborationEventCallback[] = [];
	private connectedPeers: Set<string> = new Set();

	constructor(userId: string) {
		this.userId = userId;
		this.ydoc = new Y.Doc();
		this.awareness = new Awareness(this.ydoc);

		if (DEBUG) {
			console.log("[YjsProvider] Initialized with user ID:", userId);
		}
	}

	/**
	 * Connect to a Y.js room via WebRTC
	 */
	connect(roomName: string): void {
		// If already connected to this room, do nothing
		if (this.provider && this.roomName === roomName) {
			if (DEBUG) {
				console.log("[YjsProvider] Already connected to room:", this.roomName);
			}
			return;
		}

		// If connected to a different room, disconnect first
		if (this.provider && this.roomName !== roomName) {
			if (DEBUG) {
				console.log("[YjsProvider] Disconnecting from old room:", this.roomName);
			}
			this.disconnect();
		}

		this.roomName = roomName;

		// Create WebRTC provider
		// Using self-hosted signaling server on OCI
		// Load signaling server URL and token from environment variables
		const signalingUrl = import.meta.env.VITE_SIGNALING_SERVER_URL || "ws://146.235.193.141:4444";
		const signalingToken = import.meta.env.VITE_SIGNALING_SERVER_TOKEN;

		// Construct signaling server URL with token authentication
		const signalingServerUrl = signalingToken
			? `${signalingUrl}?token=${signalingToken}`
			: signalingUrl;

		if (DEBUG) {
			console.log("[YjsProvider] Using signaling server:", signalingUrl);
			console.log("[YjsProvider] Token present:", !!signalingToken);
		}

		this.provider = new WebrtcProvider(roomName, this.ydoc, {
			// Self-hosted signaling server with token authentication
			signaling: [signalingServerUrl],
			password: undefined, // No password for MVP
			awareness: this.awareness, // Use proper Awareness instance
			maxConns: 20, // Max peer connections
			filterBcConns: false, // Allow broadcast connections for local network discovery
			// WebRTC peer options with STUN servers for NAT traversal
			peerOpts: {
				config: {
					iceServers: [
						{ urls: "stun:stun.l.google.com:19302" },
						{ urls: "stun:stun1.l.google.com:19302" },
						{ urls: "stun:stun2.l.google.com:19302" },
					],
				},
			},
		});

		// Set up event listeners
		this.provider.on("synced", (event: { synced: boolean }) => {
			if (DEBUG) {
				console.log("[YjsProvider] Synced:", event.synced);
			}
		});

		// Log awareness changes (other users' presence)
		this.awareness.on("change", () => {
			if (DEBUG) {
				const states = Array.from(this.awareness.getStates().entries());
				console.log("[YjsProvider] Awareness states:", states);
				console.log("[YjsProvider] Number of aware clients:", states.length);
			}
		});

		// Log WebRTC connection status and listen to internal events
		if (DEBUG && this.provider.room) {
			// @ts-expect-error - accessing internal property for debugging
			const room = this.provider.room;
			console.log("[YjsProvider] WebRTC room created, waiting for peer connections...");

			// Listen to signaling messages
			// @ts-expect-error
			if (room.provider && room.provider.on) {
				// @ts-expect-error
				room.provider.on("message", (data: any) => {
					console.log("[YjsProvider] Signaling message received:", data);
				});
			}
		}

		this.provider.on(
			"peers",
			(event: { added: string[]; removed: string[]; webrtcPeers: string[] }) => {
				if (DEBUG) {
					console.log("[YjsProvider] Peers changed:", event);
					console.log("[YjsProvider] WebRTC peers:", event.webrtcPeers);
					console.log(
						"[YjsProvider] Connected peers before update:",
						Array.from(this.connectedPeers),
					);
				}

				// Update connected peers set
				for (const peerId of event.added) {
					this.connectedPeers.add(peerId);
					if (DEBUG) {
						console.log("[YjsProvider] Peer joined:", peerId);
					}
					this.notifyEvent({ type: "peer-joined", userId: peerId });
				}

				for (const peerId of event.removed) {
					this.connectedPeers.delete(peerId);
					if (DEBUG) {
						console.log("[YjsProvider] Peer left:", peerId);
					}
					this.notifyEvent({ type: "peer-left", userId: peerId });
				}

				if (DEBUG) {
					console.log(
						"[YjsProvider] Connected peers after update:",
						Array.from(this.connectedPeers),
					);
				}
			},
		);

		if (DEBUG) {
			console.log("[YjsProvider] Connected to room:", roomName);

			// Log WebRTC connection status periodically
			setTimeout(() => {
				const peerCount = this.connectedPeers.size;
				const awarenessCount = this.awareness.getStates().size;
				console.log("[YjsProvider] Status check:");
				console.log("  - Connected WebRTC peers:", peerCount);
				console.log("  - Awareness states:", awarenessCount);
				console.log("  - Peer IDs:", Array.from(this.connectedPeers));
			}, 3000);
		}
	}

	/**
	 * Disconnect from the current room
	 */
	disconnect(): void {
		if (this.provider) {
			this.provider.destroy();
			this.provider = null;
			this.roomName = null;
			this.connectedPeers.clear();

			if (DEBUG) {
				console.log("[YjsProvider] Disconnected from room");
			}
		}
	}

	/**
	 * Get the Y.Doc instance
	 */
	getDoc(): Y.Doc {
		return this.ydoc;
	}

	/**
	 * Get a Y.Map by name
	 */
	getMap<T = any>(name: string): Y.Map<T> {
		return this.ydoc.getMap(name);
	}

	/**
	 * Get a Y.Array by name
	 */
	getArray<T = any>(name: string): Y.Array<T> {
		return this.ydoc.getArray(name);
	}

	/**
	 * Get current user ID
	 */
	getUserId(): string {
		return this.userId;
	}

	/**
	 * Get connected peer IDs
	 */
	getPeerIds(): string[] {
		return Array.from(this.connectedPeers);
	}

	/**
	 * Check if connected to a room
	 */
	isConnected(): boolean {
		return this.provider !== null;
	}

	/**
	 * Get current room name
	 */
	getRoomName(): string | null {
		return this.roomName;
	}

	/**
	 * Register event callback
	 */
	onEvent(callback: CollaborationEventCallback): void {
		this.eventCallbacks.push(callback);
	}

	/**
	 * Get Awareness instance
	 */
	getAwareness(): Awareness {
		return this.awareness;
	}

	/**
	 * Notify all event callbacks
	 */
	private notifyEvent(event: Parameters<CollaborationEventCallback>[0]): void {
		for (const callback of this.eventCallbacks) {
			callback(event);
		}
	}

	/**
	 * Destroy the provider and clean up
	 */
	destroy(): void {
		this.disconnect();
		this.ydoc.destroy();
		this.eventCallbacks = [];
	}
}
