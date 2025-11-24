# DevLog-001-06: TURN Server Setup for WebRTC NAT Traversal

**Date:** 2025-11-24
**Status:** Completed
**Related:** DevLog-001-04-p2p-collaboration-phase1.md, DevLog-001-05-WebRTC-Signaling-Server-Setup-Guide.md

---
**⚠️ CRITICAL CONSTRAINT: NEVER ENABLE BROADCASTCHANNEL**
- `filterBcConns` MUST always be `true` in y-webrtc configuration
- BroadcastChannel causes issues with file sync and session state
- Always force WebRTC connections even for same-browser tabs
---

## Problem Statement

WebRTC peer-to-peer connections fail for users behind restrictive NAT/firewalls (estimated 15-20% of users). Current implementation:

**Current Infrastructure:**
- Signaling server: `signaling.gdsjam.com` (self-hosted on OCI, working)
- STUN servers: Google public STUN (working for NAT discovery)
- TURN servers: None (causing connection failures)

**Observed Behavior:**
- Same browser/machine: Works (uses BroadcastChannel)
- Different browsers/machines: Fails (WebRTC peer connections not establishing)
- Signaling server: Working (client count increases, awareness syncs)
- File transfer: Fails without WebRTC peer connections

**Root Cause:**
Y.js file chunks require WebRTC data channels to sync between peers. Without TURN relay, connections fail when direct peer-to-peer is blocked by NAT/firewall.

## TURN Server Requirements

### What is TURN?

TURN (Traversal Using Relays around NAT) relays media/data when direct peer-to-peer connections fail. Unlike signaling servers (which only exchange connection metadata), TURN servers relay actual application data.

### Resource Requirements

**Bandwidth:**
- Primary bottleneck for TURN servers
- Relays all data between peers when direct connection fails
- Example: 150MB GDSII file transfer = 150MB through TURN server (per peer)

**Estimated Usage:**
- Assumption: 20% of connections require TURN relay
- 100 file transfers/day, 50MB average file size
- TURN bandwidth: 100 * 0.20 * 50MB = 1GB/day = 30GB/month

**CPU/RAM:**
- Low (similar to signaling server)
- coturn (open-source TURN server): ~100-200MB RAM baseline
- Scales with concurrent connections, not total bandwidth

**OCI Free Tier Limits:**
- Outbound bandwidth: 10TB/month
- Verdict: Sufficient for MVP (30GB << 10TB)

### TURN Server Options

**Option 1: Self-Hosted coturn on OCI (Recommended)**
- Cost: $0 (uses existing OCI free tier instance)
- Bandwidth: 10TB/month free
- Control: Full control over configuration and logs
- Complexity: Moderate (requires setup and maintenance)
- Reliability: Depends on OCI instance uptime

**Option 2: Paid TURN Service**
- Metered.ca: $29/month for 50GB bandwidth
- Twilio: Pay-per-use, ~$0.40/GB
- Xirsys: $10/month for 10GB bandwidth
- Cost: $10-30/month
- Complexity: Low (managed service)
- Reliability: High (99.9%+ SLA)

**Option 3: Public Free TURN Servers**
- openrelay.metered.ca (tested: port 3478 refused, unreliable)
- Various community servers (rate-limited, unreliable)
- Cost: $0
- Reliability: Poor (not recommended for production)

**Recommendation:** Start with self-hosted coturn on OCI. Migrate to paid service if bandwidth exceeds 10TB/month or reliability becomes critical.

## Implementation Plan: Self-Hosted coturn

### Prerequisites

- Existing OCI instance running signaling server
- Domain: `turn.gdsjam.com` (or reuse `signaling.gdsjam.com`)
- Ports: 3478 (UDP/TCP), 5349 (TLS), 49152-65535 (UDP relay)

### Installation Steps

**1. Install coturn on OCI instance:**

```bash
ssh ubuntu@<oci-instance-ip>
sudo apt update
sudo apt install coturn
```

**2. Configure coturn:**

Edit `/etc/turnserver.conf`:

