/**
 * YjsProvider - Wrapper for Y.js and y-webrtc
 *
 * Responsibilities:
 * - Initialize Y.Doc and y-webrtc provider
 * - Manage WebRTC connections
 * - Provide access to shared Y.js data structures
 * - Handle peer connection events
 */

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

		// Enable y-webrtc logging in development
		if (DEBUG && typeof localStorage !== "undefined") {
			localStorage.setItem("log", "y-webrtc");
		}
	}

	/**
	 * Connect to a Y.js room via WebRTC
	 */
	connect(roomName: string): void {
		// If already connected to this room, do nothing
		if (this.provider && this.roomName === roomName) {
			return;
		}

		// If connected to a different room, disconnect first
		if (this.provider && this.roomName !== roomName) {
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

		// Load TURN server credentials from environment
		const turnPassword = import.meta.env.VITE_TURN_PASSWORD;

		// Build ICE servers configuration
		const iceServers: RTCIceServer[] = [
			// STUN servers for NAT discovery
			{ urls: "stun:stun.l.google.com:19302" },
			{ urls: "stun:stun1.l.google.com:19302" },
			{ urls: "stun:stun2.l.google.com:19302" },
		];

		// Add TURN server if credentials are available
		if (turnPassword) {
			iceServers.push({
				urls: [
					"turn:signaling.gdsjam.com:3478",
					"turn:signaling.gdsjam.com:3478?transport=tcp",
					"turns:signaling.gdsjam.com:5349?transport=tcp",
				],
				username: "gdsjam",
				credential: turnPassword,
			});
		}

		this.provider = new WebrtcProvider(roomName, this.ydoc, {
			// Self-hosted signaling server with token authentication
			signaling: [signalingServerUrl],
			password: undefined, // No password for MVP
			awareness: this.awareness, // Use proper Awareness instance
			maxConns: 20, // Max peer connections
			filterBcConns: true, // NEVER allow BroadcastChannel - causes issues with file sync
			// WebRTC peer options with STUN and TURN servers for NAT traversal
			peerOpts: {
				config: {
					iceServers,
					iceTransportPolicy: "all", // Try all connection types (direct, STUN, TURN)
				},
			},
		});

		// Listen to Y.js document updates
		// Set up event listeners
		this.provider.on("synced", () => {
			// Synced
		});

		// Log awareness changes (other users' presence)
		this.awareness.on("change", () => {
			// Awareness changed
		});

		this.provider.on(
			"peers",
			(event: { added: string[]; removed: string[]; webrtcPeers: string[] }) => {
				// Update connected peers set
				for (const peerId of event.added) {
					this.connectedPeers.add(peerId);
					this.notifyEvent({ type: "peer-joined", userId: peerId });
				}

				for (const peerId of event.removed) {
					this.connectedPeers.delete(peerId);
					this.notifyEvent({ type: "peer-left", userId: peerId });
				}
			},
		);
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
	 * Wait for Y.js to sync with peers
	 * Returns a promise that resolves when sync is complete or timeout expires
	 * @param timeoutMs - Maximum time to wait for sync (default: 5000ms)
	 */
	waitForSync(timeoutMs: number = 5000): Promise<boolean> {
		return new Promise((resolve) => {
			// If no provider, resolve immediately
			if (!this.provider) {
				resolve(false);
				return;
			}

			// If already synced, resolve immediately
			if ((this.provider as any).synced) {
				resolve(true);
				return;
			}

			let resolved = false;

			// Set up timeout
			const timeout = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					resolve(false);
				}
			}, timeoutMs);

			// Listen for sync event
			const onSynced = (event: { synced: boolean }) => {
				if (event.synced && !resolved) {
					resolved = true;
					clearTimeout(timeout);
					this.provider?.off("synced", onSynced);
					resolve(true);
				}
			};

			this.provider.on("synced", onSynced);
		});
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
