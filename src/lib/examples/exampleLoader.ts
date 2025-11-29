/**
 * Example Loader - Load example GDS files with support for gzip compression
 */

import { inflate } from "pako";
import { DEBUG } from "../config";
import { loadGDSIIFromBuffer } from "../utils/gdsLoader";
import type { Example } from "./types";

/**
 * Decompress gzipped data
 */
function decompressGzip(compressedData: ArrayBuffer): ArrayBuffer {
	try {
		const decompressed = inflate(new Uint8Array(compressedData));
		return decompressed.buffer;
	} catch (error) {
		throw new Error(
			`Failed to decompress gzip data: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Load an example GDS file
 *
 * @param example - The example to load
 * @param onProgress - Optional progress callback
 */
export async function loadExample(
	example: Example,
	onProgress?: (progress: number, message: string) => void,
): Promise<void> {
	if (DEBUG) {
		console.log(`[exampleLoader] Loading example: ${example.name}`);
	}

	onProgress?.(5, `Fetching ${example.name}...`);

	try {
		// Fetch the file
		const response = await fetch(example.url, {
			method: "GET",
			mode: "cors",
			cache: "default",
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
		}

		// Get content length for progress tracking
		const contentLength = response.headers.get("content-length");
		const totalBytes = contentLength ? Number.parseInt(contentLength, 10) : 0;

		if (DEBUG) {
			console.log(`[exampleLoader] Content-Length: ${totalBytes} bytes`);
		}

		// Read the response body with progress tracking
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("Failed to get response reader");
		}

		const chunks: Uint8Array[] = [];
		let receivedBytes = 0;

		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				break;
			}

			chunks.push(value);
			receivedBytes += value.length;

			// Update progress (5% to 70% range for download)
			if (totalBytes > 0) {
				const downloadProgress = 5 + Math.floor((receivedBytes / totalBytes) * 65);
				onProgress?.(
					downloadProgress,
					`Downloading... ${(receivedBytes / 1024 / 1024).toFixed(2)} MB`,
				);
			} else {
				onProgress?.(35, `Downloading... ${(receivedBytes / 1024 / 1024).toFixed(2)} MB`);
			}
		}

		// Combine chunks into a single ArrayBuffer
		const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
		const combinedArray = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			combinedArray.set(chunk, offset);
			offset += chunk.length;
		}

		if (DEBUG) {
			console.log(`[exampleLoader] Downloaded ${totalLength} bytes`);
		}

		let arrayBuffer: ArrayBuffer = combinedArray.buffer;
		let fileName = example.name.replace(/\s+/g, "_");

		// Decompress if needed
		if (example.isCompressed) {
			onProgress?.(75, "Decompressing...");
			if (DEBUG) {
				console.log("[exampleLoader] Decompressing gzip data...");
			}
			arrayBuffer = decompressGzip(arrayBuffer);
			fileName = fileName.replace(/\.gz$/, "");
			if (DEBUG) {
				console.log(`[exampleLoader] Decompressed to ${arrayBuffer.byteLength} bytes`);
			}
		}

		// Ensure filename has .gds extension
		if (!fileName.toLowerCase().endsWith(".gds")) {
			fileName = `${fileName}.gds`;
		}

		onProgress?.(80, "Loading GDS file...");

		// Load the file using the shared loader
		await loadGDSIIFromBuffer(arrayBuffer, fileName);

		if (DEBUG) {
			console.log(`[exampleLoader] Example loaded successfully: ${example.name}`);
		}
	} catch (error) {
		console.error("[exampleLoader] Failed to load example:", error);

		// Provide more helpful error messages
		if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
			throw new Error(
				"Failed to fetch example. This may be due to CORS restrictions or network issues.",
			);
		}

		throw error instanceof Error ? error : new Error(`Failed to load example: ${String(error)}`);
	}
}
