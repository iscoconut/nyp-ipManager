# nyp-manager

nyanpass 节点 IP 故障转移中心管理面板。

## 功能

- 管理多个 nyp-agent 节点
- 实时查看节点状态和 IP 池
- 手动触发 IP 切换
- 配置上报目标（nyanpass、阿里云等）
- 自动上报 IP 变更到第三方平台
- 操作日志记录
- Web 管理界面

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
cd /tmp/nyp-ipManager/nyp-manager
chmod +x install.sh
./install.sh
```

### 3. 配置（可选）

安装脚本会自动生成随机 Token，配置文件位于：

```bash
nano /opt/nyp-manager/config/.env
```

配置内容：

```bash
# API 监听端口
API_PORT=3001

# API 监听地址
API_HOST=0.0.0.0

# 管理员认证 Token
API_TOKEN=your-secret-token

# SQLite 数据库路径
DB_PATH=/opt/nyp-manager/data/manager.db
```

修改后重启服务生效。

### 4. 启动服务

```bash
# 启动
systemctl start nyp-manager

# 开机自启
systemctl enable nyp-manager

# 查看日志
journalctl -u nyp-manager -f
```

### 5. 访问管理界面

打开浏览器访问：`http://YOUR_SERVER_IP:3001`

如果设置了 Token，访问时需要带上 Token：`http://YOUR_SERVER_IP:3001?token=your-secret-token`

## 升级

```bash
/opt/nyp-manager/upgrade.sh
```

升级脚本会自动：
- 下载最新代码
- 备份当前版本
- 更新文件（保留配置和数据）
- 重启服务

如需回滚，按提示操作即可。

## 手动安装

```bash
cd nyp-manager
npm install
npm start
```

## 配置

配置文件位置：`/opt/nyp-manager/config/.env`

环境变量说明：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `API_PORT` | API 监听端口 | `3001` |
| `API_HOST` | API 监听地址 | `0.0.0.0` |
| `API_TOKEN` | 管理员 Token | 无（不启用认证） |
| `DB_PATH` | SQLite 数据库路径 | `./data/manager.db` |
| `STATIC_DIR` | 静态文件目录 | `./public` |

## 使用

```bash
# 启动
npm start

# 或指定 Token
API_TOKEN=your-secret npm start

# 指定端口
API_PORT=8080 npm start
```

访问 `http://localhost:3001` 进入管理界面。

## 添加节点

1. 在管理界面点击「添加节点」
2. 填写节点信息：
   - **节点 ID**：唯一标识（如 `node-1`）
   - **名称**：显示名称（如「香港节点1」）
   - **Agent URL**：Agent 地址（如 `http://1.2.3.4:3000`）
   - **Token**：Agent 的 API Token（可选）

3. 在 Agent 的配置文件中添加 Manager 配置：

```json
{
  "manager": {
    "url": "http://manager-server:3001",
    "token": "manager-auth-token",
    "node_id": "node-1",
    "report_interval": 60000
  }
}
```

## 配置 Nyanpass 上报

1. 在管理界面选择节点
2. 点击「上报配置」→「添加上报」
3. 填写配置：

```json
{
  "admin_url": "https://nya.example.com",
  "username": "admin",
  "password": "your-password",
  "device_group_id": 24
}
```

当 Agent 切换 IP 后，Manager 会自动将新 IP 上报到 nyanpass 面板。

## API 接口

### Agent 上报接口

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/agent/report` | Agent 状态上报 |
| POST | `/api/agent/callback` | Agent 换 IP 回调 |

### 管理接口（需要 Token）

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/nodes` | 获取所有节点 |
| GET | `/api/nodes/:id` | 获取单个节点 |
| POST | `/api/nodes` | 创建节点 |
| PUT | `/api/nodes/:id` | 更新节点 |
| DELETE | `/api/nodes/:id` | 删除节点 |
| POST | `/api/nodes/:id/switch` | 触发节点换 IP |
| GET | `/api/nodes/:id/pool` | 获取节点 IP 池 |
| GET | `/api/nodes/:id/reporters` | 获取节点上报配置 |
| POST | `/api/nodes/:id/reporters` | 创建上报配置 |
| PUT | `/api/reporters/:id` | 更新上报配置 |
| DELETE | `/api/reporters/:id` | 删除上报配置 |
| GET | `/api/logs` | 获取操作日志 |

## 工作流程

```
Agent 检测到 IP 故障
      │
      ▼
Agent 自动切换 IP
      │
      ▼
Agent 调用 /api/agent/callback 通知 Manager
      │
      ▼
Manager 记录日志
      │
      ▼
Manager 根据配置自动上报到 nyanpass/阿里云等
```

## 目录结构

```
/opt/nyp-manager/
├── src/
│   ├── index.js          # 主入口
│   ├── db.js             # 数据库
│   └── reporters/        # 上报模块
│       ├── index.js
│       └── nyanpass.js
├── public/
│   └── index.html        # Web 界面
├── data/
│   └── manager.db        # SQLite 数据库
├── config/
│   └── .env              # 环境变量配置
├── upgrade.sh            # 升级脚本
└── package.json
```

## 常见问题

### 无法连接 Agent

1. 检查 Agent 是否运行：`curl http://AGENT_IP:3000/health`
2. 检查防火墙是否开放 3000 端口
3. 检查 Agent 配置的 Token 是否正确

### 上报失败

1. 检查 nyanpass 面板地址是否正确
2. 检查用户名密码是否正确
3. 检查 device_group_id 是否存在
4. 查看 Manager 日志：`journalctl -u nyp-manager -f`

### 数据库损坏

数据库文件位于 `/opt/nyp-manager/data/manager.db`，可删除后重启服务重建。

## 许可证

MIT
