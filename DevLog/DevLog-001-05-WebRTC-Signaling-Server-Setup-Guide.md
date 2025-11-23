# WebRTC Signaling Server Setup Guide

## What is a Signaling Server?

A signaling server helps WebRTC peers **discover each other** and **exchange connection information**. It's a lightweight relay that:
- Forwards initial handshake messages between peers
- Does NOT transfer actual file data (that goes peer-to-peer via WebRTC)
- Only needed during connection establishment
- Very low resource usage after peers connect

## Estimated Load & Resource Requirements

### Resource Usage:
- **CPU**: Very low (~1-5% for 100 concurrent users)
- **RAM**: Minimal (~50-100MB for the Node.js process)
- **Bandwidth**: Low (only signaling messages, ~1-10KB per connection)
- **Network**: WebSocket connections (persistent but idle most of the time)

### Scaling Estimates:
- **Free OCI instance** (1 OCPU, 1GB RAM): Can handle **500-1000 concurrent users** easily
- **Bottleneck**: Network connections, not CPU/RAM
- **After peers connect**: Server load drops to near zero (just keepalive pings)

### Why OCI Free Tier is Perfect:
✅ Always-free ARM instance (4 OCPUs, 24GB RAM) - massive overkill for signaling  
✅ Always-free AMD instance (1 OCPU, 1GB RAM) - still plenty for signaling  
✅ 10TB/month outbound bandwidth - more than enough  
✅ Static public IP included  
✅ Can run alongside other services without issues  

**Verdict**: Yes, a free OCI instance can easily handle your signaling server + other services!

---

## Setup Instructions for OCI Instance

### Prerequisites:
- OCI instance running (Ubuntu/Debian/Oracle Linux)
- SSH access to the instance
- Domain name (optional, but recommended for SSL)
- Port 4444 open in OCI security list

---

## Step 1: Prepare Your OCI Instance

### 1.1 SSH into your instance:
```bash
ssh ubuntu@<your-oci-instance-ip>
```

### 1.2 Install Node.js (if not already installed):
```bash
# Using NodeSource repository for latest LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should show v20.x or v18.x
npm --version
```

### 1.3 Open firewall port 4444:
```bash
# On the instance itself
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 4444 -j ACCEPT
sudo netfilter-persistent save

# Also add to OCI Security List via web console:
# Networking > Virtual Cloud Networks > Your VCN > Security Lists
# Add Ingress Rule: 0.0.0.0/0, TCP, Port 4444
```

---

## Step 2: Create the Signaling Server

### 2.1 Create project directory:
```bash
mkdir -p ~/signaling-server
cd ~/signaling-server
```

### 2.2 Initialize Node.js project:
```bash
npm init -y
```

### 2.3 Install dependencies:
```bash
npm install ws
```

### 2.4 Create the server file:
```bash
nano server.js
```

Paste the following code:

```javascript
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 4444;

// Create HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('GDSJam WebRTC Signaling Server\n');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Track connections
let connectionCount = 0;

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
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
```

Save and exit (Ctrl+X, Y, Enter).

---

## Step 3: Run the Server with PM2 (Process Manager)

### 3.1 Install PM2 globally:
```bash
sudo npm install -g pm2
```

### 3.2 Start the signaling server:
```bash
pm2 start server.js --name gdsjam-signaling
```

### 3.3 Configure PM2 to start on boot:
```bash
pm2 startup
# Follow the command it outputs (will be something like):
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

pm2 save
```

### 3.4 Useful PM2 commands:
```bash
pm2 status              # Check status
pm2 logs gdsjam-signaling  # View logs
pm2 restart gdsjam-signaling  # Restart server
pm2 stop gdsjam-signaling     # Stop server
pm2 delete gdsjam-signaling   # Remove from PM2
```

---

## Step 4: Test the Server

### 4.1 Test from your local machine:
```bash
# Install wscat for testing
npm install -g wscat

# Connect to your server
wscat -c ws://<your-oci-instance-ip>:4444

# You should see: "Connected"
```

### 4.2 Test with browser console:
```javascript
const ws = new WebSocket('ws://<your-oci-instance-ip>:4444');
ws.onopen = () => console.log('Connected!');
ws.onmessage = (e) => console.log('Message:', e.data);
ws.send('test message');
```

---

## Step 5: Add SSL/TLS (Recommended for Production)

For `wss://` (secure WebSocket), you need SSL. Two options:

### Option A: Use Nginx as Reverse Proxy with Let's Encrypt

1. Install Nginx and Certbot:
```bash
sudo apt install nginx certbot python3-certbot-nginx
```

2. Create Nginx config:
```bash
sudo nano /etc/nginx/sites-available/signaling
```

Paste:
```nginx
server {
    listen 80;
    server_name signaling.yourdomain.com;

    location / {
        proxy_pass http://localhost:4444;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

3. Enable and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/signaling /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d signaling.yourdomain.com
```

4. Update your app to use:
```
wss://signaling.yourdomain.com
```

