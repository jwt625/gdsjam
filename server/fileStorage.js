const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || "/var/gdsjam/files";
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "100", 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Rate limiting for file uploads (count-based)
const uploadTracker = new Map(); // Map<IP, timestamp[]>
const UPLOAD_RATE_LIMIT_WINDOW = parseInt(process.env.UPLOAD_RATE_LIMIT_WINDOW || "3600000", 10); // 1 hour default
const UPLOAD_RATE_LIMIT_MAX = parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || "100", 10); // Max uploads per IP per hour

// Rate limiting for file uploads (size-based, weekly)
const uploadSizeTracker = new Map(); // Map<IP, {timestamp, bytes}[]>
const WEEKLY_SIZE_LIMIT_WINDOW = 7 * 24 * 60 * 60 * 1000; // 1 week in ms
const WEEKLY_SIZE_LIMIT_MB = parseInt(process.env.WEEKLY_SIZE_LIMIT_MB || "1000", 10); // 1GB per IP per week default
const WEEKLY_SIZE_LIMIT_BYTES = WEEKLY_SIZE_LIMIT_MB * 1024 * 1024;

// Ensure storage directory exists
if (!fs.existsSync(FILE_STORAGE_PATH)) {
	fs.mkdirSync(FILE_STORAGE_PATH, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store in memory for hash validation
const upload = multer({
	storage: storage,
	limits: {
		fileSize: MAX_FILE_SIZE_BYTES,
	},
});

/**
 * Compute SHA-256 hash of a buffer
 */
function computeSHA256(buffer) {
	const hash = crypto.createHash("sha256");
	hash.update(buffer);
	return hash.digest("hex");
}

/**
 * Validate GDSII or DXF magic bytes
 */
function validateFileType(buffer) {
	if (buffer.length < 4) return false;

	// GDSII magic bytes: 0x00 0x06 (first two bytes)
	const isGDSII = buffer[0] === 0x00 && buffer[1] === 0x06;

	// DXF is ASCII text starting with "0\r\nSECTION" or "0\nSECTION"
	const isDXF =
		buffer.toString("ascii", 0, 10).includes("0") &&
		buffer.toString("ascii", 0, 20).includes("SECTION");

	return isGDSII || isDXF;
}

/**
 * Validate fileId format (must be 64 hex characters)
 */
function validateFileId(fileId) {
	return /^[a-f0-9]{64}$/.test(fileId);
}

/**
 * Authenticate request using Bearer token
 */
function authenticateRequest(req, res, next) {
	if (!AUTH_TOKEN) {
		return next(); // No auth required if token not set
	}

	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({ error: "Missing or invalid authorization header" });
	}

	const token = authHeader.substring(7);
	if (token !== AUTH_TOKEN) {
		return res.status(401).json({ error: "Invalid token" });
	}

	next();
}

/**
 * Rate limit file uploads (count-based, per hour)
 */
function rateLimitUploads(req, res, next) {
	const clientIp = req.ip || req.socket.remoteAddress;
	const now = Date.now();

	if (!uploadTracker.has(clientIp)) {
		uploadTracker.set(clientIp, []);
	}

	const ipUploads = uploadTracker.get(clientIp);
	const recentUploads = ipUploads.filter((timestamp) => now - timestamp < UPLOAD_RATE_LIMIT_WINDOW);

	if (recentUploads.length >= UPLOAD_RATE_LIMIT_MAX) {
		return res.status(429).json({
			error: `Rate limit exceeded. Maximum ${UPLOAD_RATE_LIMIT_MAX} uploads per hour.`,
		});
	}

	recentUploads.push(now);
	uploadTracker.set(clientIp, recentUploads);

	next();
}

/**
 * Check weekly size limit for an IP
 * Returns { allowed: boolean, usedBytes: number, remainingBytes: number }
 */
function checkWeeklySizeLimit(clientIp, fileSize) {
	const now = Date.now();

	if (!uploadSizeTracker.has(clientIp)) {
		uploadSizeTracker.set(clientIp, []);
	}

	const ipUploads = uploadSizeTracker.get(clientIp);
	// Filter to only entries within the weekly window
	const recentUploads = ipUploads.filter(
		(entry) => now - entry.timestamp < WEEKLY_SIZE_LIMIT_WINDOW,
	);

	// Calculate total bytes uploaded this week
	const usedBytes = recentUploads.reduce((sum, entry) => sum + entry.bytes, 0);
	const remainingBytes = WEEKLY_SIZE_LIMIT_BYTES - usedBytes;

	if (usedBytes + fileSize > WEEKLY_SIZE_LIMIT_BYTES) {
		return { allowed: false, usedBytes, remainingBytes };
	}

	return { allowed: true, usedBytes, remainingBytes };
}

/**
 * Record a successful upload for weekly size tracking
 */
function recordUploadSize(clientIp, fileSize) {
	const now = Date.now();

	if (!uploadSizeTracker.has(clientIp)) {
		uploadSizeTracker.set(clientIp, []);
	}

	const ipUploads = uploadSizeTracker.get(clientIp);
	// Clean up old entries while adding new one
	const recentUploads = ipUploads.filter(
		(entry) => now - entry.timestamp < WEEKLY_SIZE_LIMIT_WINDOW,
	);
	recentUploads.push({ timestamp: now, bytes: fileSize });
	uploadSizeTracker.set(clientIp, recentUploads);
}

/**
 * Setup file storage routes
 */
function setupFileRoutes(app) {
	/**
	 * POST /api/files
	 * Upload a file and return its fileId (SHA-256 hash)
	 */
	app.post(
		"/api/files",
		authenticateRequest,
		rateLimitUploads,
		upload.single("file"),
		async (req, res) => {
			try {
				if (!req.file) {
					return res.status(400).json({ error: "No file uploaded" });
				}

				const clientIp = req.ip || req.socket.remoteAddress;
				const fileBuffer = req.file.buffer;
				const fileSize = fileBuffer.length;

				// Validate file size
				if (fileSize > MAX_FILE_SIZE_BYTES) {
					return res.status(413).json({
						error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB`,
					});
				}

				// Check weekly size limit
				const sizeCheck = checkWeeklySizeLimit(clientIp, fileSize);
				if (!sizeCheck.allowed) {
					const usedMB = (sizeCheck.usedBytes / 1024 / 1024).toFixed(1);
					const remainingMB = Math.max(0, sizeCheck.remainingBytes / 1024 / 1024).toFixed(1);
					return res.status(429).json({
						error: `Weekly upload limit exceeded. You have used ${usedMB}MB of ${WEEKLY_SIZE_LIMIT_MB}MB this week. Remaining: ${remainingMB}MB.`,
					});
				}

				// Validate file type (GDSII or DXF)
				if (!validateFileType(fileBuffer)) {
					return res.status(400).json({
						error: "Invalid file type. Only GDSII and DXF files are accepted.",
					});
				}

				// Compute SHA-256 hash
				const fileHash = computeSHA256(fileBuffer);

				// Save file with hash as filename
				const filePath = path.join(FILE_STORAGE_PATH, `${fileHash}.bin`);

				// Check if file already exists (deduplication)
				if (fs.existsSync(filePath)) {
					console.log(
						`[${new Date().toISOString()}] File already exists (deduplicated): ${fileHash}`,
					);
					// Don't count deduplicated files against size limit
					return res.json({
						fileId: fileHash,
						size: fileSize,
						deduplicated: true,
					});
				}

				// Write file to disk
				fs.writeFileSync(filePath, fileBuffer);

				// Record the upload size for weekly tracking
				recordUploadSize(clientIp, fileSize);

				console.log(
					`[${new Date().toISOString()}] File uploaded: ${fileHash} (${(fileSize / 1024 / 1024).toFixed(2)}MB) from ${clientIp}`,
				);

				res.json({
					fileId: fileHash,
					size: fileSize,
					deduplicated: false,
				});
			} catch (error) {
				console.error(`[${new Date().toISOString()}] Upload error:`, error);
				res.status(500).json({ error: "Internal server error" });
			}
		},
	);

	/**
	 * GET /api/files/:fileId
	 * Download a file by its fileId (SHA-256 hash)
	 */
	app.get("/api/files/:fileId", authenticateRequest, (req, res) => {
		try {
			const { fileId } = req.params;

			// Validate fileId format (prevent path traversal)
			if (!validateFileId(fileId)) {
				return res.status(400).json({ error: "Invalid fileId format" });
			}

			const filePath = path.join(FILE_STORAGE_PATH, `${fileId}.bin`);

			// Check if file exists
			if (!fs.existsSync(filePath)) {
				return res.status(404).json({ error: "File not found" });
			}

			// Get file stats
			const stats = fs.statSync(filePath);
			const fileSize = stats.size;

			// Set headers
			res.setHeader("Content-Type", "application/octet-stream");
			res.setHeader("Content-Length", fileSize);
			res.setHeader("Content-Disposition", `attachment; filename="${fileId}.bin"`);

			// Stream file to response
			const readStream = fs.createReadStream(filePath);
			readStream.pipe(res);

			readStream.on("error", (error) => {
				console.error(`[${new Date().toISOString()}] Download error:`, error);
				if (!res.headersSent) {
					res.status(500).json({ error: "Error streaming file" });
				}
			});

			console.log(
				`[${new Date().toISOString()}] File downloaded: ${fileId} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`,
			);
		} catch (error) {
			console.error(`[${new Date().toISOString()}] Download error:`, error);
			if (!res.headersSent) {
				res.status(500).json({ error: "Internal server error" });
			}
		}
	});

	/**
	 * DELETE /api/files/:fileId
	 * Delete a file by its fileId (optional, for manual cleanup)
	 */
	app.delete("/api/files/:fileId", authenticateRequest, (req, res) => {
		try {
			const { fileId } = req.params;

			// Validate fileId format (prevent path traversal)
			if (!validateFileId(fileId)) {
				return res.status(400).json({ error: "Invalid fileId format" });
			}

			const filePath = path.join(FILE_STORAGE_PATH, `${fileId}.bin`);

			// Check if file exists
			if (!fs.existsSync(filePath)) {
				return res.status(404).json({ error: "File not found" });
			}

			// Delete file
			fs.unlinkSync(filePath);

			console.log(`[${new Date().toISOString()}] File deleted: ${fileId}`);

			res.json({ success: true, message: "File deleted" });
		} catch (error) {
			console.error(`[${new Date().toISOString()}] Delete error:`, error);
			res.status(500).json({ error: "Internal server error" });
		}
	});

	console.log("File storage routes configured:");
	console.log(`  - POST /api/files (max size: ${MAX_FILE_SIZE_MB}MB)`);
	console.log(`  - GET /api/files/:fileId`);
	console.log(`  - DELETE /api/files/:fileId`);
	console.log(`  - Storage path: ${FILE_STORAGE_PATH}`);
	console.log(
		`  - Rate limit: ${UPLOAD_RATE_LIMIT_MAX} uploads per IP per ${UPLOAD_RATE_LIMIT_WINDOW / 1000 / 60} minutes`,
	);
	console.log(`  - Weekly size limit: ${WEEKLY_SIZE_LIMIT_MB}MB per IP per week`);
}

/**
 * Get OpenAPI specification
 */
function getOpenAPISpec() {
	return {
		openapi: "3.0.0",
		info: {
			title: "GDSJam File Storage API",
			version: "1.0.0",
			description:
				"REST API for uploading and downloading GDSII and DXF files for GDSJam collaboration sessions",
			contact: {
				name: "GDSJam",
				url: "https://gdsjam.com",
			},
		},
		servers: [
			{
				url: "https://signaling.gdsjam.com",
				description: "Production server",
			},
			{
				url: "http://localhost:4444",
				description: "Local development server",
			},
		],
		components: {
			securitySchemes: {
				BearerAuth: {
					type: "http",
					scheme: "bearer",
					description: "Bearer token authentication using AUTH_TOKEN",
				},
			},
			schemas: {
				FileUploadResponse: {
					type: "object",
					properties: {
						fileId: {
							type: "string",
							description: "SHA-256 hash of the uploaded file",
							example: "a1b2c3d4e5f6...",
							pattern: "^[a-f0-9]{64}$",
						},
						size: {
							type: "integer",
							description: "File size in bytes",
							example: 1048576,
						},
						deduplicated: {
							type: "boolean",
							description: "Whether the file already existed on the server",
							example: false,
						},
					},
					required: ["fileId", "size", "deduplicated"],
				},
				Error: {
					type: "object",
					properties: {
						error: {
							type: "string",
							description: "Error message",
							example: "Invalid file type",
						},
					},
					required: ["error"],
				},
				DeleteResponse: {
					type: "object",
					properties: {
						success: {
							type: "boolean",
							example: true,
						},
						message: {
							type: "string",
							example: "File deleted",
						},
					},
				},
			},
		},
		security: [
			{
				BearerAuth: [],
			},
		],
		paths: {
			"/api/files": {
				post: {
					summary: "Upload a file",
					description:
						"Upload a GDSII or DXF file. Returns the file ID (SHA-256 hash) which can be used to download the file. Files are automatically deduplicated based on content hash.",
					tags: ["Files"],
					security: [{ BearerAuth: [] }],
					requestBody: {
						required: true,
						content: {
							"multipart/form-data": {
								schema: {
									type: "object",
									properties: {
										file: {
											type: "string",
											format: "binary",
											description: "GDSII or DXF file to upload (max 100MB)",
										},
									},
									required: ["file"],
								},
							},
						},
					},
					responses: {
						200: {
							description: "File uploaded successfully",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/FileUploadResponse",
									},
								},
							},
						},
						400: {
							description: "Bad request (no file, invalid file type)",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						401: {
							description: "Unauthorized (missing or invalid token)",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						413: {
							description: "File too large (max 100MB)",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						429: {
							description:
								"Rate limit exceeded (max 100 uploads per hour per IP, or 1GB per week per IP)",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						500: {
							description: "Internal server error",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
					},
				},
			},
			"/api/files/{fileId}": {
				get: {
					summary: "Download a file",
					description:
						"Download a file by its ID (SHA-256 hash). The file is streamed as application/octet-stream.",
					tags: ["Files"],
					security: [{ BearerAuth: [] }],
					parameters: [
						{
							name: "fileId",
							in: "path",
							required: true,
							description: "File ID (SHA-256 hash, 64 hex characters)",
							schema: {
								type: "string",
								pattern: "^[a-f0-9]{64}$",
								example: "a1b2c3d4e5f6...",
							},
						},
					],
					responses: {
						200: {
							description: "File downloaded successfully",
							content: {
								"application/octet-stream": {
									schema: {
										type: "string",
										format: "binary",
									},
								},
							},
						},
						400: {
							description: "Invalid fileId format",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						401: {
							description: "Unauthorized",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						404: {
							description: "File not found",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						500: {
							description: "Internal server error",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
					},
				},
				delete: {
					summary: "Delete a file",
					description:
						"Delete a file by its ID (SHA-256 hash). Note: Files are automatically deleted after 7 days.",
					tags: ["Files"],
					security: [{ BearerAuth: [] }],
					parameters: [
						{
							name: "fileId",
							in: "path",
							required: true,
							description: "File ID (SHA-256 hash, 64 hex characters)",
							schema: {
								type: "string",
								pattern: "^[a-f0-9]{64}$",
								example: "a1b2c3d4e5f6...",
							},
						},
					],
					responses: {
						200: {
							description: "File deleted successfully",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/DeleteResponse",
									},
								},
							},
						},
						400: {
							description: "Invalid fileId format",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						401: {
							description: "Unauthorized",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						404: {
							description: "File not found",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
						500: {
							description: "Internal server error",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Error",
									},
								},
							},
						},
					},
				},
			},
		},
	};
}

module.exports = { setupFileRoutes, getOpenAPISpec };
