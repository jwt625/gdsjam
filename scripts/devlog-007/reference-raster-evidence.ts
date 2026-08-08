#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
	type ReferenceRasterPolygon,
	rasterizeReference,
	serializeReferenceRaster,
} from "../../src/lib/testing/referenceRasterizer.ts";

function rectangle(
	id: string,
	layer: number,
	datatype: number,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): ReferenceRasterPolygon {
	return {
		id,
		layer,
		datatype,
		points: [
			{ x: minX, y: minY },
			{ x: maxX, y: minY },
			{ x: maxX, y: maxY },
			{ x: minX, y: maxY },
		],
	};
}

const request = {
	worldBounds: { minX: 0, minY: 0, maxX: 32, maxY: 16 },
	width: 32,
	height: 16,
	polygons: [
		rectangle("metal-wide", 1, 0, 2, 2, 18, 14),
		rectangle("metal-overlap", 1, 0, 12, 6, 24, 12),
		rectangle("via", 2, 0, 14, 7, 17, 10),
		rectangle("narrow-left", 3, 1, 26, 2, 27, 14),
		rectangle("narrow-right", 3, 1, 28, 2, 29, 14),
	],
} as const;

const outputPath = resolve(
	process.argv[2] ?? "DevLog/benchmarks/devlog-007/2026-08-08-reference-raster.json",
);
const raster = rasterizeReference(request);
const evidence = {
	fixture: "synthetic-overlap-and-one-dbu-gap",
	contract: {
		coordinateSpace: "integer GDS database-unit counts",
		comparison: "exact discrete raw masks",
		browserScreenshots: "out of scope; antialiased pixels require a separate tolerance policy",
	},
	result: serializeReferenceRaster(raster),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const iterations = 250;
const startedAt = performance.now();
for (let iteration = 0; iteration < iterations; iteration += 1) rasterizeReference(request);
const elapsedMs = performance.now() - startedAt;

process.stdout.write(
	`${JSON.stringify(
		{
			outputPath,
			width: request.width,
			height: request.height,
			polygons: request.polygons.length,
			combinedCoveredPixels: raster.combinedCoveredPixels,
			totalPolygonSamples: raster.totalPolygonSamples,
			iterations,
			elapsedMs: Number(elapsedMs.toFixed(3)),
			millisecondsPerRaster: Number((elapsedMs / iterations).toFixed(4)),
		},
		null,
		2,
	)}\n`,
);
