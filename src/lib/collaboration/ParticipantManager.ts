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
// Short adjectives (<10 chars) - literary, sci-fi, and industrial themes
const ADJECTIVES = [
	// Short literary/sci-fi (kept from original)
	"Ethereal", // Romantic (8 chars)
	"Mercurial", // Shakespeare (9 chars)
	"Gossamer", // Romantic (8 chars)
	"Mordant", // Dostoevsky (7 chars)
	"Quixotic", // Cervantes (8 chars)
	"Prescient", // Dune (9 chars)
	"Grokking", // Stranger in a Strange Land (8 chars)
	"Ansible", // Ursula K. Le Guin (7 chars)
	"Hyperion", // Dan Simmons (8 chars)
	"Solarian", // Asimov's Foundation (8 chars)
	"Bene", // Dune - Bene Gesserit (4 chars)
	// Industrial adjectives
	"Rusted", // Industrial (6 chars)
	"Galvanized", // Industrial (10 chars - at limit)
	"Forged", // Industrial (6 chars)
	"Welded", // Industrial (6 chars)
	"Machined", // Industrial (8 chars)
	"Tempered", // Industrial (8 chars)
	"Annealed", // Industrial (8 chars)
	"Polished", // Industrial (8 chars)
	"Brushed", // Industrial (7 chars)
	"Milled", // Industrial (6 chars)
	"Lathed", // Industrial (6 chars)
	"Threaded", // Industrial (8 chars)
	"Riveted", // Industrial (7 chars)
	"Bolted", // Industrial (6 chars)
	"Stamped", // Industrial (7 chars)
	"Cast", // Industrial (4 chars)
	"Wrought", // Industrial (7 chars)
];

// Extinct animals, sci-fi creatures, and industrial objects for anonymous user names
const ANIMALS = [
	// Short extinct animals (kept from original)
	"Dodo", // Mauritius, extinct 1681 (4 chars)
	"Mammoth", // Ice Age megafauna (7 chars)
	"Thylacine", // Tasmanian Tiger, extinct 1936 (9 chars)
	"Quagga", // South African zebra, extinct 1883 (6 chars)
	"Aurochs", // Wild cattle ancestor, extinct 1627 (7 chars)
	"Moa", // Giant New Zealand bird (3 chars)
	"Glyptodon", // Armored mammal (9 chars)
	"Smilodon", // Saber-toothed cat (8 chars)
	"Trilobite", // Ancient arthropod (9 chars)
	"Megalodon", // Giant shark (9 chars)
	// Short sci-fi creatures (kept from original)
	"Sandworm", // Dune - Shai-Hulud (8 chars)
	"Thumper", // Dune - worm caller (7 chars)
	"Stilgar", // Dune - Fremen leader (7 chars)
	"Thranx", // Alan Dean Foster's insectoid aliens (6 chars)
	"Tribble", // Star Trek (7 chars)
	"Sarlacc", // Star Wars (7 chars)
	"Xenomorph", // Alien (9 chars)
	"Replicant", // Blade Runner (9 chars)
	"Bugger", // Ender's Game (Formics) (6 chars)
	"Tarka", // Ring of Bright Water (5 chars)
	"Hrududu", // Watership Down - rabbit word for car/machine (7 chars)
	// Industrial objects
	"Bolt", // Industrial (4 chars)
	"Washer", // Industrial (6 chars)
	"Wrench", // Industrial (6 chars)
	"Rivet", // Industrial (5 chars)
	"Gear", // Industrial (4 chars)
	"Bearing", // Industrial (7 chars)
	"Piston", // Industrial (6 chars)
	"Valve", // Industrial (5 chars)
	"Gasket", // Industrial (6 chars)
	"Sprocket", // Industrial (8 chars)
	"Clutch", // Industrial (6 chars)
	"Axle", // Industrial (4 chars)
	"Shaft", // Industrial (5 chars)
	"Flange", // Industrial (6 chars)
	"Bushing", // Industrial (7 chars)
	"Coupling", // Industrial (8 chars)
	"Bracket", // Industrial (7 chars)
	"Clamp", // Industrial (5 chars)
];

// Heartbeat interval for participant liveness (milliseconds)
const PARTICIPANT_HEARTBEAT_INTERVAL = 5000; // 5 seconds

// Grace period before considering a participant stale (milliseconds)
const PARTICIPANT_STALE_THRESHOLD = 15000; // 15 seconds

export class ParticipantManager {
	private yjsProvider: YjsProvider;
	private userId: string;
	private localDisplayName: string | null = null;
	private localColor: string;
	private participantChangedCallbacks: Array<(participants: YjsParticipant[]) => void> = [];
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	constructor(yjsProvider: YjsProvider, userId: string) {
		this.yjsProvider = yjsProvider;
		this.userId = userId;
		this.localColor = this.getUserColor(userId);
	}

