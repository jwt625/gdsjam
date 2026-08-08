const version = import.meta.env.VITE_APP_VERSION || "dev";
const commit = import.meta.env.VITE_BUILD_SHA || "";
const releaseUrl = import.meta.env.VITE_RELEASE_URL || "";

export const BUILD_INFO = Object.freeze({
	version,
	commit,
	shortCommit: commit.slice(0, 7),
	releaseUrl,
});
