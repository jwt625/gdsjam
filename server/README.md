# GDSJam WebRTC Signaling Server

WebRTC signaling server for GDSJam collaborative features.

## What it does

A lightweight relay server that helps WebRTC peers discover each other and exchange connection information. The actual file data transfers happen peer-to-peer via WebRTC - this server only handles the initial handshake.

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment variables
cp .env.example .env
# Edit .env and set your AUTH_TOKEN

# Run the server (foreground)
pnpm start

# Run the server in background with logs
pnpm start:bg

# Stop the background server
pnpm stop
```

The server will start on port 4444 by default. You can change this with the `PORT` environment variable:

```bash
PORT=8080 pnpm start
```

## Security Configuration

The server implements three layers of security:

### 1. Token Authentication

Set an `AUTH_TOKEN` in your `.env` file:

```bash
# Generate a secure token
openssl rand -hex 32

# Add to .env
AUTH_TOKEN=your-generated-token-here
```

Clients must include the token in the WebSocket URL:
```javascript
ws://your-server:4444?token=your-generated-token-here
```

**Note**: Since GDSJam is a client-side app, the token will be visible in the client code. This provides basic protection against casual abuse but is not fully secure. Anyone inspecting the client code can extract the token.

### 2. Origin Checking

The server only accepts connections from allowed origins:
- `https://gdsjam.com` (production)
- `http://localhost:5173` (Vite dev server)
- `http://localhost:4173` (Vite preview)

Customize in `.env`:
```bash
ALLOWED_ORIGINS=https://gdsjam.com,https://yourdomain.com
```

### 3. Rate Limiting

Protects against DoS attacks:
- **Default**: 10 connections per IP per minute
- Configurable in `server.js` (RATE_LIMIT_WINDOW, RATE_LIMIT_MAX_CONNECTIONS)

### Security Limitations

⚠️ **Important**: This is not enterprise-grade security. The token-based auth provides basic protection but can be bypassed by anyone who:
- Views the client source code
- Intercepts network traffic
- Reverse-engineers the WebSocket connection

For a public deployment, this prevents:
- Casual discovery and abuse
- Basic automated attacks
- Accidental misuse

It does NOT prevent:
- Determined attackers
- Token extraction from client code

### Background Execution

When running in background mode with `pnpm start:bg`:
- Server runs as a background process
- Logs are saved to `logs/server_YYYYMMDD_HHMMSS.log`
- Process ID is saved to `.server.pid`
- View logs in real-time: `tail -f logs/server_*.log`
- Stop the server: `pnpm stop`

## Testing

Test the server with wscat:

```bash
# Install wscat
npm install -g wscat

# Connect to the server
wscat -c ws://localhost:4444
```

Or test in browser console:

```javascript
const ws = new WebSocket('ws://localhost:4444');
ws.onopen = () => console.log('Connected!');
ws.onmessage = (e) => console.log('Message:', e.data);
ws.send('test message');
```

## Deployment

See [DevLog-001-05-WebRTC-Signaling-Server-Setup-Guide.md](../DevLog/DevLog-001-05-WebRTC-Signaling-Server-Setup-Guide.md) for detailed deployment instructions including:

- OCI instance setup
- PM2 process management
- SSL/TLS with Nginx
- Monitoring and troubleshooting

## Resource Usage

- **CPU**: ~1-5% for 100 concurrent users
- **RAM**: ~50-100MB
- **Bandwidth**: ~1-10KB per connection (signaling only)
- **Capacity**: 500-1000 concurrent users on a 1GB free-tier instance

## How it works

The server broadcasts WebRTC signaling messages (SDP offers/answers, ICE candidates) to all connected peers. Each peer filters messages meant for them based on the WebRTC protocol.

After peers establish a direct WebRTC connection, the signaling server is no longer needed for data transfer.
