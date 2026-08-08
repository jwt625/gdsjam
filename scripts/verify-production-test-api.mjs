import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const forbiddenMarkers = ["__GDSJAM_TEST__", "gdsjam:e2e-lifecycle", "fixture-load-started"];

async function filesBelow(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? filesBelow(path) : [path];
		}),
	);
	return nested.flat();
}

const emittedFiles = (await filesBelow("dist")).filter((path) =>
	[".html", ".js", ".css"].includes(extname(path)),
);
const leaks = [];
for (const path of emittedFiles) {
	const contents = await readFile(path, "utf8");
	for (const marker of forbiddenMarkers) {
		if (contents.includes(marker)) leaks.push(`${path}: ${marker}`);
	}
}

if (leaks.length > 0) {
	throw new Error(`Production build contains E2E test API markers:\n${leaks.join("\n")}`);
}
console.log(`Verified ${emittedFiles.length} production assets contain no E2E test API markers.`);
