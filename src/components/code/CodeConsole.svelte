<script lang="ts">
/**
 * CodeConsole - Display stdout/stderr from Python execution
 *
 * Features:
 * - ANSI color support (basic)
 * - Auto-scroll to bottom on new output
 * - Clear button
 * - Execution time display
 * - Error highlighting
 */

import { editorStore } from "../../stores/editorStore";

interface Props {
	stdout?: string;
	stderr?: string;
	executionTime?: number;
	error?: string | null;
}

const { stdout = "", stderr = "", executionTime = 0, error = null }: Props = $props();

let consoleContainer: HTMLDivElement;

// Limit output to prevent browser freeze (max 10,000 lines)
const MAX_OUTPUT_LINES = 10000;

function limitOutputLines(text: string): string {
	if (!text) return text;

	const lines = text.split("\n");
	if (lines.length <= MAX_OUTPUT_LINES) {
		return text;
	}

	// Keep last MAX_OUTPUT_LINES and add truncation notice
	const truncatedLines = lines.slice(-MAX_OUTPUT_LINES);
	const removedCount = lines.length - MAX_OUTPUT_LINES;
	return `[... ${removedCount} lines truncated ...]\n${truncatedLines.join("\n")}`;
}

// Limit stdout and stderr to prevent browser freeze
const limitedStdout = $derived(limitOutputLines(stdout));
const limitedStderr = $derived(limitOutputLines(stderr));

// Auto-scroll to bottom when output changes
$effect(() => {
	if (consoleContainer && (limitedStdout || limitedStderr || error)) {
		consoleContainer.scrollTop = consoleContainer.scrollHeight;
	}
});

function clearConsole() {
	editorStore.setConsoleOutput("");
	editorStore.setExecutionError(null);
}

// Format execution time
const formattedTime = $derived(
	executionTime > 0 ? `Execution time: ${executionTime.toFixed(2)}s` : "",
);
</script>

<div class="console-container">
	<div class="console-header">
		<span class="console-title">Console Output</span>
		<button class="clear-button" onclick={clearConsole} type="button">Clear</button>
	</div>

	<div class="console-output" bind:this={consoleContainer}>
		{#if error}
			<div class="error-message">
				<strong>Error:</strong>
				{error}
			</div>
		{/if}

		{#if limitedStdout}
			<div class="stdout">
				<pre>{limitedStdout}</pre>
			</div>
		{/if}

		{#if limitedStderr}
			<div class="stderr">
				<pre>{limitedStderr}</pre>
			</div>
		{/if}

		{#if !limitedStdout && !limitedStderr && !error}
			<div class="empty-message">No output yet. Run your code to see results.</div>
		{/if}

		{#if formattedTime}
			<div class="execution-time">{formattedTime}</div>
		{/if}
	</div>
</div>

<style>
.console-container {
	display: flex;
	flex-direction: column;
	height: 100%;
	background: #1e1e1e;
	color: #d4d4d4;
	font-family: "Consolas", "Monaco", "Courier New", monospace;
	font-size: 13px;
}

.console-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 8px 12px;
	background: #252526;
	border-bottom: 1px solid #3e3e42;
}

.console-title {
	font-weight: 600;
	font-size: 12px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #cccccc;
}

.clear-button {
	padding: 4px 12px;
	background: #3e3e42;
	color: #cccccc;
	border: none;
	border-radius: 0;
	cursor: pointer;
	font-size: 11px;
	transition: background 0.1s;
}

.clear-button:hover {
	background: #505050;
}

.console-output {
	flex: 1;
	overflow-y: auto;
	padding: 12px;
}

.error-message {
	color: #f48771;
	background: #5a1d1d;
	padding: 8px 12px;
	border-left: 3px solid #f48771;
	margin-bottom: 12px;
	border-radius: 0;
}

.stdout pre,
.stderr pre {
	margin: 0;
	white-space: pre-wrap;
	word-wrap: break-word;
}

.stdout {
	color: #d4d4d4;
	margin-bottom: 8px;
}

.stderr {
	color: #f48771;
	margin-bottom: 8px;
}

.empty-message {
	color: #858585;
	font-style: italic;
	text-align: center;
	padding: 40px 20px;
}

.execution-time {
	color: #858585;
	font-size: 11px;
	margin-top: 12px;
	padding-top: 8px;
	border-top: 1px solid #3e3e42;
}
</style>

