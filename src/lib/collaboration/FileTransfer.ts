/**
 * FileTransfer - Handles file upload/download via HTTP server
 *
 * Responsibilities:
 * - Upload files to server via HTTP
 * - Download files from server via HTTP
 * - Store file metadata in Y.js for sync
 * - Compute and validate SHA-256 hashes
 * - Track transfer progress
 */

import type * as Y from "yjs";
import { DEBUG } from "../config";
import { computeSHA256 } from "../utils/hash";
import type { CollaborationEvent, SessionMetadata } from "./types";

export interface FileTransferProgress {
	bytesReceived: number;
	totalBytes: number;
	percentage: number;
}

export class FileTransfer {
	private ydoc: Y.Doc;
	private onProgress?: (progress: number, message: string) => void;
	private onEvent?: (event: CollaborationEvent) => void;

	constructor(
		ydoc: Y.Doc,
		onProgress?: (progress: number, message: string) => void,
		onEvent?: (event: CollaborationEvent) => void,
	) {
		this.ydoc = ydoc;
		this.onProgress = onProgress;
		this.onEvent = onEvent;
	}

	/**
	 * Upload a file to the server (host side)
	 * Uploads file via HTTP and stores metadata in Y.js for sync to peers
	 */
	async uploadFile(arrayBuffer: ArrayBuffer, fileName: string, userId: string): Promise<void> {
		const startTime = performance.now();
		const fileSizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(1);

		if (DEBUG) {
			console.log(`[FileTransfer] Uploading file: ${fileName} (${fileSizeMB} MB)`);
		}

		this.onProgress?.(0, "Computing file hash...");

		// Compute SHA-256 hash asynchronously
		const fileHash = await computeSHA256(arrayBuffer);

		if (DEBUG) {
			console.log(`[FileTransfer] File hash: ${fileHash}`);
		}

		this.onProgress?.(20, "Uploading file to server...");

		// Upload file to server
		const fileServerUrl = import.meta.env.VITE_FILE_SERVER_URL || "https://signaling.gdsjam.com";
		const fileServerToken = import.meta.env.VITE_FILE_SERVER_TOKEN;

		const formData = new FormData();
		formData.append("file", new Blob([arrayBuffer]));
		formData.append("fileHash", fileHash);

		const response = await fetch(`${fileServerUrl}/api/files/upload`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${fileServerToken}`,
			},
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`File upload failed: ${response.status} ${response.statusText}`);
		}

		const { fileId } = await response.json();

		if (DEBUG) {
			console.log(`[FileTransfer] File uploaded to server with ID: ${fileId}`);
		}

		this.onProgress?.(80, "Storing metadata in session...");

		// Store metadata in Y.js (single transaction)
		this.ydoc.transact(() => {
			const sessionMap = this.ydoc.getMap<any>("session");
			sessionMap.set("fileId", fileId);
			sessionMap.set("fileName", fileName);
			sessionMap.set("fileSize", arrayBuffer.byteLength);
			sessionMap.set("fileHash", fileHash);
			sessionMap.set("uploadedBy", userId);
			sessionMap.set("uploadedAt", Date.now());
		});

		if (DEBUG) {
			console.log(`[FileTransfer] Y.js document state after upload:`);
			console.log(`  - Session map:`, this.ydoc.getMap("session").toJSON());
		}

		const elapsed = performance.now() - startTime;
		if (DEBUG) {
			console.log(`[FileTransfer] Upload complete in ${elapsed.toFixed(0)}ms`);
		}

		this.onProgress?.(100, "File uploaded successfully");
		this.onEvent?.({
			type: "file-transfer-complete",
		});
	}

	/**
	 * Download file from server (peer side)
	 * Downloads file via HTTP using fileId from Y.js metadata
	 */
	async downloadFile(): Promise<{ arrayBuffer: ArrayBuffer; fileName: string; fileHash: string }> {
		if (DEBUG) {
			console.log("[FileTransfer] Starting file download...");
		}

		// Get session metadata
		const sessionMap = this.ydoc.getMap<any>("session");
		const fileId = sessionMap.get("fileId") as string;
		const fileName = sessionMap.get("fileName") as string;
		const expectedHash = sessionMap.get("fileHash") as string;

		if (!fileId || !fileName || !expectedHash) {
			throw new Error("Session metadata incomplete - file not uploaded yet");
		}

		this.onProgress?.(0, "Downloading file from server...");

		// Download file from server with retry logic
		const fileServerUrl = import.meta.env.VITE_FILE_SERVER_URL || "https://signaling.gdsjam.com";
		const fileServerToken = import.meta.env.VITE_FILE_SERVER_TOKEN;

		const arrayBuffer = await this.downloadWithRetry(
			`${fileServerUrl}/api/files/${fileId}`,
			fileServerToken,
			3,
		);

		this.onProgress?.(80, "Validating file hash...");

		// Validate hash
		const actualHash = await computeSHA256(arrayBuffer);

		if (actualHash !== expectedHash) {
			throw new Error(
				`File hash mismatch! Expected ${expectedHash.substring(0, 16)}..., got ${actualHash.substring(0, 16)}...`,
			);
		}

		if (DEBUG) {
			console.log("[FileTransfer] File hash validated successfully");
		}

		this.onProgress?.(100, "File downloaded successfully");
		this.onEvent?.({
			type: "file-transfer-complete",
		});

		return {
			arrayBuffer,
			fileName,
			fileHash: actualHash,
		};
	}

	/**
	 * Download file from server with retry logic
	 */
	private async downloadWithRetry(
		url: string,
		token: string | undefined,
		maxRetries = 3,
	): Promise<ArrayBuffer> {
		for (let i = 0; i < maxRetries; i++) {
			try {
				const response = await fetch(url, {
					headers: {
						Authorization: `Bearer ${token}`,
					},
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}

				return await response.arrayBuffer();
			} catch (error) {
				if (i === maxRetries - 1) {
					throw error;
				}

				// Exponential backoff
				const delay = 1000 * 2 ** i;
				if (DEBUG) {
					console.log(`[FileTransfer] Download failed, retrying in ${delay}ms...`, error);
				}
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		throw new Error("Download failed after retries");
	}

	/**
	 * Get current transfer progress
	 */
	getProgress(): FileTransferProgress | null {
		const sessionMap = this.ydoc.getMap<any>("session");
		const fileSize = sessionMap.get("fileSize") as number;

		if (!fileSize) {
			return null;
		}

		// For HTTP-based transfer, we don't track intermediate progress
		// Progress is reported via callbacks during upload/download
		return {
			bytesReceived: 0,
			totalBytes: fileSize,
			percentage: 0,
		};
	}

	/**
	 * Check if a file is available in the session
	 */
	isFileAvailable(): boolean {
		const sessionMap = this.ydoc.getMap<any>("session");
		return sessionMap.has("fileId");
	}

	/**
	 * Get file metadata from session
	 */
	getFileMetadata(): Partial<SessionMetadata> | null {
		const sessionMap = this.ydoc.getMap<any>("session");

		if (!this.isFileAvailable()) {
			return null;
		}

		return {
			fileName: sessionMap.get("fileName"),
			fileSize: sessionMap.get("fileSize"),
			fileHash: sessionMap.get("fileHash"),
			uploadedBy: sessionMap.get("uploadedBy"),
			uploadedAt: sessionMap.get("uploadedAt"),
		};
	}
}
