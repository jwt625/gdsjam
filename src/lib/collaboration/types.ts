/**
 * Collaboration Types
 *
 * Shared types for P2P collaboration features
 */

/**
 * Session metadata stored in Y.js
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
 * Viewport state for a user
 */
export interface ViewportState {
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
	color: string; // Assigned color for viewport rectangles
	isHost: boolean;
	joinedAt: number;
}

/**
 * File chunk for transfer
 */
export interface FileChunk {
	index: number;
	data: Uint8Array;
	totalChunks: number;
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
	| { type: "viewport-updated"; userId: string; viewport: ViewportState };

/**
 * Collaboration event callback
 */
export type CollaborationEventCallback = (event: CollaborationEvent) => void;
