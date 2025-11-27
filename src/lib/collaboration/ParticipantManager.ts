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
// Literary adjectives from Shakespeare, Borges, Dostoevsky, classic sci-fi, and other authors
const ADJECTIVES = [
	"Eldritch", // Lovecraftian/Gothic
	"Melancholy", // Dostoevsky
	"Quixotic", // Cervantes
	"Ineffable", // Borges
	"Erstwhile", // Shakespearean
	"Penumbral", // Borges
	"Woebegone", // Gothic
	"Mercurial", // Shakespeare
	"Labyrinthine", // Borges
	"Forsooth", // Shakespearean
	"Ethereal", // Romantic
	"Phantasmal", // Poe
	"Tempestuous", // Shakespeare
	"Vertiginous", // Borges
	"Mordant", // Dostoevsky
	"Lachrymose", // Victorian
	"Phosphorescent", // Nabokov
	"Sibylline", // Classical
	"Crepuscular", // Borges
	"Gossamer", // Romantic
	// Classic Sci-Fi
	"Prescient", // Dune - the spice grants prescience
	"Grokking", // Stranger in a Strange Land
	"Ansible", // Ursula K. Le Guin
	"Hyperion", // Dan Simmons
	"Solarian", // Asimov's Foundation
	"Neuromantic", // William Gibson
	"Bene", // Dune - Bene Gesserit
	"Muaddib", // Dune - Paul's Fremen name
];

// Extinct and fictional sci-fi animals for anonymous user names
const ANIMALS = [
	// Extinct
	"Dodo", // Mauritius, extinct 1681
	"Mammoth", // Ice Age megafauna
	"Thylacine", // Tasmanian Tiger, extinct 1936
	"Quagga", // South African zebra, extinct 1883
	"Aurochs", // Wild cattle ancestor, extinct 1627
	"Moa", // Giant New Zealand bird
	"Glyptodon", // Armored mammal
	"Megatherium", // Giant ground sloth
	"Smilodon", // Saber-toothed cat
	"Archaeopteryx", // First bird
	"Trilobite", // Ancient arthropod
	"Pteranodon", // Flying reptile
	"Megalodon", // Giant shark
	// Sci-Fi creatures
	"Sandworm", // Dune - Shai-Hulud
	"Thumper", // Dune - worm caller
	"Stilgar", // Dune - Fremen leader (honorary creature)
	"Thranx", // Alan Dean Foster's insectoid aliens
	"Tribble", // Star Trek
	"Sarlacc", // Star Wars
	"Xenomorph", // Alien
	"Replicant", // Blade Runner
	"Tralfamadorian", // Vonnegut
	"Bugger", // Ender's Game (Formics)
	"Tarka", // Ring of Bright Water / Watership Down era
	"Hrududu", // Watership Down - rabbit word for car/machine
];

// Heartbeat interval for participant liveness (milliseconds)
const PARTICIPANT_HEARTBEAT_INTERVAL = 5000; // 5 seconds

// Grace period before considering a participant stale (milliseconds)
const PARTICIPANT_STALE_THRESHOLD = 15000; // 15 seconds

export class ParticipantManager {
	private yjsProvider: YjsProvider;
	private userId: string;
	private sessionId: string | null = null;
	private localDisplayName: string | null = null;
	private localColor: string;
	private participantChangedCallbacks: Array<(participants: YjsParticipant[]) => void> = [];
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

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
		this.startHeartbeat();
		this.startStaleCleanup();

		if (DEBUG) {
			console.log("[ParticipantManager] Initialized for session:", sessionId);
		}
	}

	/**
	 * Start heartbeat to update lastSeen timestamp
	 */
	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatInterval = setInterval(() => {
			this.updateLastSeen();
		}, PARTICIPANT_HEARTBEAT_INTERVAL);

		if (DEBUG) {
			console.log("[ParticipantManager] Started heartbeat");
		}
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

		if (DEBUG) {
			console.log("[ParticipantManager] Started stale participant cleanup");
		}
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
				if (DEBUG) {
					console.log(
						"[ParticipantManager] Removing stale participant:",
						p.userId,
						"elapsed:",
						elapsed,
					);
				}
				return false;
			}
			return true;
		});

		if (activeParticipants.length !== participants.length) {
			sessionMap.set("participants", activeParticipants);
			if (DEBUG) {
				console.log(
					"[ParticipantManager] Cleaned up stale participants, remaining:",
					activeParticipants.length,
				);
			}
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

		if (DEBUG) {
			console.log("[ParticipantManager] Registered as:", displayName);
		}
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
			if (DEBUG) {
				console.log(
					"[ParticipantManager] Re-registered existing participant:",
					existing.displayName,
				);
			}
		} else {
			// Fallback: register as new if not found (shouldn't happen for host reclaim)
			if (DEBUG) {
				console.log("[ParticipantManager] Existing participant not found, registering as new");
			}
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

			if (DEBUG) {
				console.log("[ParticipantManager] Removed participant:", userId);
			}
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
		this.stopHeartbeat();
		this.stopStaleCleanup();
		this.participantChangedCallbacks = [];
		this.sessionId = null;
		this.localDisplayName = null;

		if (DEBUG) {
			console.log("[ParticipantManager] Destroyed");
		}
	}
}
