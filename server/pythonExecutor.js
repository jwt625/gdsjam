const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const crypto = require("crypto");

// Configuration from environment
const PYTHON_VENV_PATH = process.env.PYTHON_VENV_PATH || "/opt/gdsjam/venv";
const PYTHON_TIMEOUT = parseInt(process.env.PYTHON_TIMEOUT || "30", 10) * 1000; // Convert to ms
const PYTHON_RATE_LIMIT_WINDOW = parseInt(process.env.PYTHON_RATE_LIMIT_WINDOW || "60000", 10); // 1 minute
const PYTHON_RATE_LIMIT_MAX = parseInt(process.env.PYTHON_RATE_LIMIT_MAX || "10", 10);
const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || "/var/gdsjam/files";
const MAX_GDS_SIZE_MB = parseInt(process.env.MAX_GDS_SIZE_MB || "100", 10);
const MAX_GDS_SIZE_BYTES = MAX_GDS_SIZE_MB * 1024 * 1024;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Rate limiting tracker
const executionTracker = new Map(); // Map<IP, timestamp[]>

// Module whitelist - safe modules for gdsfactory workflows
const MODULE_WHITELIST = new Set([
	// gdsfactory and dependencies
	"gdsfactory",
	"gf",
	"gdstk",
	"kfactory",
	// Scientific computing
	"numpy",
	"np",
	"scipy",
	"matplotlib",
	"matplotlib.pyplot",
	"plt",
	// Standard library (safe subset)
	"math",
	"cmath",
	"itertools",
	"functools",
	"collections",
	"typing",
	"dataclasses",
	"enum",
	"json",
	"re",
	"copy",
	"random",
	"statistics",
	"fractions",
	"decimal",
	"pathlib",
]);

// Module blacklist - dangerous modules that should never be imported
const MODULE_BLACKLIST = new Set([
	// System access
	"os",
	"sys",
	"subprocess",
	"shutil",
	"platform",
	"ctypes",
	"multiprocessing",
	"threading",
	// Network access
	"socket",
	"urllib",
	"urllib.request",
	"urllib.parse",
	"http",
	"http.client",
	"http.server",
	"ftplib",
	"smtplib",
	"poplib",
	"imaplib",
	"telnetlib",
	"requests",
	"httpx",
	"aiohttp",
	// File system access beyond current directory
	"tempfile",
	"glob",
	// Code execution
	"eval",
	"exec",
	"compile",
	"code",
	"codeop",
	"ast",
	"importlib",
	"__import__",
	"builtins",
	"__builtins__",
	// Dangerous standard library
	"pickle",
	"shelve",
	"marshal",
	"pty",
	"tty",
	"termios",
	"resource",
	"sysconfig",
	"distutils",
	"setuptools",
	"pip",
]);

/**
 * Validate imports in Python code
 * Returns { valid: boolean, error?: string }
 */
function validateImports(code) {
	// Match import statements
	// Patterns: "import X", "from X import Y", "import X as Y", "from X.Y import Z"
	const importPatterns = [
		/^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/gm,
		/^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s+import/gm,
	];

	const imports = new Set();

	for (const pattern of importPatterns) {
		let match;
		while ((match = pattern.exec(code)) !== null) {
			const moduleName = match[1];
			imports.add(moduleName);
			// Also add the root module (e.g., "matplotlib" from "matplotlib.pyplot")
			const rootModule = moduleName.split(".")[0];
			imports.add(rootModule);
		}
	}

	// Check for blacklisted modules
	for (const module of imports) {
		if (MODULE_BLACKLIST.has(module)) {
			return {
				valid: false,
				error: `Import of '${module}' is not allowed for security reasons`,
			};
		}
	}

	// Check for dynamic imports or eval
	if (code.includes("__import__") || code.includes("exec(") || code.includes("eval(")) {
		return {
			valid: false,
			error: "Dynamic code execution (exec, eval, __import__) is not allowed",
		};
	}

	return { valid: true };
}

/**
 * Sanitize error messages to remove server paths
 */
function sanitizePath(text) {
	if (!text) return text;

	// Remove common server paths
	const pathsToRemove = [
		PYTHON_VENV_PATH,
		FILE_STORAGE_PATH,
		"/opt/gdsjam",
		"/var/gdsjam",
		"/tmp/gdsjam-",
		os.tmpdir(),
	];

	let sanitized = text;
	for (const p of pathsToRemove) {
		// Replace with generic placeholder
		sanitized = sanitized.split(p).join("<server>");
	}

	// Also sanitize any remaining /tmp paths with our prefix
	sanitized = sanitized.replace(/\/tmp\/gdsjam-[a-zA-Z0-9]+/g, "<temp>");

	return sanitized;
}

/**
 * Compute SHA-256 hash of a buffer
 */
function computeSHA256(buffer) {
	const hash = crypto.createHash("sha256");
	hash.update(buffer);
	return hash.digest("hex");
}

