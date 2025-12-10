/**
 * KeyboardShortcutManager - Centralized keyboard shortcut handling
 *
 * This module consolidates all keyboard shortcuts in the application:
 * - Renderer shortcuts: Arrow keys (pan), Enter/Shift+Enter (zoom), F (fit), G (grid)
 * - Viewer shortcuts: P (panels), L (layers), M (minimap), O (fill/outline)
 * - App shortcuts: Ctrl/Cmd+O (open file)
 *
 * Features:
 * - Centralized registration of all shortcuts
 * - Consistent modifier key handling (Ctrl/Cmd, Shift, Alt)
 * - Context-aware shortcuts (only active when specific conditions are met)
 * - Proper cleanup when components unmount
 * - Single documentation source for all shortcuts
 */

/**
 * Modifier keys that can be combined with shortcuts
 */
export interface Modifiers {
	ctrl?: boolean; // Ctrl key (or Cmd on Mac)
	shift?: boolean;
	alt?: boolean;
}

/**
 * Context function that determines if a shortcut should be active
 * Returns true if the shortcut should be processed
 */
export type ShortcutContext = () => boolean;

/**
 * Callback function when shortcut is triggered
 */
export type ShortcutCallback = (event: KeyboardEvent) => void;

/**
 * Definition of a keyboard shortcut
 */
export interface ShortcutDefinition {
	/** Unique identifier for the shortcut */
	id: string;
	/** The key code (e.g., 'KeyF', 'ArrowUp', 'Enter') */
	key: string;
	/** Optional modifier keys */
	modifiers?: Modifiers;
	/** Optional context function - shortcut only fires when this returns true */
	context?: ShortcutContext;
	/** Callback when shortcut is triggered */
	callback: ShortcutCallback;
	/** Human-readable description for documentation */
	description: string;
	/** Whether to prevent default browser behavior */
	preventDefault?: boolean;
}

/**
 * Registered shortcut with owner tracking for cleanup
 */
interface RegisteredShortcut extends ShortcutDefinition {
	owner: string;
}

/**
 * Singleton manager for all keyboard shortcuts
 */
class KeyboardShortcutManagerClass {
	private shortcuts: Map<string, RegisteredShortcut> = new Map();
	private keyDownHandler: (e: KeyboardEvent) => void;
	private isInitialized = false;

	constructor() {
		this.keyDownHandler = this.handleKeyDown.bind(this);
	}

	/**
	 * Initialize the manager - must be called once at app startup
	 */
	init(): void {
		if (this.isInitialized) {
			return;
		}

		window.addEventListener("keydown", this.keyDownHandler);
		this.isInitialized = true;
	}

	/**
	 * Register a keyboard shortcut
	 * @param owner - Identifier for the component registering the shortcut (for cleanup)
	 * @param shortcut - The shortcut definition
	 */
	register(owner: string, shortcut: ShortcutDefinition): void {
		if (!this.isInitialized) {
			this.init();
		}

		const registered: RegisteredShortcut = { ...shortcut, owner };
		this.shortcuts.set(shortcut.id, registered);
	}

	/**
	 * Register multiple shortcuts at once
	 */
	registerMany(owner: string, shortcuts: ShortcutDefinition[]): void {
		for (const shortcut of shortcuts) {
			this.register(owner, shortcut);
		}
	}

	/**
	 * Unregister a specific shortcut by ID
	 */
	unregister(id: string): void {
		this.shortcuts.delete(id);
	}

	/**
	 * Unregister all shortcuts owned by a specific owner
	 * Use this when a component unmounts
	 */
	unregisterByOwner(owner: string): void {
		const toRemove: string[] = [];
		for (const [id, shortcut] of this.shortcuts) {
			if (shortcut.owner === owner) {
				toRemove.push(id);
			}
		}
		for (const id of toRemove) {
			this.shortcuts.delete(id);
		}
	}

	/**
	 * Handle keydown events
	 */
	private handleKeyDown(event: KeyboardEvent): void {
		// Don't handle shortcuts when typing in input fields
		const target = event.target as HTMLElement;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
			return;
		}

		for (const shortcut of this.shortcuts.values()) {
			if (this.matchesShortcut(event, shortcut)) {
				// Check context if provided
				if (shortcut.context && !shortcut.context()) {
					continue;
				}

				if (shortcut.preventDefault !== false) {
					event.preventDefault();
				}

				shortcut.callback(event);
				return; // Only one shortcut per key press
			}
		}
	}

	/**
	 * Check if a keyboard event matches a shortcut definition
	 */
	private matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
		// Check key match
		if (event.code !== shortcut.key) {
			return false;
		}

		// Check modifiers
		const mods = shortcut.modifiers || {};

		// Ctrl/Cmd check (use metaKey on Mac, ctrlKey on Windows/Linux)
		const ctrlOrCmd = event.ctrlKey || event.metaKey;
		if (mods.ctrl && !ctrlOrCmd) return false;
		if (!mods.ctrl && ctrlOrCmd) return false;

		// Shift check
		if (mods.shift && !event.shiftKey) return false;
		if (!mods.shift && event.shiftKey) return false;

		// Alt check
		if (mods.alt && !event.altKey) return false;
		if (!mods.alt && event.altKey) return false;

		return true;
	}

	/**
	 * Get all registered shortcuts (for documentation/help display)
	 */
	getAllShortcuts(): ShortcutDefinition[] {
		return Array.from(this.shortcuts.values());
	}

	/**
	 * Destroy the manager - remove all listeners
	 */
	destroy(): void {
		window.removeEventListener("keydown", this.keyDownHandler);
		this.shortcuts.clear();
		this.isInitialized = false;
	}
}

// Export singleton instance
export const KeyboardShortcutManager = new KeyboardShortcutManagerClass();
