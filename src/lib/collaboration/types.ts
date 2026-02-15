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

	// Viewport broadcast (Phase 1)
	broadcastEnabled?: boolean;
	broadcastHostId?: string;

	// Layer visibility broadcast (Issue #16)
	layerBroadcastEnabled?: boolean;
	layerBroadcastHostId?: string;

	// Fullscreen mode broadcast (Issue #46)
	fullscreenEnabled?: boolean;
	fullscreenHostId?: string;

	// Comment permissions (Issue #49)
	commentPermissions?: CommentPermissions;
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
 * Participant viewport data for minimap rendering (Phase 3)
 * Aggregates viewport + user info for display
 * Note: Self is excluded from this list (we have our own viewport outline)
 */
export interface ParticipantViewport {
	userId: string;
	displayName: string;
	color: string; // Assigned participant color
	viewport: CollaborativeViewportState;
	isFollowed: boolean; // True if this is the user we're following
}

/**
 * Layer visibility state for collaboration sync
 */
export interface CollaborativeLayerVisibility {
	visibility: { [layerKey: string]: boolean };
	updatedAt: number;
}

/**
 * Awareness state structure for a participant
 * This is what each user stores in their awareness local state
 */
export interface AwarenessState {
	userId: string;
	displayName: string;
	color: string;
	isHost: boolean;
	viewport?: CollaborativeViewportState | null;
	/** Host includes this in awareness for P2 (heartbeat) sync */
	broadcastEnabled?: boolean;
	/** Host includes layer visibility in awareness for P2 sync */
	layerBroadcastEnabled?: boolean;
	layerVisibility?: CollaborativeLayerVisibility | null;
	/** Host includes fullscreen state in awareness for P2 sync */
	fullscreenEnabled?: boolean;
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

/**
 * Comment data structure for floating comments (Issue #49)
 */
export interface Comment {
	/** Unique identifier (UUID) */
	id: string;
	/** Author user ID */
	authorId: string;
	/** Author display name (for display) */
	authorName: string;
	/** Author color (for bubble styling) */
	authorColor: string;
	/** Comment text content (max 1000 chars) */
	content: string;
	/** World coordinates (database units) - X position */
	worldX: number;
	/** World coordinates (database units) - Y position */
	worldY: number;
	/** Creation timestamp (milliseconds since epoch) */
	createdAt: number;
	/** Last edit timestamp (milliseconds since epoch, null if never edited) */
	editedAt: number | null;
	/** Parent comment ID (null for root comments) */
	parentId: string | null;
	/** Root thread comment ID (same as id for root comments) */
	rootId: string;
	/** Soft-delete flag */
	deleted: boolean;
	/** Soft-delete timestamp (null if not deleted) */
	deletedAt: number | null;
}

/**
 * Comment permissions for collaboration sessions (Issue #49)
 */
export interface CommentPermissions {
	/** Whether viewers can create comments (default: true) */
	viewersCanComment: boolean;
	/** Rate limit for viewers (comments per minute, default: 1) */
	viewerRateLimit: number;
	/** Rate limit for host (comments per 10 seconds, default: 1) */
	hostRateLimit: number;
}
