#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "../..");
const artifactDirectory = path.join(root, "artifacts/devlog-007/2026-08-08-correctness-foundation");
const fixture = path.join(root, "tests/fixtures/devlog-007/non_default_dbu.gds");
const url = process.env.GDSJAM_URL ?? "http://127.0.0.1:5173";

await fs.mkdir(artifactDirectory, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on("console", (message) => {
	if (message.type() === "error") consoleErrors.push(message.text());
});

const startedAt = performance.now();
try {
	await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
	await page.$$eval("button", (buttons) => {
		const welcomeDismiss = buttons.find((button) => button.textContent?.trim() === "Got it!");
		welcomeDismiss?.click();
	});
	const fileInput = await page.$('input[type="file"]');
	if (!fileInput) throw new Error("File input was not found");
	await fileInput.uploadFile(fixture);
	await page.waitForSelector(".render-warning", { visible: true, timeout: 30_000 });
	await page.waitForFunction(() => !document.querySelector(".loading-overlay"), {
		timeout: 30_000,
	});

	const warning = await page.$eval(".render-warning", (element) => element.textContent?.trim());
	const elapsedMilliseconds = performance.now() - startedAt;
	const screenshot = path.join(artifactDirectory, "partial-render-warning.png");
	await page.screenshot({ path: screenshot, fullPage: true });

	const evidence = {
		schemaVersion: 1,
		fixture: path.relative(root, fixture),
		configuration: { maxPolygonsPerRender: 1, viewport: [1440, 900], deviceScaleFactor: 1 },
		warning,
		elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(1)),
		consoleErrors,
		screenshot: path.relative(root, screenshot),
	};
	await fs.writeFile(
		path.join(artifactDirectory, "partial-render-warning.json"),
		`${JSON.stringify(evidence, null, 2)}\n`,
		"utf8",
	);
	console.log(JSON.stringify(evidence, null, 2));
} finally {
	await browser.close();
}
