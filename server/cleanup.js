const fs = require("fs");
const path = require("path");
require("dotenv").config();

const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || "/var/gdsjam/files";
const FILE_RETENTION_HOURS = parseInt(process.env.FILE_RETENTION_HOURS || "24", 10);
const RETENTION_MS = FILE_RETENTION_HOURS * 60 * 60 * 1000;

/**
 * Cleanup old files from storage directory
 */
function cleanupOldFiles() {
	const now = Date.now();
	let deletedCount = 0;
	let totalSize = 0;

	console.log(`[${new Date().toISOString()}] Starting file cleanup...`);
	console.log(`  Storage path: ${FILE_STORAGE_PATH}`);
	console.log(`  Retention period: ${FILE_RETENTION_HOURS} hours`);

	try {
		// Check if directory exists
		if (!fs.existsSync(FILE_STORAGE_PATH)) {
			console.log(`  Directory does not exist: ${FILE_STORAGE_PATH}`);
			return;
		}

		// Read all files in directory
		const files = fs.readdirSync(FILE_STORAGE_PATH);

		console.log(`  Found ${files.length} files`);

		// Check each file
		for (const file of files) {
			const filePath = path.join(FILE_STORAGE_PATH, file);

			try {
				const stats = fs.statSync(filePath);

				// Check if file is a regular file (not directory)
				if (!stats.isFile()) {
					continue;
				}

				// Check file age
				const fileAge = now - stats.mtimeMs;

				if (fileAge > RETENTION_MS) {
					// File is older than retention period, delete it
					const fileSize = stats.size;
					fs.unlinkSync(filePath);
					deletedCount++;
					totalSize += fileSize;

					console.log(
						`  Deleted: ${file} (age: ${(fileAge / 1000 / 60 / 60).toFixed(1)}h, size: ${(fileSize / 1024 / 1024).toFixed(2)}MB)`,
					);
				}
			} catch (error) {
				console.error(`  Error processing file ${file}:`, error.message);
			}
		}

		console.log(`[${new Date().toISOString()}] Cleanup completed`);
		console.log(`  Files deleted: ${deletedCount}`);
		console.log(`  Space freed: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
	} catch (error) {
		console.error(`[${new Date().toISOString()}] Cleanup error:`, error);
	}
}

// Run cleanup
cleanupOldFiles();
