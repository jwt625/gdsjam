#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "../..");
const outputPath = resolve(
	repositoryRoot,
	"artifacts/devlog-007/2026-08-08-complete-overview/overview-benchmark.json",
);

function diagnostics() {
	return {
		unsupportedElements: {},
		unsupported: { count: 0, details: [] },
		malformed: { count: 0, details: [] },
		unresolvedReferences: { count: 0, details: [] },
		referenceCycles: { count: 0, details: [] },
	};
}

function rectangle(id, minX, minY, maxX, maxY, layer) {
	return {
		id,
		layer,
		datatype: 0,
		points: [
			{ x: minX, y: minY },
			{ x: maxX, y: minY },
			{ x: maxX, y: maxY },
			{ x: minX, y: maxY },
		],
		boundingBox: { minX, minY, maxX, maxY },
	};
}

function fixture() {
	const columns = 8;
	const rows = 8;
	const pitch = 128;
	const leaf = {
		name: "LEAF",
		polygons: [
			rectangle("quarter-1", 8, 8, 56, 56, 1),
			rectangle("quarter-2", 64, 8, 112, 56, 2),
			rectangle("quarter-3", 8, 64, 56, 112, 3),
			rectangle("quarter-4", 64, 64, 112, 112, 4),
		],
		texts: [],
		instances: [],
		references: [],
		boundingBox: { minX: 8, minY: 8, maxX: 112, maxY: 112 },
		skipInMinimap: false,
	};
	const reference = {
		id: "source-aref",
		cellRef: "LEAF",
		x: 0,
		y: 0,
		rotation: 0,
		mirror: false,
		magnification: 1,
		arrayCols: columns,
		arrayRows: rows,
		arrayColumnVector: { x: columns * pitch, y: 0 },
		arrayRowVector: { x: 0, y: rows * pitch },
		boundingBox: { minX: 8, minY: 8, maxX: 1008, maxY: 1008 },
	};
	const top = {
		name: "TOP",
		polygons: [],
		texts: [],
		instances: [],
		references: [reference],
		boundingBox: reference.boundingBox,
		skipInMinimap: false,
	};
	const bounds = { minX: 0, minY: 0, maxX: 1024, maxY: 1024 };
	return {
		document: {
			name: "SYNTHETIC_OVERVIEW_BENCHMARK",
			cells: new Map([
				["LEAF", leaf],
				["TOP", top],
			]),
			layers: new Map(
				[1, 2, 3, 4].map((layer) => [
					`${layer}:0`,
					{ layer, datatype: 0, color: "#4a9eff", visible: true },
				]),
			),
			topCells: ["TOP"],
			boundingBox: bounds,
			units: { database: 1e-9, user: 1e-6 },
			diagnostics: diagnostics(),
		},
		scope: { topCellNames: ["TOP"], bounds },
	};
}

function percentile(values, fraction) {
	const sorted = [...values].sort((left, right) => left - right);
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sorted[lower];
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const vite = await createServer({
	root: repositoryRoot,
	appType: "custom",
	logLevel: "error",
	optimizeDeps: { noDiscovery: true },
	server: { middlewareMode: true },
});
try {
	const { generateCompleteOverview } = await vite.ssrLoadModule(
		"/src/lib/renderer/overview/CompleteOverview.ts",
	);
	const { document, scope } = fixture();
	const cases = [];
	for (const physicalSizePx of [128, 256, 512]) {
		for (const devicePixelRatio of [1, 2]) {
			const samples = [];
			let lastArtifact = generateCompleteOverview(document, scope, {
				cssSizePx: physicalSizePx / devicePixelRatio,
				devicePixelRatio,
			});
			for (let repeat = 0; repeat < 5; repeat++) {
				const startedAt = performance.now();
				lastArtifact = generateCompleteOverview(document, scope, {
					cssSizePx: physicalSizePx / devicePixelRatio,
					devicePixelRatio,
				});
				samples.push(performance.now() - startedAt);
			}
			if (!lastArtifact.telemetry.complete) throw new Error("Benchmark artifact was incomplete");
			if (
				lastArtifact.telemetry.physicalWidth !== physicalSizePx ||
				lastArtifact.telemetry.physicalHeight !== physicalSizePx
			) {
				throw new Error("Benchmark physical dimensions do not match the requested case");
			}
			cases.push({
				physicalSizePx,
				devicePixelRatio,
				cssSizePx: physicalSizePx / devicePixelRatio,
				generationTimeMs: {
					median: percentile(samples, 0.5),
					min: Math.min(...samples),
					max: Math.max(...samples),
				},
				byteLength: lastArtifact.telemetry.byteLength,
				occupiedLayerPixels: lastArtifact.telemetry.occupiedLayerPixels,
				polygonOccurrences: lastArtifact.telemetry.polygonOccurrences,
				rawSamplesMs: samples,
			});
		}
	}
	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		runtime: { node: process.version, platform: process.platform, architecture: process.arch },
		workload: {
			description: "8x8 compact AREF; four canonical rectangles/layers per placement",
			logicalPolygonOccurrences: 256,
			worldBoundsDBU: scope.bounds,
			repeatsPerCase: 5,
		},
		cases,
	};
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
	await vite.close();
}
