const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || "/var/gdsjam/files";
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "100", 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Rate limiting for file uploads
const uploadTracker = new Map();
const UPLOAD_RATE_LIMIT_WINDOW = 3600000; // 1 hour
const UPLOAD_RATE_LIMIT_MAX = 10; // Max uploads per IP per hour

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
 * Rate limit file uploads
 */
function rateLimitUploads(req, res, next) {
	const clientIp = req.ip || req.socket.remoteAddress;
	const now = Date.now();

	if (!uploadTracker.has(clientIp)) {
		uploadTracker.set(clientIp, []);
	}

	const ipUploads = uploadTracker.get(clientIp);
	const recentUploads = ipUploads.filter(
		(timestamp) => now - timestamp < UPLOAD_RATE_LIMIT_WINDOW,
	);

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
 * Setup file storage routes
 */
function setupFileRoutes(app) {
	/**
	 * POST /api/files/upload
	 * Upload a file and return its fileId (SHA-256 hash)
	 */
	app.post(
		"/api/files/upload",
		authenticateRequest,
		rateLimitUploads,
		upload.single("file"),
		async (req, res) => {
			try {
				if (!req.file) {
					return res.status(400).json({ error: "No file uploaded" });
				}

				const fileBuffer = req.file.buffer;
				const fileSize = fileBuffer.length;

				// Validate file size
				if (fileSize > MAX_FILE_SIZE_BYTES) {
					return res.status(413).json({
						error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB`,
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
					return res.json({
						fileId: fileHash,
						size: fileSize,
						deduplicated: true,
					});
				}

				// Write file to disk
				fs.writeFileSync(filePath, fileBuffer);

				console.log(
					`[${new Date().toISOString()}] File uploaded: ${fileHash} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`,
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
	console.log(`  - POST /api/files/upload (max size: ${MAX_FILE_SIZE_MB}MB)`);
	console.log(`  - GET /api/files/:fileId`);
	console.log(`  - DELETE /api/files/:fileId`);
	console.log(`  - Storage path: ${FILE_STORAGE_PATH}`);
	console.log(
		`  - Rate limit: ${UPLOAD_RATE_LIMIT_MAX} uploads per IP per ${UPLOAD_RATE_LIMIT_WINDOW / 1000 / 60} minutes`,
	);
}

module.exports = { setupFileRoutes };
