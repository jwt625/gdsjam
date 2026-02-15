/**
 * Python Executor API Client
 *
 * Handles communication with the server-side Python execution endpoint.
 * Executes Python/gdsfactory code and returns generated GDS files.
 */

import { getShortLivedApiToken } from "./authTokenClient";

export interface ExecutionResult {
	success: boolean;
	stdout: string;
	stderr: string;
	fileId?: string;
	size?: number;
	executionTime?: number;
	error?: string;
	deduplicated?: boolean;
}

export class PythonExecutor {
	private baseUrl: string;

	constructor() {
		this.baseUrl = import.meta.env.VITE_FILE_SERVER_URL || "";

		// Validate that required environment variables are set
		if (!this.baseUrl) {
			console.error("VITE_FILE_SERVER_URL is not configured. Python code execution will not work.");
		}
	}

	/**
	 * Execute Python code on the server
	 * @param code - Python code to execute
	 * @returns Execution result with fileId if GDS was generated
	 */
	async execute(code: string): Promise<ExecutionResult> {
		// Check if server URL is configured
		if (!this.baseUrl) {
			return {
				success: false,
				error:
					"Python execution server is not configured. Please set VITE_FILE_SERVER_URL environment variable.",
				stdout: "",
				stderr: "",
				executionTime: 0,
			};
		}

		try {
			const apiToken = await getShortLivedApiToken(this.baseUrl, ["python:execute"]);
			const response = await fetch(`${this.baseUrl}/api/execute`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiToken}`,
				},
				body: JSON.stringify({ code }),
			});

			// Handle rate limiting (429)
			if (response.status === 429) {
				const result = await response.json();
				// Extract retry-after from error message if available
				const retryMatch = result.error?.match(/Try again in (\d+) seconds/);
				const retryAfter = retryMatch ? parseInt(retryMatch[1], 10) : 60;

				return {
					success: false,
					error: result.error || "Rate limit exceeded",
					stdout: "",
					stderr: "",
					executionTime: 0,
					// Add retry-after as a custom property (will be handled by caller)
					...(retryAfter && { retryAfter }),
				} as ExecutionResult & { retryAfter?: number };
			}

			// Handle authentication errors (401)
			if (response.status === 401) {
				return {
					success: false,
					error: "Authentication failed. Please check your server token.",
					stdout: "",
					stderr: "",
					executionTime: 0,
				};
			}

			// Handle server errors (500)
			if (response.status === 500) {
				return {
					success: false,
					error: "Server error. Please try again later.",
					stdout: "",
					stderr: "",
					executionTime: 0,
				};
			}

			// Parse response
			const result: ExecutionResult = await response.json();
			return result;
		} catch (error) {
			// Network errors
			return {
				success: false,
				error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
				stdout: "",
				stderr: "",
				executionTime: 0,
			};
		}
	}

	/**
	 * Validate server availability
	 * @returns true if server is reachable, false otherwise
	 */
	async validateServer(): Promise<boolean> {
		try {
			const apiToken = await getShortLivedApiToken(this.baseUrl, ["python:execute"]);
			// Simple fetch to check if server is reachable
			// We'll just try to execute an empty script (will fail but confirms server is up)
			const response = await fetch(`${this.baseUrl}/api/execute`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiToken}`,
				},
				body: JSON.stringify({ code: "" }),
			});

			// Any response (even 400) means server is reachable
			return response.status !== 0;
		} catch (error) {
			// Network error means server is unreachable
			return false;
		}
	}

	/**
	 * Download GDS file from server by fileId
	 * @param fileId - SHA-256 hash of the file
	 * @returns ArrayBuffer of the GDS file
	 */
	async downloadFile(fileId: string): Promise<ArrayBuffer> {
		const apiToken = await getShortLivedApiToken(this.baseUrl, ["files:read"]);
		const response = await fetch(`${this.baseUrl}/api/files/${fileId}`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiToken}`,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
		}

		return await response.arrayBuffer();
	}
}

// Singleton instance
export const pythonExecutor = new PythonExecutor();
