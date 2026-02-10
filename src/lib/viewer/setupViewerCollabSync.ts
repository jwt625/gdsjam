import type { SessionManager } from "../collaboration/SessionManager";
import type {
	CollaborativeViewportState,
	Comment,
	CommentPermissions,
	ParticipantViewport,
} from "../collaboration/types";
import type { PixiRenderer } from "../renderer/PixiRenderer";

export interface ViewerCollabSyncHandlers {
	onHostViewportChanged: (viewport: CollaborativeViewportState) => void;
	onBroadcastStateChanged: (enabled: boolean, hostId: string | null) => void;
	onParticipantViewportsChanged: (viewports: ParticipantViewport[]) => void;
	onViewportBlocked: () => void;
	onHostLayerVisibilityChanged: (visibility: { [key: string]: boolean }) => void;
	onLayerBroadcastStateChanged: (enabled: boolean, hostId: string | null) => void;
	onFullscreenStateChanged: (enabled: boolean, hostId: string | null) => void;
	onCommentsChanged: (comments: Comment[]) => void;
	onPermissionsChanged: (permissions: CommentPermissions) => void;
}

/**
 * Bind all collaboration sync callbacks for viewer runtime.
 * Keeps callback registration logic out of ViewerCanvas.
 */
export function setupViewerCollabSync(
	renderer: PixiRenderer,
	sessionManager: SessionManager,
	handlers: ViewerCollabSyncHandlers,
): void {
	sessionManager.setViewportSyncCallbacks({
		onHostViewportChanged: handlers.onHostViewportChanged,
		onBroadcastStateChanged: handlers.onBroadcastStateChanged,
		onParticipantViewportsChanged: handlers.onParticipantViewportsChanged,
	});

	renderer.setOnViewportBlocked(handlers.onViewportBlocked);

	const screen = renderer.getScreenDimensions();
	sessionManager.getViewportSync()?.setScreenDimensions(screen.width, screen.height);

	sessionManager.setLayerSyncCallbacks({
		onHostLayerVisibilityChanged: handlers.onHostLayerVisibilityChanged,
		onBroadcastStateChanged: handlers.onLayerBroadcastStateChanged,
	});

	sessionManager.setFullscreenSyncCallbacks({
		onFullscreenStateChanged: handlers.onFullscreenStateChanged,
	});

	sessionManager.setCommentSyncCallbacks({
		onCommentsChanged: handlers.onCommentsChanged,
		onPermissionsChanged: handlers.onPermissionsChanged,
	});
}
