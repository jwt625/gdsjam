#!/usr/bin/env node
/**
 * Preview Generator Script
 *
 * Uses Puppeteer to load each example GDS file in the actual renderer
 * and capture a screenshot for preview thumbnails.
 *
 * Usage:
 *   1. Start the dev server: pnpm dev
 *   2. Run this script: node scripts/generate-previews.js
 *
 * Output: public/previews/{example-id}.png
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PREVIEWS_DIR = path.join(ROOT_DIR, "public", "previews");

// Example configurations - must match examples.ts
const EXAMPLES = [
	{
		id: "grating-coupler",
		url: "https://raw.githubusercontent.com/gdsfactory/ubc/main/ubcpdk/gds/EBeam/ebeam_gc_te1550.gds",
	},
	{
		id: "y-splitter",
		url: "https://raw.githubusercontent.com/gdsfactory/ubc/main/ubcpdk/gds/EBeam/ebeam_y_1550.gds",
	},
	{
		id: "tt02-fpga",
		url: "https://raw.githubusercontent.com/TinyTapeout/tinytapeout-02/tt02/gds/gatecat_fpga_top.gds.gz",
	},
	{
		id: "tt02-riscv",
		url: "https://raw.githubusercontent.com/TinyTapeout/tinytapeout-02/tt02/gds/gregdavill_serv_top.gds.gz",
	},
	{
		id: "tt02-clock",
		url: "https://raw.githubusercontent.com/TinyTapeout/tinytapeout-02/tt02/gds/gregdavill_clock_top.gds.gz",
	},
	{
		id: "asicone-sg13g2",
		url: "https://huggingface.co/datasets/jwt625/gdsii/resolve/main/sg13g2.gds",
	},
	{
		id: "superconducting-antennas",
		url: "https://huggingface.co/datasets/jwt625/gdsii/resolve/main/NTNAR04B_100nm_20210714.gds",
	},
];

const DEV_SERVER_URL = "http://localhost:5173";
const PREVIEW_WIDTH = 300;
const PREVIEW_HEIGHT = 200;
const RENDER_WAIT_MS = 2000; // Wait for render to complete

async function ensurePreviewsDir() {
	if (!fs.existsSync(PREVIEWS_DIR)) {
		fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
		console.log(`Created previews directory: ${PREVIEWS_DIR}`);
	}
}

async function generatePreview(browser, example) {
	console.log(`\nGenerating preview for: ${example.id}`);

	const page = await browser.newPage();

	// Set viewport to desired preview size (render at 2x for quality)
	await page.setViewport({
		width: PREVIEW_WIDTH * 2,
		height: PREVIEW_HEIGHT * 2,
		deviceScaleFactor: 1,
	});

	try {
		// Load the app with the example URL
		const appUrl = `${DEV_SERVER_URL}?url=${encodeURIComponent(example.url)}`;
		console.log(`  Loading: ${appUrl}`);

		await page.goto(appUrl, { waitUntil: "networkidle0", timeout: 60000 });

		// Wait for the canvas to be ready and file to load
		await page.waitForSelector("canvas", { timeout: 30000 });

		// Wait additional time for render to complete
		console.log(`  Waiting ${RENDER_WAIT_MS}ms for render...`);
		await new Promise((resolve) => setTimeout(resolve, RENDER_WAIT_MS));

		// Hide UI overlays for clean screenshot
		await page.evaluate(() => {
			// Hide any overlays, toolbars, etc.
			const elementsToHide = document.querySelectorAll(
				".toolbar, .overlay, .controls, .file-upload, .minimap-container, .scale-bar, .cell-tree-container",
			);
			elementsToHide.forEach((el) => {
				el.style.display = "none";
			});
		});

		// Take screenshot of the canvas
		const canvas = await page.$("canvas");
		if (canvas) {
			const outputPath = path.join(PREVIEWS_DIR, `${example.id}.png`);
			await canvas.screenshot({ path: outputPath });
			console.log(`  Saved: ${outputPath}`);
		} else {
			console.error(`  ERROR: Canvas not found for ${example.id}`);
		}
	} catch (error) {
		console.error(`  ERROR generating preview for ${example.id}:`, error.message);
	} finally {
		await page.close();
	}
}

async function main() {
	console.log("=".repeat(50));
	console.log("GDS Preview Generator");
	console.log("=".repeat(50));

	// Check if dev server is running
	try {
		const response = await fetch(DEV_SERVER_URL);
		if (!response.ok) throw new Error("Server not responding");
	} catch {
		console.error(`\nERROR: Dev server not running at ${DEV_SERVER_URL}`);
		console.error("Please start the dev server first: pnpm dev\n");
		process.exit(1);
	}

	await ensurePreviewsDir();

	console.log(`\nLaunching browser...`);
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
		// Let puppeteer find Chrome automatically (uses bundled Chromium or system Chrome)
		// Falls back to PUPPETEER_EXECUTABLE_PATH env var if set
	});

	try {
		for (const example of EXAMPLES) {
			await generatePreview(browser, example);
		}
	} finally {
		await browser.close();
	}

	console.log(`\n${"=".repeat(50)}`);
	console.log("Preview generation complete!");
	console.log(`Previews saved to: ${PREVIEWS_DIR}`);
	console.log(`${"=".repeat(50)}\n`);
}

main().catch(console.error);
