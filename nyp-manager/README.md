# nyp-manager

nyanpass 节点 IP 故障转移中心管理面板。

## 功能

- 管理多个 nyp-agent 节点
- 实时查看节点状态和 IP 池
- 手动触发 IP 切换
- 配置上报目标（nyanpass、阿里云等）
- 自动上报 IP 变更到第三方平台
- 操作日志记录

## 安装

```bash
cd nyp-manager
npm install
```

## 配置

通过环境变量配置：

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
```

访问 `http://localhost:3001` 进入管理界面。

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

## 上报配置

### Nyanpass

创建上报配置时，`config` 格式：

```json
{
  "admin_url": "https://nya.example.com",
  "username": "admin",
  "password": "your-password",
  "device_group_id": 24
}
```

### 阿里云（待实现）

预留接口，后续实现。

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

## 许可证

MIT
