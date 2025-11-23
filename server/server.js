const http = require('http');
const WebSocket = require('ws');
const url = require('url');

const PORT = process.env.PORT || 4444;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://gdsjam.com', 'http://localhost:5173', 'http://localhost:4173'];
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_CONNECTIONS = 10; // Max connections per IP per window

// Rate limiting: Track connections per IP
const connectionTracker = new Map();

// Create HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('GDSJam WebRTC Signaling Server\n');
});

// Create WebSocket server with noServer option for custom upgrade handling
const wss = new WebSocket.Server({ noServer: true });

// Track connections
let connectionCount = 0;

// Handle upgrade requests
server.on('upgrade', (req, socket, head) => {
  const clientIp = req.socket.remoteAddress;

  // 1. Origin check
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.log(`[${new Date().toISOString()}] Rejected connection from unauthorized origin: ${origin} (IP: ${clientIp})`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  // 2. Token authentication
  if (AUTH_TOKEN) {
    const queryParams = url.parse(req.url, true).query;
    const token = queryParams.token;

    if (token !== AUTH_TOKEN) {
      console.log(`[${new Date().toISOString()}] Rejected connection with invalid token from ${clientIp}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
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
  const recentConnections = ipConnections.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);

  if (recentConnections.length >= RATE_LIMIT_MAX_CONNECTIONS) {
    console.log(`[${new Date().toISOString()}] Rate limit exceeded for ${clientIp}`);
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }

  recentConnections.push(now);
  connectionTracker.set(clientIp, recentConnections);

  // All checks passed, upgrade to WebSocket
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  connectionCount++;
  const clientId = connectionCount;
  const clientIp = req.socket.remoteAddress;

  console.log(`[${new Date().toISOString()}] Client ${clientId} connected from ${clientIp}`);
  console.log(`Active connections: ${wss.clients.size}`);

  ws.on('message', (message) => {
    // Broadcast message to all other connected clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Client ${clientId} disconnected`);
    console.log(`Active connections: ${wss.clients.size}`);
  });

  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Client ${clientId} error:`, error.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}`);
  console.log(`Security configuration:`);
  console.log(`  - Token auth: ${AUTH_TOKEN ? 'ENABLED' : 'DISABLED (WARNING: anyone can connect!)'}`);
  console.log(`  - Origin checking: ENABLED (${ALLOWED_ORIGINS.length} allowed origins)`);
  console.log(`  - Rate limiting: ${RATE_LIMIT_MAX_CONNECTIONS} connections per IP per ${RATE_LIMIT_WINDOW / 1000}s`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