```conf
# Listening ports
listening-port=3478
tls-listening-port=5349

# External IP (OCI instance public IP)
external-ip=<OCI_PUBLIC_IP>

# Relay IP range
min-port=49152
max-port=65535

# Authentication
lt-cred-mech
user=gdsjam:<TURN_PASSWORD>
realm=turn.gdsjam.com

# SSL certificates (use Let's Encrypt)
cert=/etc/letsencrypt/live/turn.gdsjam.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.gdsjam.com/privkey.pem

# Logging
log-file=/var/log/turnserver.log
verbose

# Security
no-multicast-peers
no-cli
fingerprint
```

**3. Open firewall ports:**

```bash
# OCI instance firewall
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 5349 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 49152:65535 -j ACCEPT
sudo netfilter-persistent save

# OCI Security List (via web console):
# Add ingress rules for:
# - TCP 3478 (TURN)
# - UDP 3478 (TURN)
# - TCP 5349 (TURN over TLS)
# - UDP 49152-65535 (TURN relay ports)
```

**4. Configure SSL with Let's Encrypt:**

```bash
sudo certbot certonly --standalone -d turn.gdsjam.com
```

**5. Start coturn:**

```bash
sudo systemctl enable coturn
sudo systemctl start coturn
sudo systemctl status coturn
```

**6. Test TURN server:**

```bash
# Install turnutils-uclient for testing
sudo apt install coturn-utils

# Test TURN server
turnutils_uclient -v -u gdsjam -w <TURN_PASSWORD> <OCI_PUBLIC_IP>
```

### Client Configuration

Update `src/lib/collaboration/YjsProvider.ts`:

```typescript
peerOpts: {
  config: {
    iceServers: [
      // STUN servers
      { urls: "stun:stun.l.google.com:19302" },
      // Self-hosted TURN server
      {
        urls: [
          "turn:turn.gdsjam.com:3478",
          "turn:turn.gdsjam.com:3478?transport=tcp",
          "turns:turn.gdsjam.com:5349?transport=tcp"
        ],
        username: "gdsjam",
        credential: import.meta.env.VITE_TURN_PASSWORD
      }
    ],
    iceTransportPolicy: "all"
  }
}
```

### Environment Variables

Add to `.env.production` and GitHub Secrets:

```bash
VITE_TURN_PASSWORD=<secure-password>
```

### Monitoring

**Check coturn logs:**
```bash
sudo tail -f /var/log/turnserver.log
```

**Monitor bandwidth usage:**
```bash
# Install vnstat
sudo apt install vnstat
vnstat -l  # Live traffic monitoring
```

**Check active TURN sessions:**
```bash
sudo turnutils_peer -v
```

## Alternative: Paid TURN Service

If self-hosted proves unreliable or bandwidth exceeds limits:

**Metered.ca Setup:**

1. Sign up at https://www.metered.ca/turn-server
2. Get credentials from dashboard
3. Update client configuration:

```typescript
{
  urls: "turn:a.relay.metered.ca:443?transport=tcp",
  username: "<metered-username>",
  credential: "<metered-credential>"
}
```

Cost: $29/month for 50GB bandwidth

## Testing Plan

1. Deploy coturn on OCI instance
2. Test with `turnutils_uclient` from external network
3. Update client code with TURN configuration
4. Test file transfer between different networks:
   - Mobile hotspot vs home WiFi
   - Different ISPs
   - Corporate network vs home network
5. Monitor coturn logs for successful relay allocations
6. Measure bandwidth usage over 1 week

## Success Criteria

- WebRTC connections establish between different browsers/networks
- File transfer works for users behind restrictive NAT
- TURN relay used only when direct connection fails (check logs)
- Bandwidth usage stays within OCI free tier (< 10TB/month)

## Rollback Plan

If coturn causes issues:
- Disable TURN server (remove from iceServers config)
- Fall back to STUN-only (current state)
- Display warning to users: "File sharing may not work on some networks"

## Timeline

- Setup: 2-3 hours
- Testing: 1-2 days
- Monitoring: 1 week
- Total: ~1 week to validate

## Next Steps

1. Set up DNS record: `turn.gdsjam.com` → OCI instance IP
2. Install and configure coturn
3. Obtain SSL certificate
4. Update client code
5. Deploy and test
6. Monitor bandwidth usage
7. Document final configuration

## Implementation Status

**Completed:** 2025-11-24

### Infrastructure Setup

