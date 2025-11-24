/**
 * FileTransfer - Handles file chunking and transfer via Y.js
 *
 * Responsibilities:
 * - Chunk files into 1MB pieces for transfer
 * - Store chunks in Y.js Array for automatic sync
 * - Reassemble chunks on receiving end
 * - Compute and validate SHA-256 hashes
 * - Track transfer progress
 */

import type * as Y from "yjs";
import { DEBUG } from "../config";
import { computeSHA256 } from "../utils/hash";
import type { CollaborationEvent, FileChunk, SessionMetadata } from "./types";

// Chunk size: 1MB (balance between transfer efficiency and memory usage)
const CHUNK_SIZE = 1024 * 1024; // 1MB

export interface FileTransferProgress {
	chunksReceived: number;
	totalChunks: number;
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
	 * Upload a file to the session (host side)
	 * Chunks the file and stores it in Y.js for automatic sync to peers
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

		this.onProgress?.(10, "Chunking file...");

		// Chunk the file
		const chunks = this.chunkFile(arrayBuffer);
		const totalChunks = chunks.length;

		if (DEBUG) {
			console.log(`[FileTransfer] Created ${totalChunks} chunks`);
		}

		// Store session metadata
		const sessionMap = this.ydoc.getMap<any>("session");
		sessionMap.set("fileHash", fileHash);
		sessionMap.set("fileName", fileName);
		sessionMap.set("fileSize", arrayBuffer.byteLength);
		sessionMap.set("uploadedBy", userId);
		sessionMap.set("uploadedAt", Date.now());

		this.onProgress?.(20, "Uploading chunks to session...");

		// Store chunks in Y.js Array
		// Y.js will automatically sync these to all connected peers
		const chunksArray = this.ydoc.getArray<Uint8Array>("fileChunks");
		chunksArray.delete(0, chunksArray.length); // Clear any existing chunks

		// Add chunks one by one with progress updates
		for (let i = 0; i < chunks.length; i++) {
			chunksArray.push([chunks[i]]);

			// Update progress every 10 chunks or on last chunk
			if (i % 10 === 0 || i === chunks.length - 1) {
				const progress = 20 + Math.floor(((i + 1) / chunks.length) * 80);
				this.onProgress?.(progress, `Uploading chunks... ${i + 1}/${chunks.length}`);
			}
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
	 * Download file from session (peer side)
	 * Waits for all chunks to be synced, then reassembles the file
	 */
	async downloadFile(): Promise<{ arrayBuffer: ArrayBuffer; fileName: string; fileHash: string }> {
		if (DEBUG) {
			console.log("[FileTransfer] Starting file download...");
		}

		// Get session metadata
		const sessionMap = this.ydoc.getMap<any>("session");
		const fileName = sessionMap.get("fileName") as string;
		const fileSize = sessionMap.get("fileSize") as number;
		const expectedHash = sessionMap.get("fileHash") as string;

		if (!fileName || !fileSize || !expectedHash) {
			throw new Error("Session metadata incomplete - file not uploaded yet");
		}

		this.onProgress?.(0, "Waiting for file chunks...");

		// Wait for all chunks to be available
		const chunksArray = this.ydoc.getArray<Uint8Array>("fileChunks");
		const expectedChunks = Math.ceil(fileSize / CHUNK_SIZE);

		if (DEBUG) {
			console.log(
				`[FileTransfer] Expecting ${expectedChunks} chunks (${(fileSize / 1024 / 1024).toFixed(1)} MB)`,
			);
		}

		// Wait for chunks to sync (with timeout)
		await this.waitForChunks(chunksArray, expectedChunks);

		this.onProgress?.(50, "Reassembling file...");

		// Reassemble chunks into ArrayBuffer
		const arrayBuffer = this.reassembleChunks(chunksArray, fileSize);

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
	 * Chunk a file into fixed-size pieces
	 */
	private chunkFile(arrayBuffer: ArrayBuffer): Uint8Array[] {
		const chunks: Uint8Array[] = [];
		const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);

		for (let i = 0; i < totalChunks; i++) {
			const start = i * CHUNK_SIZE;
			const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
			const chunk = new Uint8Array(arrayBuffer.slice(start, end));
			chunks.push(chunk);
		}

		return chunks;
	}

	/**
	 * Reassemble chunks into a single ArrayBuffer
	 */
	private reassembleChunks(chunksArray: Y.Array<Uint8Array>, totalSize: number): ArrayBuffer {
		const result = new Uint8Array(totalSize);
		let offset = 0;

		for (let i = 0; i < chunksArray.length; i++) {
			const chunk = chunksArray.get(i);
			if (!chunk) {
				throw new Error(`Missing chunk at index ${i}`);
			}
			result.set(chunk, offset);
			offset += chunk.length;
		}

		if (DEBUG) {
			console.log(
				`[FileTransfer] Reassembled ${chunksArray.length} chunks into ${totalSize} bytes`,
			);
		}

		return result.buffer;
	}

	/**
	 * Wait for all chunks to be synced from peers
	 * Polls the Y.js array until all chunks are available
	 */
	private async waitForChunks(
		chunksArray: Y.Array<Uint8Array>,
		expectedChunks: number,
	): Promise<void> {
		const maxWaitTime = 300000; // 5 minutes timeout
		const pollInterval = 100; // Check every 100ms
		const startTime = Date.now();

		return new Promise((resolve, reject) => {
			const checkChunks = () => {
				const currentChunks = chunksArray.length;

				// Update progress
				if (expectedChunks > 0) {
					const progress = Math.floor((currentChunks / expectedChunks) * 50);
					const sizeMB = ((currentChunks * CHUNK_SIZE) / 1024 / 1024).toFixed(1);
					this.onProgress?.(
						progress,
						`Downloading chunks... ${currentChunks}/${expectedChunks} (${sizeMB} MB)`,
					);

					this.onEvent?.({
						type: "file-transfer-progress",
						progress,
						message: `${currentChunks}/${expectedChunks} chunks`,
					});
				}

				// Check if all chunks received
				if (currentChunks >= expectedChunks) {
					if (DEBUG) {
						console.log(`[FileTransfer] All ${expectedChunks} chunks received`);
					}
					resolve();
					return;
				}

				// Check timeout
				if (Date.now() - startTime > maxWaitTime) {
					reject(
						new Error(
							`File transfer timeout: Only received ${currentChunks}/${expectedChunks} chunks`,
						),
					);
					return;
				}

				// Continue polling
				setTimeout(checkChunks, pollInterval);
			};

			// Start polling
			checkChunks();
		});
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

		const chunksArray = this.ydoc.getArray<Uint8Array>("fileChunks");
		const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
		const chunksReceived = chunksArray.length;
		const bytesReceived = chunksReceived * CHUNK_SIZE;

		return {
			chunksReceived,
			totalChunks,
			bytesReceived: Math.min(bytesReceived, fileSize),
			totalBytes: fileSize,
			percentage: Math.floor((chunksReceived / totalChunks) * 100),
		};
	}

	/**
	 * Check if a file is available in the session
	 */
	isFileAvailable(): boolean {
		const sessionMap = this.ydoc.getMap<any>("session");
		return !!(
			sessionMap.get("fileName") &&
			sessionMap.get("fileSize") &&
			sessionMap.get("fileHash")
		);
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
