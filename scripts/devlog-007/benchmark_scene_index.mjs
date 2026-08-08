#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "../..");
const defaultOutput = resolve(
	repositoryRoot,
	"artifacts/devlog-007/2026-08-08-scene-index/scene-index-benchmark.json",
);
const scenarios = ["legacy-expanded", "current-compatibility", "compact-canonical"];

function argument(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

function emptyDiagnostics() {
	return {
		unsupportedElements: {},
		unsupported: { count: 0, details: [] },
		malformed: { count: 0, details: [] },
		unresolvedReferences: { count: 0, details: [] },
		referenceCycles: { count: 0, details: [] },
	};
}

function leafPolygon() {
	return {
		id: "leaf-boundary",
		layer: 1,
		datatype: 0,
		points: [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		],
		boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
	};
}

function expandedInstance(ordinal, columns, columnPitch, rowPitch) {
	const column = ordinal % columns;
	const row = Math.floor(ordinal / columns);
	const x = column * columnPitch;
	const y = row * rowPitch;
	return {
		id: `legacy:${ordinal}`,
		cellRef: "LEAF",
		x,
		y,
		rotation: 0,
		mirror: false,
		magnification: 1,
		boundingBox: { minX: x, minY: y, maxX: x + 10, maxY: y + 10 },
	};
}

function compactReference(columns, rows, columnPitch, rowPitch) {
	return {
		id: "source-aref:0",
		cellRef: "LEAF",
		x: 0,
		y: 0,
		rotation: 0,
		mirror: false,
		magnification: 1,
		arrayCols: columns,
		arrayRows: rows,
		// GDS AREF endpoints encode count * pitch, not (count - 1) * pitch.
		arrayColumnVector: { x: columns * columnPitch, y: 0 },
		arrayRowVector: { x: 0, y: rows * rowPitch },
		boundingBox: {
			minX: 0,
			minY: 0,
			maxX: (columns - 1) * columnPitch + 10,
			maxY: (rows - 1) * rowPitch + 10,
		},
	};
}

function constructDocument(scenario, columns, rows) {
	const placementCount = columns * rows;
	const columnPitch = 20;
	const rowPitch = 30;
	const includesLegacy = scenario !== "compact-canonical";
	const includesCompact = scenario !== "legacy-expanded";
	const instances = includesLegacy
		? Array.from({ length: placementCount }, (_, ordinal) =>
				expandedInstance(ordinal, columns, columnPitch, rowPitch),
			)
		: [];
	const reference = compactReference(columns, rows, columnPitch, rowPitch);
	const top = {
		name: "TOP",
		polygons: [],
		texts: [],
		instances,
		boundingBox: reference.boundingBox,
		skipInMinimap: false,
	};
	if (includesCompact) top.references = [reference];
	const leaf = {
		name: "LEAF",
		polygons: [leafPolygon()],
		texts: [],
		instances: [],
		references: [],
		boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
		skipInMinimap: false,
	};
	return {
		name: `SYNTHETIC_${scenario}`,
		cells: new Map([
			["LEAF", leaf],
			["TOP", top],
		]),
		layers: new Map(),
		topCells: ["TOP"],
		boundingBox: reference.boundingBox,
		units: { database: 1e-9, user: 1e-6 },
		diagnostics: emptyDiagnostics(),
	};
}

function forceGc() {
	if (typeof globalThis.gc !== "function") {
		throw new Error("Benchmark workers require node --expose-gc");
	}
	for (let pass = 0; pass < 3; pass++) globalThis.gc();
}

function jsonBytes(value) {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

async function runWorker() {
	const scenario = argument("--scenario");
	const columns = Number(argument("--columns", "1000"));
	const rows = Number(argument("--rows", "100"));
	if (!scenarios.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);

	const vite = await createServer({
		root: repositoryRoot,
		appType: "custom",
		logLevel: "error",
		server: { middlewareMode: true },
	});
	const { createLayoutSceneIndex } = await vite.ssrLoadModule(
		"/src/lib/layout/LayoutSceneIndex.ts",
	);
	forceGc();
	const baselineHeapBytes = process.memoryUsage().heapUsed;

	const documentStart = performance.now();
	const document = constructDocument(scenario, columns, rows);
	const documentConstructionMs = performance.now() - documentStart;
	forceGc();
	const documentHeapBytes = process.memoryUsage().heapUsed;
	const top = document.cells.get("TOP");
	const sourceRepresentationBytes = jsonBytes({
		instances: top.instances,
		references: top.references,
	});

	const indexStart = performance.now();
	const index = createLayoutSceneIndex(document);
	const indexConstructionMs = performance.now() - indexStart;
	forceGc();
	const indexedHeapBytes = process.memoryUsage().heapUsed;
	const indexedTop = index.cells.get("TOP");
	const result = {
		scenario,
		counts: {
			logicalPlacements: columns * rows,
			legacyInstances: top.instances.length,
			compactSourceReferences: top.references?.length ?? 0,
			sceneIndexReferences: indexedTop.references.length,
			canonicalPolygons: [...index.cells.values()].reduce(
				(total, cell) => total + cell.polygons.length,
				0,
			),
		},
		timingMs: {
			documentConstruction: documentConstructionMs,
			sceneIndexConstruction: indexConstructionMs,
		},
		memoryBytes: {
			baselineHeap: baselineHeapBytes,
			documentRetainedHeapDelta: documentHeapBytes - baselineHeapBytes,
			indexIncrementalRetainedHeapDelta: indexedHeapBytes - documentHeapBytes,
			totalRetainedHeapDelta: indexedHeapBytes - baselineHeapBytes,
			sourceRepresentationJson: sourceRepresentationBytes,
		},
		bounds: index.aggregateBounds,
		buildStatistics: index.buildStatistics,
	};
	globalThis.__sceneIndexBenchmarkRetained = { document, index };
	await vite.close();
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

function percentile(values, fraction) {
	const ordered = [...values].sort((left, right) => left - right);
	const position = (ordered.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return ordered[lower];
	return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function summarize(values) {
	return {
		median: percentile(values, 0.5),
		min: Math.min(...values),
		max: Math.max(...values),
	};
}

function summarizeRuns(runs) {
	const first = runs[0];
	return {
		counts: first.counts,
		bounds: first.bounds,
		buildStatistics: first.buildStatistics,
		timingMs: {
			documentConstruction: summarize(runs.map((run) => run.timingMs.documentConstruction)),
			sceneIndexConstruction: summarize(runs.map((run) => run.timingMs.sceneIndexConstruction)),
		},
		memoryBytes: {
			documentRetainedHeapDelta: summarize(
				runs.map((run) => run.memoryBytes.documentRetainedHeapDelta),
			),
			indexIncrementalRetainedHeapDelta: summarize(
				runs.map((run) => run.memoryBytes.indexIncrementalRetainedHeapDelta),
			),
			totalRetainedHeapDelta: summarize(runs.map((run) => run.memoryBytes.totalRetainedHeapDelta)),
			sourceRepresentationJson: first.memoryBytes.sourceRepresentationJson,
		},
	};
}

function validateRun(run, scenario, placementCount, expectedBounds) {
	const expectedLegacy = scenario === "compact-canonical" ? 0 : placementCount;
	const expectedCompact = scenario === "legacy-expanded" ? 0 : 1;
	const expectedIndex = scenario === "legacy-expanded" ? placementCount : 1;
	const checks = [
		[run.counts.logicalPlacements === placementCount, "logical placement count"],
		[run.counts.legacyInstances === expectedLegacy, "legacy instance count"],
		[run.counts.compactSourceReferences === expectedCompact, "compact source count"],
		[run.counts.sceneIndexReferences === expectedIndex, "scene-index reference count"],
		[run.counts.canonicalPolygons === 1, "canonical polygon count"],
		[JSON.stringify(run.bounds) === JSON.stringify(expectedBounds), "aggregate bounds"],
	];
	for (const [valid, description] of checks) {
		if (!valid) throw new Error(`${scenario} failed invariant: ${description}`);
	}
}

async function runCoordinator() {
	const repeats = Number(argument("--repeats", "7"));
	const columns = Number(argument("--columns", "1000"));
	const rows = Number(argument("--rows", "100"));
	const output = resolve(repositoryRoot, argument("--output", defaultOutput));
	if (!Number.isInteger(repeats) || repeats < 3) throw new Error("--repeats must be >= 3");
	if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
		throw new Error("--columns and --rows must be positive integers");
	}

	const rawRuns = {};
	const expectedBounds = {
		minX: 0,
		minY: 0,
		maxX: (columns - 1) * 20 + 10,
		maxY: (rows - 1) * 30 + 10,
	};
	for (const scenario of scenarios) {
		rawRuns[scenario] = [];
		for (let repeat = 0; repeat < repeats; repeat++) {
			const worker = spawnSync(
				process.execPath,
				[
					"--expose-gc",
					scriptPath,
					"--worker",
					"--scenario",
					scenario,
					"--columns",
					String(columns),
					"--rows",
					String(rows),
				],
				{ cwd: repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
			);
			if (worker.status !== 0) {
				throw new Error(
					`Worker ${scenario} run ${repeat + 1} failed:\n${worker.stderr || worker.stdout}`,
				);
			}
			const run = JSON.parse(worker.stdout.trim());
			validateRun(run, scenario, columns * rows, expectedBounds);
			rawRuns[scenario].push(run);
		}
	}

	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		environment: {
			platform: process.platform,
			architecture: process.arch,
			node: process.version,
		},
		workload: {
			kind: "synthetic-rectangular-aref",
			columns,
			rows,
			logicalPlacements: columns * rows,
			leafPolygons: 1,
			repeats,
		},
		methodology: {
			processIsolation: "fresh Node/Vite process per scenario repeat",
			garbageCollection: "three forced full-GC requests before each retained-heap sample",
			timing: "performance.now wall clock; median/min/max",
			memory:
				"V8 heapUsed deltas after forced GC plus deterministic UTF-8 JSON byte proxy; excludes native/runtime overhead and is not a browser peak-memory measurement",
			memoryNoise:
				"negative or very small retained-heap deltas mean the allocation is below this process-level measurement's noise floor",
			parserScope:
				"programmatic documents only; current-compatibility intentionally retains eager legacy expansion, so results do not claim parser-memory improvement",
		},
		scenarios: Object.fromEntries(
			scenarios.map((scenario) => [scenario, summarizeRuns(rawRuns[scenario])]),
		),
		rawRuns,
	};
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`${output}\n`);
}

if (process.argv.includes("--worker")) {
	await runWorker();
} else {
	await runCoordinator();
}
