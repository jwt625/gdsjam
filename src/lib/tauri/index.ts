/**
 * Tauri Desktop Integration
 *
 * This module provides utilities for integrating with Tauri desktop features.
 * All functions gracefully degrade when running in web mode.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Check if the app is running in Tauri (desktop mode)
 */
export function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Open a file dialog and return the selected file path
 * Returns null if no file was selected or if running in web mode
 */
export async function openFileDialog(): Promise<string | null> {
	if (!isTauri()) {
		return null;
	}

	try {
		const result = await invoke<string | null>("open_file_dialog");
		return result;
	} catch (error) {
		console.error("[Tauri] Failed to open file dialog:", error);
		return null;
	}
}

/**
 * Start watching a file for changes
 * @param path - The file path to watch
 * @param onChange - Callback function to call when the file changes
 * @param onError - Optional callback function to call when a watch error occurs
 * @returns A function to stop watching the file
 */
export async function watchFile(
	path: string,
	onChange: () => void,
	onError?: (error: string) => void,
): Promise<() => void> {
	if (!isTauri()) {
		return () => {}; // No-op unwatch function
	}

	try {
		// Start watching the file
		await invoke("watch_file", { path });

		// Listen for file change events
		const unlistenChange = await listen("file-changed", () => {
			onChange();
		});

		// Listen for file watch error events
		const unlistenError = await listen<string>("file-watch-error", (event) => {
			console.error("[Tauri] File watch error:", event.payload);
			if (onError) {
				onError(event.payload);
			}
		});

		// Return a function to stop watching
		return async () => {
			unlistenChange();
			unlistenError();
			await invoke("unwatch_file");
		};
	} catch (error) {
		console.error("[Tauri] Failed to watch file:", error);
		return () => {}; // No-op unwatch function
	}
}

/**
 * Get the last opened file path from app data
 */
export async function getLastFilePath(): Promise<string | null> {
	if (!isTauri()) {
		return null;
	}

	try {
		const result = await invoke<string | null>("get_last_file_path");
		return result;
	} catch (error) {
		console.error("[Tauri] Failed to get last file path:", error);
		return null;
	}
}

/**
 * Save the last opened file path to app data
 */
export async function saveLastFilePath(path: string): Promise<void> {
	if (!isTauri()) {
		return;
	}

	try {
		await invoke("save_last_file_path", { path });
	} catch (error) {
		console.error("[Tauri] Failed to save last file path:", error);
	}
}

/**
 * Read a file from the file system
 * @param path - The file path to read
 * @returns The file content as ArrayBuffer
 */
export async function readFile(path: string): Promise<ArrayBuffer> {
	if (!isTauri()) {
		throw new Error("File reading is only available in desktop mode");
	}

	try {
		const { readFile } = await import("@tauri-apps/plugin-fs");
		const contents = await readFile(path);
		return contents.buffer;
	} catch (error) {
		console.error("[Tauri] Failed to read file:", error);
		throw error;
	}
}
