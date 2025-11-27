/**
 * ParticipantManager - Manages participant information for collaboration sessions
 *
 * Responsibilities:
 * - Generate unique display names (Anonymous Animal pattern)
 * - Assign consistent colors to users
 * - Track connected participants in Y.js
 * - Manage awareness state for local user
 * - Provide participant list sorted by join time
 */

import { DEBUG } from "../config";
import type { YjsParticipant } from "./types";
import type { YjsProvider } from "./YjsProvider";

// Color palette for user identification
const USER_COLOR_PALETTE = [
	"#FF6B6B", // Red
	"#4ECDC4", // Teal
	"#45B7D1", // Blue
	"#FFA07A", // Light Salmon
	"#98D8C8", // Mint
	"#F7DC6F", // Yellow
	"#BB8FCE", // Purple
	"#85C1E2", // Sky Blue
	"#82E0AA", // Green
	"#F5B7B1", // Pink
];

// Word lists for display name generation
const ADJECTIVES = [
	"Anonymous",
	"Curious",
	"Clever",
	"Swift",
	"Gentle",
	"Brave",
	"Quiet",
	"Bright",
	"Calm",
	"Eager",
	"Friendly",
	"Happy",
	"Jolly",
	"Kind",
	"Lively",
	"Merry",
	"Noble",
	"Patient",
	"Peaceful",
	"Witty",
];

const ANIMALS = [
	"Otter",
	"Panda",
	"Fox",
	"Owl",
	"Dolphin",
	"Koala",
	"Penguin",
	"Rabbit",
	"Squirrel",
	"Turtle",
	"Bear",
	"Cat",
	"Dog",
	"Eagle",
	"Falcon",
	"Giraffe",
	"Hedgehog",
	"Jaguar",
	"Kangaroo",
	"Lion",
];

export class ParticipantManager {
	private yjsProvider: YjsProvider;
	private userId: string;
	private sessionId: string | null = null;
	private localDisplayName: string | null = null;
	private localColor: string;
	private participantChangedCallbacks: Array<(participants: YjsParticipant[]) => void> = [];

	constructor(yjsProvider: YjsProvider, userId: string) {
		this.yjsProvider = yjsProvider;
		this.userId = userId;
		this.localColor = this.getUserColor(userId);

		if (DEBUG) {
			console.log("[ParticipantManager] Initialized for user:", userId);
		}
	}

	/**
	 * Initialize participant manager for a session
	 */
	initialize(sessionId: string): void {
		this.sessionId = sessionId;
		this.setupParticipantObserver();

		if (DEBUG) {
			console.log("[ParticipantManager] Initialized for session:", sessionId);
		}
	}

	/**
	 * Set up Y.js observer for participants changes
	 */
	private setupParticipantObserver(): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		sessionMap.observe((event) => {
			if (event.keysChanged.has("participants")) {
				const participants = this.getParticipants();
				this.notifyParticipantsChanged(participants);

				if (DEBUG) {
					console.log("[ParticipantManager] Participants changed:", participants.length);
				}
			}
		});