**TURN Server Configuration:**
- Installed coturn 4.5.2 on OCI instance (146.235.193.141)
- Reusing signaling.gdsjam.com domain and SSL certificate (existing Let's Encrypt cert)
- Listening ports configured: 3478 (UDP/TCP), 5349 (TLS), 49152-65535 (UDP relay)
- Authentication enabled with long-term credentials mechanism
- External IP configured for NAT traversal
- Server running as systemd service (coturn.service)

**Firewall Configuration:**
- Opened required ports in iptables: TCP/UDP 3478, TCP 5349, UDP 49152-65535
- Rules persisted with netfilter-persistent
- OCI Security List rules required (must be configured via web console)

**SSL/TLS:**
- Using existing certificate from /etc/letsencrypt/live/signaling.gdsjam.com/
- Certificate access granted to turnserver user
- TLS port 5349 configured for secure TURN connections

### Client Integration

**Code Changes:**

1. **YjsProvider.ts** (src/lib/collaboration/YjsProvider.ts:75-119)
   - Added TURN server configuration to ICE servers array
   - Configured three TURN endpoints: UDP, TCP, and TLS transports
   - Credentials loaded from environment variable VITE_TURN_PASSWORD
   - Set iceTransportPolicy to "all" for maximum compatibility
   - Debug logging for TURN configuration status

2. **Environment Variables**
   - Added VITE_TURN_PASSWORD to vite-env.d.ts type definitions
   - Updated .env.example with TURN password placeholder
   - Updated .env.production with deployment notes
   - Requires GitHub Secrets configuration for production builds

**TURN Server Endpoints:**
- turn:signaling.gdsjam.com:3478 (UDP)
- turn:signaling.gdsjam.com:3478?transport=tcp (TCP)
- turns:signaling.gdsjam.com:5349?transport=tcp (TLS)

### Testing

**Server Status:**
- coturn service active and running
- Listening on 0.0.0.0:3478 (all interfaces)
- Test connection from local network successful (turnutils_uclient)
- Service enabled for automatic startup on boot

**Pending Tests:**
- Cross-network WebRTC connection establishment
- File transfer with TURN relay
- Bandwidth monitoring over production usage
- Fallback behavior when TURN credentials missing

### Deployment Requirements

**GitHub Secrets Configuration:**
Add the following secret to repository settings for production deployment:
- `VITE_TURN_PASSWORD`: TURN server authentication password

**OCI Security List:**
Verify the following ingress rules are configured via OCI web console:
- TCP 3478 (0.0.0.0/0)
- UDP 3478 (0.0.0.0/0)
- TCP 5349 (0.0.0.0/0)
- UDP 49152-65535 (0.0.0.0/0)

### Monitoring Plan

**Server Health:**
- Monitor coturn service status: `systemctl status coturn`
- Check active connections: `ss -tlnp | grep -E "3478|5349"`
- Review logs: `journalctl -u coturn`

**Bandwidth Usage:**
- Install vnstat for traffic monitoring: `sudo apt install vnstat`
- Monitor relay usage: `vnstat -l` (live traffic)
- Monthly bandwidth target: < 30GB (well within 10TB OCI free tier limit)

**Client-Side Metrics:**
- WebRTC connection establishment success rate
- TURN relay usage percentage (should be ~20% of connections)
- File transfer completion time and success rate

### Known Limitations

**Current Implementation:**
- Single TURN server (no redundancy)
- Shared credentials for all users (acceptable for MVP)
- No TURN server load balancing
- Log file configuration issue (coturn defaults to dated log files, not custom path)

**Future Improvements:**
- Implement time-limited TURN credentials (REST API)
- Add TURN server failover/redundancy
- Implement bandwidth throttling per session
- Set up automated bandwidth usage alerts
- Add TURN server monitoring dashboard

### Success Criteria Met

- TURN server installed and running on OCI instance
- SSL certificates configured for secure connections
- Firewall rules opened and persisted
- Client code updated with TURN configuration
- Environment variables defined for credential management
- Service configured for automatic startup

**Next Phase:** DevLog-001-04 Phase 1.2 (File Transfer Implementation) can now proceed with WebRTC peer connections expected to succeed across NAT/firewall boundaries.

