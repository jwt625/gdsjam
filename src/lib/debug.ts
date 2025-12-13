/**
 * Module-specific debug flags
 * Each module can be enabled/disabled independently via environment variables
 *
 * ALL FLAGS DEFAULT TO FALSE - must be explicitly enabled in .env.local
 *
 * Usage in code:
 *   import { DEBUG_PARSER } from '@/lib/debug';
 *   if (DEBUG_PARSER) console.log('[GDSParser] ...');
 *
 * Enable in .env.local (NOT in .env or committed files):
 *   VITE_DEBUG_PARSER=true
 *   VITE_DEBUG_RENDERER=true
 */

export const DEBUG_PARSER = import.meta.env.VITE_DEBUG_PARSER === "true" || false;
export const DEBUG_RENDERER = import.meta.env.VITE_DEBUG_RENDERER === "true" || false;
export const DEBUG_LOD = import.meta.env.VITE_DEBUG_LOD === "true" || false;
export const DEBUG_VIEWPORT = import.meta.env.VITE_DEBUG_VIEWPORT === "true" || false;
export const DEBUG_COLLABORATION = import.meta.env.VITE_DEBUG_COLLABORATION === "true" || false;
