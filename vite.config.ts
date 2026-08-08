import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";

function buildMetadataPlugin(): Plugin {
	return {
		name: "gdsjam-build-metadata",
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "version.json",
				source: `${JSON.stringify(
					{
						version: process.env.VITE_APP_VERSION || "dev",
						commit: process.env.VITE_BUILD_SHA || "",
						releaseUrl: process.env.VITE_RELEASE_URL || "",
					},
					null,
					2,
				)}\n`,
			});
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte(), buildMetadataPlugin()],
	// Use / for custom domain (gdsjam.com)
	base: "/",
	// Monaco Editor worker configuration
	optimizeDeps: {
		include: ["monaco-editor"],
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					monaco: ["monaco-editor"],
				},
			},
		},
	},
});
