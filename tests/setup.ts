/**
 * Vitest setup file
 * Runs before all tests
 */

import { beforeAll, vi } from "vitest";

// Mock import.meta.env for config.ts
beforeAll(() => {
	// Set default environment variables for tests
	vi.stubGlobal("import.meta", {
		env: {
			VITE_DEBUG: "false",
			VITE_MAX_POLYGONS_PER_RENDER: "100000",
			VITE_FPS_UPDATE_INTERVAL: "500",
			VITE_SPATIAL_TILE_SIZE: "1000000",
			DEV: false,
			MODE: "test",
		},
	});
});
