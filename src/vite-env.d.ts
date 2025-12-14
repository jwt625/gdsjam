/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_DEBUG: string;
	readonly VITE_MAX_POLYGONS_PER_RENDER: string;
	readonly VITE_FPS_UPDATE_INTERVAL: string;
	readonly VITE_SIGNALING_SERVER_URL: string;
	readonly VITE_SIGNALING_SERVER_TOKEN: string;
	readonly VITE_TURN_PASSWORD: string;
	// Module-specific debug flags
	readonly VITE_DEBUG_PARSER?: string;
	readonly VITE_DEBUG_RENDERER?: string;
	readonly VITE_DEBUG_LOD?: string;
	readonly VITE_DEBUG_VIEWPORT?: string;
	readonly VITE_DEBUG_COLLABORATION?: string;
	readonly VITE_DEBUG_EDITOR_LAYOUT?: string;
	readonly VITE_DEBUG_CODE_EDITOR?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