### Option B: Use Cloudflare Tunnel (No domain needed!)

See Cloudflare Tunnel docs - free and easy.

---

## Step 6: Update GDSJam to Use Your Server

Edit `src/lib/collaboration/YjsProvider.ts`:

```typescript
signaling: [
  "ws://<your-oci-ip>:4444",  // For testing
  // "wss://signaling.yourdomain.com",  // For production with SSL
],
```

---

## Monitoring & Maintenance

### Check server logs:
```bash
pm2 logs gdsjam-signaling
```

### Monitor resource usage:
```bash
htop  # Install with: sudo apt install htop
```

### Check active connections:
```bash
pm2 logs gdsjam-signaling --lines 50 | grep "Active connections"
```

---

## Troubleshooting

### Server not accessible:
1. Check OCI Security List (port 4444 ingress rule)
2. Check instance firewall: `sudo iptables -L -n`
3. Check server is running: `pm2 status`

### WebSocket connection fails:
1. Test with `wscat`: `wscat -c ws://<ip>:4444`
2. Check server logs: `pm2 logs gdsjam-signaling`
3. Verify port is listening: `sudo netstat -tlnp | grep 4444`

### High memory usage:
- Signaling server should use <100MB
- If higher, check for memory leaks: `pm2 monit`

---

## Cost Analysis

**Free OCI Instance:**
- Cost: $0/month
- Bandwidth: 10TB/month free
- Estimated capacity: 500-1000 concurrent users
- Perfect for: Personal projects, small teams, MVP

**Estimated bandwidth usage:**
- Per connection: ~10KB initial handshake
- 1000 connections/day: ~10MB/day = 300MB/month
- Well within 10TB free tier!

---

## Summary

✅ **Setup time**: 15-20 minutes
✅ **Cost**: $0 (using OCI free tier)
✅ **Capacity**: 500-1000 concurrent users
✅ **Resource usage**: <100MB RAM, <5% CPU
✅ **Can run alongside other services**: Yes!
✅ **Maintenance**: Minimal (PM2 auto-restart)

Your free OCI instance is **more than capable** of running this signaling server alongside your other services!

---

## Implementation Status

### ✅ Completed (2025-11-23)

The signaling server has been implemented in `/server` with the following features:

#### Core Implementation
- WebSocket-based signaling server (port 4444)
- Message broadcasting between WebRTC peers
- Connection tracking and logging
- Graceful shutdown handling

#### Security Features
1. **Token Authentication**
   - Optional `AUTH_TOKEN` environment variable
   - Token passed via WebSocket URL: `ws://server:4444?token=TOKEN`
   - Rejects unauthorized connections with 401

2. **Origin Checking**
   - Validates `Origin` header against allowlist
   - Default allowed: `https://gdsjam.com`, `http://localhost:5173`, `http://localhost:4173`
   - Configurable via `ALLOWED_ORIGINS` environment variable
   - Rejects unauthorized origins with 403

3. **Rate Limiting**
   - Tracks connections per IP address
   - Default: 10 connections per minute per IP
   - Prevents DoS attacks
   - Rejects rate-limited clients with 429

#### Background Execution
- `start.sh`: Starts server in background with timestamped logs
- `stop.sh`: Gracefully stops the server
- Logs saved to `logs/server_YYYYMMDD_HHMMSS.log`
- Process ID tracked in `.server.pid`

#### Configuration
- `.env` file for environment variables
- `.env.example` template provided
- Configurable: PORT, AUTH_TOKEN, ALLOWED_ORIGINS

#### Files Created
```
server/
├── server.js          # Main server implementation
├── package.json       # Node.js dependencies
├── start.sh          # Background start script
├── stop.sh           # Stop script
├── .env.example      # Configuration template
├── .gitignore        # Git ignore rules
└── README.md         # Documentation
```

### Security Considerations

⚠️ **Important**: The current security model provides **basic protection**, not enterprise-grade security.

**What it protects against:**
- Casual discovery and abuse
- Basic automated attacks
- Accidental misuse
- Simple DoS attempts

**What it does NOT protect against:**
- Token extraction from client source code (client-side app limitation)
- Determined attackers
- Advanced network attacks

**Why this is acceptable:**
- GDSJam is a client-side app - true authentication requires a backend
- The signaling server only handles peer discovery, not sensitive data
- WebRTC connections themselves are encrypted (DTLS-SRTP)
- This is sufficient for a public educational/hobby project

### Usage

```bash
# Local development
cd server
pnpm install
pnpm start

# Production deployment
cd server
cp .env.example .env
# Edit .env and set AUTH_TOKEN
pnpm start:bg

# View logs
tail -f logs/server_*.log

# Stop server
pnpm stop
```

### Client Integration

The GDSJam client should connect with:

```typescript
const token = import.meta.env.VITE_SIGNALING_TOKEN;
const ws = new WebSocket(`wss://signaling.yourdomain.com?token=${token}`);
```

**Note**: Room codes for isolating peer connections will be handled entirely client-side. The server simply broadcasts all messages to all connected clients.

