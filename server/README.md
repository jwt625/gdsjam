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

### 1. Token Authentication (WebSocket + API)

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

For REST APIs (`/api/files`, `/api/execute`), browser clients should request short-lived scoped tokens:

```bash
POST /api/auth/token
{ "scopes": ["files:read", "files:write"] }
```

These tokens are:
- scoped (`files:read`, `files:write`, `python:execute`)
- short-lived (default 5 minutes)
- bound to client IP

Long-lived `AUTH_TOKEN` is still accepted for operational backward compatibility.

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
- API token issuance is also rate-limited per IP (`API_TOKEN_RATE_LIMIT_*`)

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

## TURN Server

The TURN server (coturn) runs on the same OCI instance and enables WebRTC connections through NAT/firewalls.

### TURN Server Control

```bash
# Start the server
sudo systemctl start coturn

# Stop the server
sudo systemctl stop coturn

# Restart the server
sudo systemctl restart coturn

# Check status
sudo systemctl status coturn

# Enable auto-start on boot (already configured)
sudo systemctl enable coturn

# Disable auto-start on boot
sudo systemctl disable coturn
```

### TURN Server Logs

View logs using systemd journal:

```bash
# View recent logs
sudo journalctl -u coturn

# Follow logs in real-time
sudo journalctl -u coturn -f

# View logs from last 10 minutes
sudo journalctl -u coturn --since "10 minutes ago"

# View last 50 lines
sudo journalctl -u coturn -n 50
```

### TURN Server Configuration

Configuration file: `/etc/turnserver.conf`

Key settings:
- Listening ports: 3478 (UDP/TCP), 5349 (TLS)
- Relay ports: 49152-65535 (UDP)
- Domain: signaling.gdsjam.com
- SSL certificate: /etc/letsencrypt/live/signaling.gdsjam.com/

To modify configuration:
```bash
sudo nano /etc/turnserver.conf
sudo systemctl restart coturn
```

For setup details, see [DevLog-001-06-TURN-Server-Setup.md](../DevLog/DevLog-001-06-TURN-Server-Setup.md)

## Resource Usage

### Signaling Server
- **CPU**: ~1-5% for 100 concurrent users
- **RAM**: ~50-100MB
- **Bandwidth**: ~1-10KB per connection (signaling only)
- **Capacity**: 500-1000 concurrent users on a 1GB free-tier instance

### TURN Server
- **CPU**: Low (similar to signaling server)
- **RAM**: ~100-200MB baseline
- **Bandwidth**: Primary bottleneck (relays data when direct P2P fails)
- **Estimated Usage**: ~30GB/month for 20% relay rate
- **OCI Free Tier**: 10TB/month (sufficient for MVP)

## How it works

The signaling server implements **room-based message routing** for y-webrtc:

1. **Room Subscription**: Clients send `subscribe` messages with room names (topics)
2. **Message Publishing**: Clients send `publish` messages to specific rooms
3. **Targeted Broadcasting**: Server only forwards messages to clients in the same room
4. **Automatic Cleanup**: Empty rooms are removed when all clients leave

This ensures that WebRTC signaling messages (SDP offers/answers, ICE candidates) are only sent to peers in the same collaboration session, not to all connected clients.

After peers establish a direct WebRTC connection, the signaling server is no longer needed for data transfer. If direct connection fails due to NAT/firewall, the TURN server relays the data.
