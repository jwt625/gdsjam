/**
 * Collaboration Types
 *
 * Shared types for P2P collaboration features
 */

/**
 * Session metadata stored in Y.js (legacy interface for backward compatibility)
 */
export interface SessionMetadata {
	sessionId: string;
	fileHash: string; // SHA-256 hex string
	fileName: string;
	fileSize: number;
	uploadedBy: string; // User ID of host
	uploadedAt: number; // Unix timestamp
	createdAt: number;
}

/**
 * Y.js session map data structure
 * All fields stored in the shared "session" Y.Map
 * This is the source of truth for session state
 */
export interface YjsSessionData {
	// Session identity
	sessionId: string;
	createdAt: number;

	// File metadata
	fileId: string;
	fileName: string;
	fileSize: number;
	fileHash: string; // SHA-256 hex string
	uploadedBy: string; // userId of original uploader (immutable)
	uploadedAt: number;

	// Host management
	currentHostId: string; // userId of current host
	hostLastSeen: number; // timestamp for absence detection

	// Participant tracking
	participants: YjsParticipant[];
}

/**
 * Participant information stored in Y.js
 */
export interface YjsParticipant {
	userId: string;
	displayName: string; // Unique "Anonymous Animal" name
	joinedAt: number;
	lastSeen: number; // Heartbeat timestamp for stale participant cleanup
	color: string;
}

/**
 * Viewport state for collaboration sync (via Awareness API)
 * Named differently from PixiRenderer.ViewportState to avoid confusion
 */
export interface CollaborativeViewportState {
	x: number; // Container x position
	y: number; // Container y position
	scale: number; // Zoom scale
	width: number; // Screen width in pixels
	height: number; // Screen height in pixels
	updatedAt: number; // Timestamp for staleness detection
}

/**
 * User information
 */
export interface UserInfo {
	id: string;
	displayName: string; // Display name for the user
	color: string; // Assigned color for viewport rectangles
	isHost: boolean;
	joinedAt: number;
}

/**
 * Collaboration event types
 */
export type CollaborationEvent =
	| { type: "peer-joined"; userId: string }
	| { type: "peer-left"; userId: string }
	| { type: "host-changed"; newHostId: string }
	| { type: "file-transfer-progress"; progress: number; message: string }
	| { type: "file-transfer-complete" }
	| { type: "layer-visibility-changed"; layerKey: string; visible: boolean }
	| { type: "viewport-updated"; userId: string; viewport: CollaborativeViewportState };

/**
 * Collaboration event callback
 */
export type CollaborationEventCallback = (event: CollaborationEvent) => void;