		// Also observe awareness for real-time presence
		const awareness = this.yjsProvider.getAwareness();
		awareness.on("change", () => {
			// Awareness changed - could update UI for real-time presence
			// This is separate from Y.js participants array
		});
	}

	/**
	 * Generate hash from string
	 */
	private hashString(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = str.charCodeAt(i) + ((hash << 5) - hash);
		}
		return Math.abs(hash);
	}

	/**
	 * Get user color based on user ID (consistent across sessions)
	 */
	getUserColor(userId: string): string {
		const hash = this.hashString(userId);
		const index = hash % USER_COLOR_PALETTE.length;
		return USER_COLOR_PALETTE[index] ?? "#888888";
	}

	/**
	 * Generate base display name from userId hash
	 */
	private generateBaseName(userId: string): string {
		const hash = this.hashString(userId);
		const adjIndex = hash % ADJECTIVES.length;
		const animalIndex = Math.floor(hash / ADJECTIVES.length) % ANIMALS.length;
		return `${ADJECTIVES[adjIndex]} ${ANIMALS[animalIndex]}`;
	}

	/**
	 * Generate unique display name, avoiding collisions with existing names
	 */
	generateUniqueDisplayName(userId: string, existingNames: string[]): string {
		const baseName = this.generateBaseName(userId);

		// If no collision, use base name
		if (!existingNames.includes(baseName)) {
			return baseName;
		}

		// Add suffix until unique
		let suffix = 2;
		let uniqueName = `${baseName} ${suffix}`;
		while (existingNames.includes(uniqueName)) {
			suffix++;
			uniqueName = `${baseName} ${suffix}`;
		}

		return uniqueName;
	}

	/**
	 * Register self as a participant in Y.js
	 * Should be called when joining a session
	 */
	registerParticipant(): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		const existingParticipants = (sessionMap.get("participants") as YjsParticipant[]) || [];

		// Check if already registered
		if (existingParticipants.some((p) => p.userId === this.userId)) {
			if (DEBUG) {
				console.log("[ParticipantManager] Already registered");
			}
			return;
		}

		// Get existing names for collision detection
		const existingNames = existingParticipants.map((p) => p.displayName);

		// Generate unique display name
		const displayName = this.generateUniqueDisplayName(this.userId, existingNames);
		this.localDisplayName = displayName;

		// Create participant entry
		const participant: YjsParticipant = {
			userId: this.userId,
			displayName,
			joinedAt: Date.now(),
			color: this.localColor,
		};

		// Add to participants array
		this.yjsProvider.getDoc().transact(() => {
			const updatedParticipants = [...existingParticipants, participant];
			sessionMap.set("participants", updatedParticipants);
		});

		if (DEBUG) {
			console.log("[ParticipantManager] Registered as:", displayName);
		}
	}

	/**
	 * Unregister self from participants (on leave)
	 */
	unregisterParticipant(): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		const existingParticipants = (sessionMap.get("participants") as YjsParticipant[]) || [];

		const updatedParticipants = existingParticipants.filter((p) => p.userId !== this.userId);

		if (updatedParticipants.length !== existingParticipants.length) {
			sessionMap.set("participants", updatedParticipants);

			if (DEBUG) {
				console.log("[ParticipantManager] Unregistered self");
			}
		}
	}

	/**
	 * Get all participants sorted by joinedAt
	 */
	getParticipants(): YjsParticipant[] {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		const participants = (sessionMap.get("participants") as YjsParticipant[]) || [];

		// Sort by joinedAt (first joined first)
		return [...participants].sort((a, b) => a.joinedAt - b.joinedAt);
	}

	/**
	 * Get participant count
	 */
	getParticipantCount(): number {
		return this.getParticipants().length;
	}

	/**
	 * Get local user's display name
	 */
	getLocalDisplayName(): string | null {
		return this.localDisplayName;
	}

	/**
	 * Set local user's display name (without writing to Y.js)
	 * Used when display name is already set in a transaction
	 */
	setLocalDisplayName(displayName: string): void {
		this.localDisplayName = displayName;

		if (DEBUG) {
			console.log("[ParticipantManager] Set local display name:", displayName);
		}
	}

	/**
	 * Get local user's color
	 */
	getLocalColor(): string {
		return this.localColor;
	}

	/**
	 * Set local awareness state (for real-time presence)
	 */
	setLocalAwarenessState(additionalState?: Record<string, any>): void {
		const awareness = this.yjsProvider.getAwareness();
		awareness.setLocalState({
			userId: this.userId,
			displayName: this.localDisplayName,
			color: this.localColor,
			...additionalState,
		});

		if (DEBUG) {
			console.log("[ParticipantManager] Set local awareness state");
		}
	}

	/**
	 * Register callback for participant changes
	 */
	onParticipantsChanged(callback: (participants: YjsParticipant[]) => void): void {
		this.participantChangedCallbacks.push(callback);
	}

	/**
	 * Notify all participant changed callbacks
	 */
	private notifyParticipantsChanged(participants: YjsParticipant[]): void {
		for (const callback of this.participantChangedCallbacks) {
			callback(participants);
		}
	}

	/**
	 * Destroy and cleanup
	 */
	destroy(): void {
		this.participantChangedCallbacks = [];
		this.sessionId = null;
		this.localDisplayName = null;

		if (DEBUG) {
			console.log("[ParticipantManager] Destroyed");
		}
	}
}
