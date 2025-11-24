/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_DEBUG: string;
	readonly VITE_MAX_POLYGONS_PER_RENDER: string;
	readonly VITE_FPS_UPDATE_INTERVAL: string;
	readonly VITE_SIGNALING_SERVER_URL: string;
	readonly VITE_SIGNALING_SERVER_TOKEN: string;
	readonly VITE_TURN_PASSWORD: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
