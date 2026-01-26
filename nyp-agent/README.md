# nyp-agent

nyanpass 节点 IP 故障转移 Agent。

## 功能

- 自动 IP 健康检测（curl + ping + 带宽监控）
- 检测失败时自动切换 IP
- 同时支持 `networking` (ifupdown) 和 `netplan`
- HTTP API 远程管理
- IP 池管理，废弃 IP 追踪

## 快速安装

### 1. 安装依赖

```bash
# Debian / Ubuntu
apt update && apt install -y curl git

# 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 验证安装
node -v  # 需要 >= 18
```

### 2. 下载并安装

```bash
git clone https://github.com/iscoconut/nyp-ipManager.git /tmp/nyp-ipManager
cd /tmp/nyp-ipManager/nyp-agent
chmod +x install.sh
./install.sh
```

### 3. 编辑配置

```bash
cp /opt/nyp-agent/config/config.example.json /opt/nyp-agent/config/config.json
nano /opt/nyp-agent/config/config.json
```

### 4. 启动服务

```bash
# 启动
systemctl start nyp-agent

# 开机自启
systemctl enable nyp-agent

# 查看日志
journalctl -u nyp-agent -f

# 查看状态
curl http://localhost:3000/status
```

## 手动安装

```bash
cd nyp-agent
npm install  # 无外部依赖
npm start
```

## 配置

复制示例配置并编辑：

```bash
cp config/config.example.json config/config.json
# 编辑 config/config.json 填入你的配置
```

### 配置字段说明

| 字段 | 说明 |
|------|------|
| `interface` | 要管理的网卡名（如 `eth2`、`ens20`） |
| `config_type` | `networking` 或 `netplan`（不填则自动检测） |
| `config_file` | 网络配置文件路径 |
| `route_table` | 策略路由表号 |
| `check_interval` | 检测间隔，毫秒（默认 5000） |
| `fail_threshold` | 触发切换的失败次数（默认 10） |
| `bandwidth_threshold` | 最低带宽阈值，Mbps（默认 10） |
| `curl_target` | curl 检测目标（默认 baidu.com） |
| `ping_target` | ping 检测目标（默认 223.5.5.5） |
| `current` | 当前 IP 配置 |
| `available` | 可用 IP 池 |
| `discarded` | 废弃 IP 池（等待人工处理） |

### IP 配置格式

```json
{
  "ip": "10.0.0.100",
  "netmask": 24,
  "gateway": "10.0.0.1",
  "rule_from": "10.0.0.0/24"
}
```

## 使用

```bash
# 使用默认配置启动
npm start

# 指定配置文件路径
CONFIG_PATH=/path/to/config.json npm start

# 启用 API Token 认证
API_TOKEN=your-secret npm start

# 指定端口
API_PORT=8080 npm start

# 禁用自动启动检测
AUTO_START=false npm start
```

## API 接口

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/status` | 获取当前状态 |
| GET | `/config` | 获取完整配置 |
| GET | `/pool` | 获取 IP 池详情 |
| POST | `/switch` | 手动触发换 IP |
| POST | `/start` | 启动自动检测 |
| POST | `/stop` | 停止自动检测 |
| POST | `/reload` | 重新加载配置 |
| POST | `/pool/add` | 添加 IP 到可用池 |
| POST | `/pool/restore` | 从废弃池恢复 IP |

### 响应示例

```json
// GET /status
{
  "running": true,
  "switching": false,
  "interface": "eth2",
  "config_type": "networking",
  "current_ip": "10.0.0.100",
  "fail_count": 0,
  "fail_threshold": 10,
  "pool": {
    "available": 2,
    "discarded": 0,
    "exhausted": false
  },
  "stats": {
    "total_checks": 100,
    "failed_checks": 0,
    "switches": 0,
    "last_check": "2026-01-26T10:00:00Z",
    "last_switch": null
  }
}
```

```json
// POST /switch
{
  "success": true,
  "old_ip": "10.0.0.100",
  "new_ip": "10.0.0.101",
  "message": "IP switched successfully",
  "pool_exhausted": false
}
```

## 检测逻辑

```
每 5 秒执行:
  1. curl baidu.com（绑定指定网卡）
  2. ping 223.5.5.5（绑定指定网卡）

  如果都失败:
    3. 检测网卡带宽
    如果带宽 < 10Mbps:
      fail_count++

  如果任一成功:
    fail_count = 0

  如果 fail_count >= 10:
    从 IP 池取下一个 IP 进行切换
    旧 IP 放入废弃池
```

**故障检测时间**: 5秒 × 10次 = 50秒内发现故障并切换

## 网络配置

### networking (ifupdown)

Agent 会自动执行：
```bash
ifdown eth2
# 修改 /etc/network/interfaces.d/xxx
ifup eth2
```

### netplan

Agent 会自动执行：
```bash
# 修改 /etc/netplan/xxx.yaml
netplan apply
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CONFIG_PATH` | 配置文件路径 | `./config/config.json` |
| `API_PORT` | API 监听端口 | `3000` |
| `API_TOKEN` | API 认证 Token | 无（不启用认证） |
| `AUTO_START` | 启动时自动开始检测 | `true` |

## 许可证

MIT