/**
 * Create a temporary directory for script execution
 */
function createTempDir() {
	const tempBase = os.tmpdir();
	const uniqueId = crypto.randomBytes(8).toString("hex");
	const tempDir = path.join(tempBase, `gdsjam-${uniqueId}`);
	fs.mkdirSync(tempDir, { recursive: true });
	return tempDir;
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(tempDir) {
	try {
		fs.rmSync(tempDir, { recursive: true, force: true });
	} catch (error) {
		console.error(`[${new Date().toISOString()}] Failed to cleanup temp dir: ${error.message}`);
	}
}

/**
 * Find GDS files in a directory
 */
function findGdsFiles(directory) {
	try {
		const files = fs.readdirSync(directory);
		return files.filter((f) => f.endsWith(".gds")).map((f) => path.join(directory, f));
	} catch (error) {
		return [];
	}
}

/**
 * Execute Python code and return result
 */
async function executePythonCode(code, clientIp) {
	const startTime = Date.now();
	let tempDir = null;
	let stdout = "";
	let stderr = "";

	try {
		// Validate imports first
		const importValidation = validateImports(code);
		if (!importValidation.valid) {
			return {
				success: false,
				error: importValidation.error,
				stdout: "",
				stderr: "",
				executionTime: (Date.now() - startTime) / 1000,
			};
		}

		// Create temp directory
		tempDir = createTempDir();
		const scriptPath = path.join(tempDir, "script.py");

		// Write code to script file
		fs.writeFileSync(scriptPath, code, "utf8");

		// Get Python executable from venv
		const pythonPath = path.join(PYTHON_VENV_PATH, "bin", "python");

		// Check if Python executable exists
		if (!fs.existsSync(pythonPath)) {
			return {
				success: false,
				error: "Python environment not configured on server",
				stdout: "",
				stderr: "",
				executionTime: (Date.now() - startTime) / 1000,
			};
		}

		// Execute Python script
		const result = await new Promise((resolve) => {
			const proc = spawn(pythonPath, [scriptPath], {
				cwd: tempDir,
				timeout: PYTHON_TIMEOUT,
				env: {
					...process.env,
					HOME: tempDir, // Isolate home directory
					MPLCONFIGDIR: tempDir, // Matplotlib config
				},
			});

			let timedOut = false;
			const timeoutId = setTimeout(() => {
				timedOut = true;
				proc.kill("SIGTERM");
				// Force kill after 2 seconds if still running
				setTimeout(() => {
					if (!proc.killed) {
						proc.kill("SIGKILL");
					}
				}, 2000);
			}, PYTHON_TIMEOUT);

			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});

			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (exitCode) => {
				clearTimeout(timeoutId);
				resolve({
					exitCode,
					timedOut,
					stdout,
					stderr,
				});
			});

			proc.on("error", (error) => {
				clearTimeout(timeoutId);
				resolve({
					exitCode: 1,
					timedOut: false,
					stdout,
					stderr: error.message,
				});
			});
		});

		// Handle timeout
		if (result.timedOut) {
			return {
				success: false,
				error: `Execution timed out after ${PYTHON_TIMEOUT / 1000} seconds`,
				stdout: sanitizePath(result.stdout),
				stderr: sanitizePath(result.stderr),
				executionTime: PYTHON_TIMEOUT / 1000,
			};
		}

		// Handle execution error
		if (result.exitCode !== 0) {
			return {
				success: false,
				error: "Python execution failed",
				stdout: sanitizePath(result.stdout),
				stderr: sanitizePath(result.stderr),
				executionTime: (Date.now() - startTime) / 1000,
			};
		}

		// Look for generated GDS files
		const gdsFiles = findGdsFiles(tempDir);

		if (gdsFiles.length === 0) {
			return {
				success: false,
				error: "No GDS file was generated. Make sure your code calls write_gds() or similar.",
				stdout: sanitizePath(result.stdout),
				stderr: sanitizePath(result.stderr),
				executionTime: (Date.now() - startTime) / 1000,
			};
		}

		// Use the first GDS file (or the largest one if multiple)
		let gdsFile = gdsFiles[0];
		if (gdsFiles.length > 1) {
			// Pick the largest file
			let maxSize = 0;
			for (const f of gdsFiles) {
				const stats = fs.statSync(f);
				if (stats.size > maxSize) {
					maxSize = stats.size;
					gdsFile = f;
				}
			}
		}

		// Read and validate GDS file
		const gdsBuffer = fs.readFileSync(gdsFile);
		const gdsSize = gdsBuffer.length;

		// Check file size
		if (gdsSize > MAX_GDS_SIZE_BYTES) {
			return {
				success: false,
				error: `Generated GDS file is too large (${(gdsSize / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_GDS_SIZE_MB}MB.`,
				stdout: sanitizePath(result.stdout),
				stderr: sanitizePath(result.stderr),
				executionTime: (Date.now() - startTime) / 1000,
			};
		}

		// Compute hash and save to file storage
		const fileHash = computeSHA256(gdsBuffer);
		const storagePath = path.join(FILE_STORAGE_PATH, `${fileHash}.bin`);

		// Check if file already exists (deduplication)
		const deduplicated = fs.existsSync(storagePath);
		if (!deduplicated) {
			fs.writeFileSync(storagePath, gdsBuffer);
		}

		console.log(
			`[${new Date().toISOString()}] Python execution successful: ${fileHash} (${(gdsSize / 1024).toFixed(1)}KB) from ${clientIp}`,
		);

		return {
			success: true,
			fileId: fileHash,
			size: gdsSize,
			deduplicated,
			executionTime: (Date.now() - startTime) / 1000,
			stdout: sanitizePath(result.stdout),
			stderr: sanitizePath(result.stderr),
		};
	} catch (error) {
		console.error(`[${new Date().toISOString()}] Python execution error:`, error.message);
		return {
			success: false,
			error: sanitizePath(error.message),
			stdout: sanitizePath(stdout),
			stderr: sanitizePath(stderr),
			executionTime: (Date.now() - startTime) / 1000,
		};
	} finally {
		// Always clean up temp directory
		if (tempDir) {
			cleanupTempDir(tempDir);
		}
	}
}

