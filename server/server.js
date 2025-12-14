require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");
const url = require("url");
const { setupFileRoutes, getOpenAPISpec } = require("./fileStorage");
const { setupPythonRoutes } = require("./pythonExecutor");

const PORT = process.env.PORT || 4444;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
	? process.env.ALLOWED_ORIGINS.split(",")
	: ["https://gdsjam.com", "http://localhost:5173", "http://localhost:4173"];
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || "60000", 10); // 1 minute default
const RATE_LIMIT_MAX_CONNECTIONS = parseInt(process.env.RATE_LIMIT_MAX_CONNECTIONS || "10", 10); // Max connections per IP per window

// Rate limiting: Track connections per IP
const connectionTracker = new Map();

// Room management: Track which clients are in which rooms
// Map<roomName, Set<WebSocket>>
const rooms = new Map();

// Create Express app
const app = express();

// Configure CORS
app.use(
	cors({
		origin: ALLOWED_ORIGINS,
		credentials: true,
	}),
);

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup file storage routes
setupFileRoutes(app);

// Setup Python execution routes
setupPythonRoutes(app);

// OpenAPI documentation endpoints
app.get("/api/openapi.json", (req, res) => {
	res.json(getOpenAPISpec());
});

app.get("/api/docs", (req, res) => {
	res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>GDSJam API Documentation</title>
	<link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
	<style>
		body { margin: 0; padding: 0; }
	</style>
</head>
<body>
	<div id="swagger-ui"></div>
	<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
	<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
	<script>
		window.onload = function() {
			SwaggerUIBundle({
				url: "/api/openapi.json",
				dom_id: '#swagger-ui',
				deepLinking: true,
				presets: [
					SwaggerUIBundle.presets.apis,
					SwaggerUIStandalonePreset
				],
				plugins: [
					SwaggerUIBundle.plugins.DownloadUrl
				],
				layout: "StandaloneLayout"
			});
		};
	</script>
</body>
</html>
	`);
});

// Default route for HTTP requests
app.get("/", (req, res) => {
	res.send("GDSJam WebRTC Signaling Server\n");
});

// Create HTTP server with Express app
const server = http.createServer(app);

// Create WebSocket server with noServer option for custom upgrade handling
const wss = new WebSocket.Server({ noServer: true });

// Track connections
let connectionCount = 0;

// Handle upgrade requests
server.on("upgrade", (req, socket, head) => {
	const clientIp = req.socket.remoteAddress;

	// 1. Origin check
	const origin = req.headers.origin;
	if (origin && !ALLOWED_ORIGINS.includes(origin)) {
		console.log(
			`[${new Date().toISOString()}] Rejected connection from unauthorized origin: ${origin} (IP: ${clientIp})`,
		);
		socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
		socket.destroy();
		return;
	}

	// 2. Token authentication
	if (AUTH_TOKEN) {
		const queryParams = url.parse(req.url, true).query;
		const token = queryParams.token;

		if (token !== AUTH_TOKEN) {
			console.log(
				`[${new Date().toISOString()}] Rejected connection with invalid token from ${clientIp}`,
			);
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}
	}

	// 3. Rate limiting
	const now = Date.now();
	if (!connectionTracker.has(clientIp)) {
		connectionTracker.set(clientIp, []);
	}

	const ipConnections = connectionTracker.get(clientIp);
	// Remove old connection timestamps outside the window
	const recentConnections = ipConnections.filter(
		(timestamp) => now - timestamp < RATE_LIMIT_WINDOW,
	);

	if (recentConnections.length >= RATE_LIMIT_MAX_CONNECTIONS) {
		console.log(`[${new Date().toISOString()}] Rate limit exceeded for ${clientIp}`);
		socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
		socket.destroy();
		return;
	}

	recentConnections.push(now);
	connectionTracker.set(clientIp, recentConnections);

	// All checks passed, upgrade to WebSocket
	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit("connection", ws, req);
	});
});

wss.on("connection", (ws, req) => {
	connectionCount++;
	const clientId = connectionCount;
	const clientIp = req.socket.remoteAddress;

	console.log(`[${new Date().toISOString()}] Client ${clientId} connected from ${clientIp}`);
	console.log(`Active connections: ${wss.clients.size}`);

	// Track which rooms this client is in
	ws.rooms = new Set();

	ws.on("message", (data) => {
		try {
			// Parse y-webrtc signaling message
			// subscribe/unsubscribe: { type: 'subscribe' | 'unsubscribe', topics: [roomName, ...] }
			// publish: { type: 'publish', topic: roomName, ...data }
			// ping: { type: 'ping' }
			const message = JSON.parse(data);

			// Log all message types for debugging
			console.log(
				`[${new Date().toISOString()}] Client ${clientId} sent message type: ${message.type}`,
			);

			// Handle room subscription (y-webrtc 'subscribe' message)
			if (message.type === "subscribe" && Array.isArray(message.topics)) {
				for (const topic of message.topics) {
					// Add client to room
					if (!rooms.has(topic)) {
						rooms.set(topic, new Set());
					}
					rooms.get(topic).add(ws);
					ws.rooms.add(topic);
					console.log(
						`[${new Date().toISOString()}] Client ${clientId} subscribed to room: ${topic}`,
					);
					console.log(`  Room ${topic} now has ${rooms.get(topic).size} clients`);
				}
			}

			// Handle room unsubscription (y-webrtc 'unsubscribe' message)
			if (message.type === "unsubscribe" && Array.isArray(message.topics)) {
				for (const topic of message.topics) {
					if (rooms.has(topic)) {
						rooms.get(topic).delete(ws);
						ws.rooms.delete(topic);
						console.log(
							`[${new Date().toISOString()}] Client ${clientId} unsubscribed from room: ${topic}`,
						);
						// Clean up empty rooms
						if (rooms.get(topic).size === 0) {
							rooms.delete(topic);
							console.log(`  Room ${topic} is now empty and removed`);
						} else {
							console.log(`  Room ${topic} now has ${rooms.get(topic).size} clients`);
						}
					}
				}
			}

			// Handle message publishing (y-webrtc 'publish' message)
			// Note: publish uses 'topic' (singular), not 'topics' (plural)
			if (message.type === "publish" && message.topic) {
				const topic = message.topic;
				if (rooms.has(topic)) {
					const receivers = rooms.get(topic);
					// Add client count to message (like official y-webrtc server)
					message.clients = receivers.size;
					const messageStr = JSON.stringify(message);

					// Broadcast to all clients in the room (including sender)
					for (const client of receivers) {
						if (client.readyState === WebSocket.OPEN) {
							client.send(messageStr);
						}
					}

					console.log(
						`[${new Date().toISOString()}] Client ${clientId} published to ${receivers.size} clients in room: ${topic}`,
					);
				}
			}

			// Handle ping message
			if (message.type === "ping") {
				ws.send(JSON.stringify({ type: "pong" }));
			}
		} catch (error) {
			// If message is not JSON or doesn't match y-webrtc format, log and ignore
			console.error(
				`[${new Date().toISOString()}] Client ${clientId} sent invalid message:`,
				error.message,
			);
		}
	});

	ws.on("close", () => {
		// Remove client from all rooms
		for (const topic of ws.rooms) {
			if (rooms.has(topic)) {
				rooms.get(topic).delete(ws);
				if (rooms.get(topic).size === 0) {
					rooms.delete(topic);
				}
			}
		}
		console.log(`[${new Date().toISOString()}] Client ${clientId} disconnected`);
		console.log(`Active connections: ${wss.clients.size}`);
	});

	ws.on("error", (error) => {
		console.error(`[${new Date().toISOString()}] Client ${clientId} error:`, error.message);
	});
});

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Signaling server running on port ${PORT}`);
	console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}`);
	console.log(`Security configuration:`);
	console.log(
		`  - Token auth: ${AUTH_TOKEN ? "ENABLED" : "DISABLED (WARNING: anyone can connect!)"}`,
	);
	console.log(`  - Origin checking: ENABLED (${ALLOWED_ORIGINS.length} allowed origins)`);
	console.log(
		`  - Rate limiting: ${RATE_LIMIT_MAX_CONNECTIONS} connections per IP per ${RATE_LIMIT_WINDOW / 1000}s`,
	);
});

// Graceful shutdown
process.on("SIGTERM", () => {
	console.log("SIGTERM received, closing server...");
	server.close(() => {
		console.log("Server closed");
		process.exit(0);
	});
});
