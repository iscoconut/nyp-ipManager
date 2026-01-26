# nyp-agent

IP Failover Agent for nyanpass nodes.

## Features

- Automatic IP health detection (curl + ping + bandwidth)
- Auto IP switching when failures detected
- Support for both `networking` (ifupdown) and `netplan`
- HTTP API for remote management
- IP pool management with discard tracking

## Installation

```bash
cd nyp-agent
npm install  # No external dependencies needed
```

## Configuration

Copy example config and edit:

```bash
cp config/config.example.json config/config.json
# Edit config/config.json with your settings
```

### Config Fields

| Field | Description |
|-------|-------------|
| `interface` | Network interface to manage (e.g., `eth2`, `ens20`) |
| `config_type` | `networking` or `netplan` (auto-detected if omitted) |
| `config_file` | Path to network config file |
| `route_table` | Routing table number for policy routing |
| `check_interval` | Detection interval in ms (default: 3000) |
| `fail_threshold` | Failures before switching (default: 10) |
| `bandwidth_threshold` | Min bandwidth in Mbps (default: 10) |
| `current` | Current IP configuration |
| `available` | Available IP pool |
| `discarded` | Discarded IPs (for manual review) |

## Usage

```bash
# Start with default config
npm start

# Or with custom config path
CONFIG_PATH=/path/to/config.json npm start

# With API token
API_TOKEN=your-secret npm start

# Custom port
API_PORT=8080 npm start
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | Current status |
| GET | `/config` | Full configuration |
| GET | `/pool` | IP pool details |
| POST | `/switch` | Manual IP switch |
| POST | `/start` | Start auto-detection |
| POST | `/stop` | Stop auto-detection |
| POST | `/reload` | Reload configuration |
| POST | `/pool/add` | Add IP to pool |
| POST | `/pool/restore` | Restore discarded IP |

## Detection Logic

```
Every 3 seconds:
  1. curl baidu.com (bound to interface)
  2. ping 223.5.5.5 (bound to interface)

  If both fail:
    3. Check interface bandwidth
    If bandwidth < 10Mbps:
      fail_count++

  If either succeeds:
    fail_count = 0

  If fail_count >= 10:
    Switch to next IP in pool
```

## License

MIT
