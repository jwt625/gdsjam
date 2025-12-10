/**
 * Example Loader - Load example GDS files with support for gzip compression
 */

import { inflate } from "pako";
import { loadGDSIIFromBuffer } from "../utils/gdsLoader";
import type { Example } from "./types";

// ============================================
// Constants
// ============================================

/** Maximum allowed file size in bytes (50 MB) */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Progress tracking ranges */
const PROGRESS = {
	START: 5,
	DOWNLOAD_END: 70,
	DECOMPRESS: 75,
	LOAD: 80,
} as const;

/** Valid content types for GDS files */
const VALID_CONTENT_TYPES = [
	"application/octet-stream",
	"application/gzip",
	"application/x-gzip",
	"binary/octet-stream",
	// Some servers may return these
	"application/x-binary",
	"",
] as const;

// ============================================
// Custom Errors
// ============================================

/** Base error for example loading failures */
export class ExampleLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExampleLoadError";
	}
}

/** Error during file fetching */
export class FetchError extends ExampleLoadError {
	constructor(message: string) {
		super(message);
		this.name = "FetchError";
	}
}

/** Error during decompression */
export class DecompressionError extends ExampleLoadError {
	constructor(message: string) {
		super(message);
		this.name = "DecompressionError";
	}
}

/** Error for file validation failures */
export class ValidationError extends ExampleLoadError {
	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}

// ============================================
// Helpers
// ============================================

/**
 * Decompress gzipped data
 */
function decompressGzip(compressedData: ArrayBuffer): ArrayBuffer {
	try {
		const decompressed = inflate(new Uint8Array(compressedData));
		return decompressed.buffer;
	} catch (error) {
		throw new DecompressionError(
			`Failed to decompress gzip data: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Validate response content type
 */
function validateContentType(contentType: string | null): void {
	if (!contentType) {
		// Some servers don't send content-type, allow it
		return;
	}

	const normalizedType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

	// Check if it's a valid binary type
	const isValid = VALID_CONTENT_TYPES.some(
		(valid) => normalizedType === valid || normalizedType.startsWith("application/"),
	);

	if (!isValid && normalizedType.startsWith("text/html")) {
		throw new ValidationError(
			"Received HTML instead of GDS file. The file URL may be incorrect or the server returned an error page.",
		);
	}
}

/**
 * Validate file size from content-length header
 */
function validateFileSize(contentLength: string | null): void {
	if (!contentLength) {
		return; // Can't validate without content-length
	}

	const size = Number.parseInt(contentLength, 10);
	if (size > MAX_FILE_SIZE_BYTES) {
		const sizeMB = (size / 1024 / 1024).toFixed(1);
		const maxMB = (MAX_FILE_SIZE_BYTES / 1024 / 1024).toFixed(0);
		throw new ValidationError(`File too large: ${sizeMB} MB (maximum: ${maxMB} MB)`);
	}
}

/**
 * Result of loading an example file
 */
export interface LoadExampleResult {
	arrayBuffer: ArrayBuffer;
	fileName: string;
}

/**
 * Load an example GDS file
 *
 * @param example - The example to load
 * @param onProgress - Optional progress callback
 * @returns The loaded file's ArrayBuffer and fileName for collaboration sync
 */
export async function loadExample(
	example: Example,
	onProgress?: (progress: number, message: string) => void,
): Promise<LoadExampleResult> {
	onProgress?.(PROGRESS.START, `Fetching ${example.name}...`);

	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

	try {
		// Fetch the file
		const response = await fetch(example.url, {
			method: "GET",
			mode: "cors",
			cache: "default",
		});

		if (!response.ok) {
			throw new FetchError(`HTTP error! status: ${response.status} ${response.statusText}`);
		}

		// Validate content type
		const contentType = response.headers.get("content-type");
		validateContentType(contentType);

		// Get and validate content length
		const contentLength = response.headers.get("content-length");
		validateFileSize(contentLength);

		const totalBytes = contentLength ? Number.parseInt(contentLength, 10) : 0;

		// Read the response body with progress tracking
		reader = response.body?.getReader();
		if (!reader) {
			throw new FetchError("Failed to get response reader");
		}

		const chunks: Uint8Array[] = [];
		let receivedBytes = 0;

		try {
			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				chunks.push(value);
				receivedBytes += value.length;

				// Check size limit during download (in case content-length was missing/wrong)
				if (receivedBytes > MAX_FILE_SIZE_BYTES) {
					throw new ValidationError(
						`File too large: exceeded ${(MAX_FILE_SIZE_BYTES / 1024 / 1024).toFixed(0)} MB limit`,
					);
				}

				// Update progress (START% to DOWNLOAD_END% range for download)
				if (totalBytes > 0) {
					const downloadRange = PROGRESS.DOWNLOAD_END - PROGRESS.START;
					const downloadProgress =
						PROGRESS.START + Math.floor((receivedBytes / totalBytes) * downloadRange);
					onProgress?.(
						downloadProgress,
						`Downloading... ${(receivedBytes / 1024 / 1024).toFixed(2)} MB`,
					);
				} else {
					onProgress?.(35, `Downloading... ${(receivedBytes / 1024 / 1024).toFixed(2)} MB`);
				}
			}
		} finally {
			// Always release the reader lock
			reader.releaseLock();
		}

		// Combine chunks into a single ArrayBuffer
		const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
		const combinedArray = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			combinedArray.set(chunk, offset);
			offset += chunk.length;
		}

		let arrayBuffer: ArrayBuffer = combinedArray.buffer;
		let fileName = example.name.replace(/\s+/g, "_");

		// Decompress if needed
		if (example.isCompressed) {
			onProgress?.(PROGRESS.DECOMPRESS, "Decompressing...");
			arrayBuffer = decompressGzip(arrayBuffer);
			fileName = fileName.replace(/\.gz$/, "");
		}

		// Ensure filename has .gds extension
		if (!fileName.toLowerCase().endsWith(".gds")) {
			fileName = `${fileName}.gds`;
		}

		onProgress?.(PROGRESS.LOAD, "Loading GDS file...");

		// Load the file using the shared loader
		await loadGDSIIFromBuffer(arrayBuffer, fileName);

		// Return the buffer and filename for collaboration sync
		return { arrayBuffer, fileName };
	} catch (error) {
		console.error("[exampleLoader] Failed to load example:", error);

		// Re-throw our custom errors as-is
		if (error instanceof ExampleLoadError) {
			throw error;
		}

		// Provide more helpful error messages for fetch errors
		if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
			throw new FetchError(
				"Failed to fetch example. This may be due to CORS restrictions or network issues.",
			);
		}

		throw error instanceof Error
			? new ExampleLoadError(error.message)
			: new ExampleLoadError(`Failed to load example: ${String(error)}`);
	}
}