/**
 * Rate limiting middleware for Python execution
 */
function rateLimitExecution(req, res, next) {
	const clientIp = req.ip || req.socket.remoteAddress;
	const now = Date.now();

	if (!executionTracker.has(clientIp)) {
		executionTracker.set(clientIp, []);
	}

	const ipExecutions = executionTracker.get(clientIp);
	const recentExecutions = ipExecutions.filter(
		(timestamp) => now - timestamp < PYTHON_RATE_LIMIT_WINDOW,
	);

	if (recentExecutions.length >= PYTHON_RATE_LIMIT_MAX) {
		const waitTime = Math.ceil(
			(PYTHON_RATE_LIMIT_WINDOW - (now - recentExecutions[0])) / 1000,
		);
		return res.status(429).json({
			success: false,
			error: `Rate limit exceeded. Maximum ${PYTHON_RATE_LIMIT_MAX} executions per minute. Try again in ${waitTime} seconds.`,
		});
	}

	recentExecutions.push(now);
	executionTracker.set(clientIp, recentExecutions);

	next();
}

/**
 * Authentication middleware (reuses AUTH_TOKEN from fileStorage)
 */
function authenticateRequest(req, res, next) {
	if (!AUTH_TOKEN) {
		return next(); // No auth required if token not set
	}

	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({
			success: false,
			error: "Missing or invalid authorization header",
		});
	}

	const token = authHeader.substring(7);
	if (token !== AUTH_TOKEN) {
		return res.status(401).json({
			success: false,
			error: "Invalid token",
		});
	}

	next();
}

/**
 * Setup Python execution routes
 */
function setupPythonRoutes(app) {
	/**
	 * POST /api/execute
	 * Execute Python/gdsfactory code and return generated GDS file
	 */
	app.post("/api/execute", authenticateRequest, rateLimitExecution, async (req, res) => {
		try {
			const { code } = req.body;

			if (!code || typeof code !== "string") {
				return res.status(400).json({
					success: false,
					error: "Missing or invalid 'code' field in request body",
				});
			}

			// Limit code size (prevent DoS with huge payloads)
			const MAX_CODE_SIZE = 100 * 1024; // 100KB
			if (code.length > MAX_CODE_SIZE) {
				return res.status(400).json({
					success: false,
					error: `Code too large. Maximum size is ${MAX_CODE_SIZE / 1024}KB`,
				});
			}

			const clientIp = req.ip || req.socket.remoteAddress;
			console.log(
				`[${new Date().toISOString()}] Python execution request from ${clientIp} (${code.length} bytes)`,
			);

			const result = await executePythonCode(code, clientIp);

			if (result.success) {
				res.json(result);
			} else {
				// Use 200 for execution errors (client can handle based on success field)
				// Use 4xx/5xx for request-level errors
				res.json(result);
			}
		} catch (error) {
			console.error(`[${new Date().toISOString()}] Execute endpoint error:`, error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	console.log("Python execution routes configured:");
	console.log(`  - POST /api/execute`);
	console.log(`  - Python venv: ${PYTHON_VENV_PATH}`);
	console.log(`  - Timeout: ${PYTHON_TIMEOUT / 1000}s`);
	console.log(
		`  - Rate limit: ${PYTHON_RATE_LIMIT_MAX} executions per IP per ${PYTHON_RATE_LIMIT_WINDOW / 1000}s`,
	);
	console.log(`  - Max GDS size: ${MAX_GDS_SIZE_MB}MB`);
}

module.exports = { setupPythonRoutes };
