/**
 * Application configuration and constants
 * Loaded from environment variables (.env files)
 */

/**
 * Debug mode - enables verbose console logging
 * Controlled by VITE_DEBUG environment variable
 * Default: false (must be explicitly enabled via VITE_DEBUG=true)
 */
export const DEBUG = import.meta.env.VITE_DEBUG === "true";

/**
 * Maximum number of polygons to render per frame (prevents OOM)
 * Controlled by VITE_MAX_POLYGONS_PER_RENDER environment variable
 * Default: 100,000
 */
export const MAX_POLYGONS_PER_RENDER = Number(
	import.meta.env.VITE_MAX_POLYGONS_PER_RENDER || 100_000,
);

/**
 * FPS counter update interval in milliseconds
 * Controlled by VITE_FPS_UPDATE_INTERVAL environment variable
 * Default: 500ms
 */
export const FPS_UPDATE_INTERVAL = Number(import.meta.env.VITE_FPS_UPDATE_INTERVAL || 500);

/**
 * LOD (Level of Detail) Configuration
 */

// LOD thresholds (percentage of MAX_POLYGONS_PER_RENDER)
export const LOD_INCREASE_THRESHOLD = 0.3; // Increase depth if < 30% budget
export const LOD_DECREASE_THRESHOLD = 0.9; // Decrease depth if > 90% budget

// LOD hysteresis (milliseconds)
export const LOD_CHANGE_COOLDOWN = 1000; // Min time between depth changes

// LOD zoom thresholds (significant zoom changes only)
export const LOD_ZOOM_OUT_THRESHOLD = 0.2; // Trigger LOD update at 0.2x zoom (5x zoom out)
export const LOD_ZOOM_IN_THRESHOLD = 2.0; // Trigger LOD update at 2.0x zoom (2x zoom in)

// LOD depth limits
export const LOD_MIN_DEPTH = 0;
export const LOD_MAX_DEPTH = 3; // Limit to 3 to prevent instance explosion (until proper cell instancing is implemented)

/**
 * Spatial Tiling Configuration
 * Layers are split into tiles for efficient viewport culling
 */
export const SPATIAL_TILE_SIZE = Number(import.meta.env.VITE_SPATIAL_TILE_SIZE || 1_000_000); // 1mm in db units (assuming 1 db unit = 1nm)

/**
 * Polygon Rendering Configuration
 */
export const POLYGON_FILL_MODE = true; // true = filled polygons, false = outline only

/**
 * Zoom Limits Configuration
 * Limits are defined by scale bar width in micrometers
 * - Max zoom (zoomed in): scale bar shows 1 nm
 * - Min zoom (zoomed out): scale bar shows 1 m
 */
export const MIN_ZOOM_SCALE_BAR_MICROMETERS = 1_000_000; // 1 m = 1,000,000 µm (max zoom out)
export const MAX_ZOOM_SCALE_BAR_MICROMETERS = 0.001; // 1 nm = 0.001 µm (max zoom in)

/**
 * Hierarchical File Detection Configuration
 * A GDS file is considered hierarchical if top cells have instances but very few polygons.
 * This threshold determines "very few" - if top cells have fewer than this many polygons
 * but have instances, we start rendering at a higher depth to show content immediately.
 */
export const HIERARCHICAL_POLYGON_THRESHOLD = 10;
