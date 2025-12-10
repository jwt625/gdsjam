/**
 * URL Loader - Fetch GDSII files from remote URLs
 */

/**
 * Fetch a GDSII file from a URL
 * @param url - The URL to fetch the file from
 * @param onProgress - Optional progress callback
 * @returns ArrayBuffer containing the file data and the filename
 */
export async function fetchGDSIIFromURL(
	url: string,
	onProgress?: (progress: number, message: string) => void,
): Promise<{ arrayBuffer: ArrayBuffer; fileName: string }> {
	try {
		// Validate URL
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(url);
		} catch {
			throw new Error("Invalid URL format");
		}

		// Extract filename from URL
		const pathParts = parsedUrl.pathname.split("/");
		let fileName = pathParts[pathParts.length - 1] || "remote.gds";

		// Ensure filename has .gds or .gdsii extension
		if (!fileName.toLowerCase().endsWith(".gds") && !fileName.toLowerCase().endsWith(".gdsii")) {
			fileName = `${fileName}.gds`;
		}

		onProgress?.(5, "Fetching file from URL...");

		// Fetch the file
		const response = await fetch(url, {
			method: "GET",
			mode: "cors", // Enable CORS
			cache: "default",
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
		}

		// Get content length for progress tracking
		const contentLength = response.headers.get("content-length");
		const totalBytes = contentLength ? Number.parseInt(contentLength, 10) : 0;

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

			// Update progress (5% to 95% range for download)
			if (totalBytes > 0) {
				const downloadProgress = 5 + Math.floor((receivedBytes / totalBytes) * 90);
				onProgress?.(
					downloadProgress,
					`Downloading... ${(receivedBytes / 1024 / 1024).toFixed(1)} MB`,
				);
			} else {
				onProgress?.(50, `Downloading... ${(receivedBytes / 1024 / 1024).toFixed(1)} MB`);
			}
		}

		onProgress?.(95, "Download complete, preparing file...");

		// Combine chunks into a single ArrayBuffer
		const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
		const combinedArray = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			combinedArray.set(chunk, offset);
			offset += chunk.length;
		}

		onProgress?.(100, "File ready");

		return {
			arrayBuffer: combinedArray.buffer,
			fileName,
		};
	} catch (error) {
		console.error("[urlLoader] Failed to fetch file from URL:", error);

		// Provide more helpful error messages
		if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
			throw new Error(
				"Failed to fetch file. This may be due to CORS restrictions or network issues. Make sure the URL is accessible and allows cross-origin requests.",
			);
		}

		throw error instanceof Error ? error : new Error(`Failed to load from URL: ${String(error)}`);
	}
}