	/**
	 * Initialize participant manager for a session
	 */
	initialize(_sessionId: string): void {
		this.setupParticipantObserver();
		this.startHeartbeat();
		this.startStaleCleanup();
	}

	/**
	 * Start heartbeat to update lastSeen timestamp
	 */
	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatInterval = setInterval(() => {
			this.updateLastSeen();
		}, PARTICIPANT_HEARTBEAT_INTERVAL);
	}

	/**
	 * Stop heartbeat
	 */
	private stopHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	/**
	 * Update lastSeen timestamp for this participant
	 */
	private updateLastSeen(): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		const participants = (sessionMap.get("participants") as YjsParticipant[]) || [];

		const updatedParticipants = participants.map((p) => {
			if (p.userId === this.userId) {
				return { ...p, lastSeen: Date.now() };
			}
			return p;
		});

		// Only update if we found ourselves
		if (updatedParticipants.some((p) => p.userId === this.userId)) {
			sessionMap.set("participants", updatedParticipants);
		}
	}

	/**
	 * Start periodic cleanup of stale participants
	 */
	private startStaleCleanup(): void {
		this.stopStaleCleanup();
		this.cleanupInterval = setInterval(() => {
			this.cleanupStaleParticipants();
		}, PARTICIPANT_HEARTBEAT_INTERVAL); // Same interval as heartbeat
	}

	/**
	 * Stop stale cleanup
	 */
	private stopStaleCleanup(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
	}

	/**
	 * Remove participants whose lastSeen is older than threshold
	 */
	private cleanupStaleParticipants(): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		const participants = (sessionMap.get("participants") as YjsParticipant[]) || [];
		const now = Date.now();

		const activeParticipants = participants.filter((p) => {
			// Don't remove self
			if (p.userId === this.userId) return true;

			// Check if stale
			const elapsed = now - (p.lastSeen || p.joinedAt);
			if (elapsed > PARTICIPANT_STALE_THRESHOLD) {
				return false;
			}
			return true;
		});

		if (activeParticipants.length !== participants.length) {
			sessionMap.set("participants", activeParticipants);
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
			return;
		}

		// Get existing names for collision detection
		const existingNames = existingParticipants.map((p) => p.displayName);

		// Generate unique display name
		const displayName = this.generateUniqueDisplayName(this.userId, existingNames);
		this.localDisplayName = displayName;

		// Create participant entry
		const now = Date.now();
		const participant: YjsParticipant = {
			userId: this.userId,
			displayName,
			joinedAt: now,
			lastSeen: now,
			color: this.localColor,
		};

		// Add to participants array
		this.yjsProvider.getDoc().transact(() => {
			const updatedParticipants = [...existingParticipants, participant];
			sessionMap.set("participants", updatedParticipants);
		});
	}

	/**
	 * Re-register existing participant (for host reclaim after refresh)
	 * Finds existing participant entry and updates local state without Y.js write
	 */
	reregisterExistingParticipant(): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		const existingParticipants = (sessionMap.get("participants") as YjsParticipant[]) || [];

		// Find our existing entry
		const existing = existingParticipants.find((p) => p.userId === this.userId);
		if (existing) {
			this.localDisplayName = existing.displayName;
		} else {
			// Fallback: register as new if not found (shouldn't happen for host reclaim)
			this.registerParticipant();
		}
	}

	/**
	 * Unregister self from participants (on leave)
	 */
	unregisterParticipant(): void {
		this.removeParticipant(this.userId);
	}

	/**
	 * Remove a participant by userId (when they disconnect)
	 */
	removeParticipant(userId: string): void {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		const existingParticipants = (sessionMap.get("participants") as YjsParticipant[]) || [];

		const updatedParticipants = existingParticipants.filter((p) => p.userId !== userId);

		if (updatedParticipants.length !== existingParticipants.length) {
			sessionMap.set("participants", updatedParticipants);
		}
	}

	/**
	 * Get all participants sorted by userId for deterministic ordering
	 * Used for auto-promotion: lowest userId becomes host when host leaves
	 */
	getParticipants(): YjsParticipant[] {
		const sessionMap = this.yjsProvider.getMap<any>("session");
		const participants = (sessionMap.get("participants") as YjsParticipant[]) || [];

		// Sort by userId for deterministic ordering (consistent across all clients)
		return [...participants].sort((a, b) => a.userId.localeCompare(b.userId));
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
		this.stopHeartbeat();
		this.stopStaleCleanup();
		this.participantChangedCallbacks = [];
		this.localDisplayName = null;
	}
}
