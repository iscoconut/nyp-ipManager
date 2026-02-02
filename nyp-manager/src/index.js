import http from 'http';
import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  initDB,
  getAllNodes, getNode, createNode, updateNode, updateNodeStatus, deleteNode,
  getReporters, getReporter, createReporter, updateReporter, deleteReporter,
  getLogs, addLog
} from './db.js';
import { getDispatcher } from './reporters/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const API_HOST = process.env.API_HOST || '0.0.0.0';
const API_TOKEN = process.env.API_TOKEN || null;
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '../public');

/**
 * JSON 响应
 */
function jsonResponse(res, data, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * 解析 JSON body
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Token 验证
 */
function checkAuth(req) {
  if (!API_TOKEN) return true;

  const authHeader = req.headers['authorization'];
  const url = new URL(req.url, `http://${req.headers.host}`);
  const queryToken = url.searchParams.get('token');

  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    return token === API_TOKEN;
  }

  if (queryToken) {
    return queryToken === API_TOKEN;
  }

  return false;
}

/**
 * 验证 Agent 上报 Token
 */
function checkAgentAuth(req, nodeId) {
  const node = getNode(nodeId);
  if (!node) return false;
  if (!node.token) return true; // 节点没设置 token 则不验证

  const authHeader = req.headers['authorization'];
  if (!authHeader) return false;

  const token = authHeader.replace('Bearer ', '');
  return token === node.token;
}

/**
 * 静态文件服务
 */
function serveStatic(req, res) {
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);

  // 安全检查
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extname = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = contentTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA fallback
        fs.readFile(path.join(STATIC_DIR, 'index.html'), (err2, content2) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content2);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

/**
 * 路由处理
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Node-ID');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API 路由
  if (pathname.startsWith('/api/')) {
    return handleAPI(req, res, pathname, method, url);
  }

  // 静态文件
  serveStatic(req, res);
}

/**
 * API 路由处理
 */
async function handleAPI(req, res, pathname, method, url) {
  try {
    // ========== Agent 上报接口（不需要管理员 Token） ==========

    // POST /api/agent/report - Agent 状态上报
    if (method === 'POST' && pathname === '/api/agent/report') {
      const body = await parseBody(req);
      const nodeId = body.node_id || req.headers['x-node-id'];

      if (!nodeId) {
        return jsonResponse(res, { error: 'Missing node_id' }, 400);
      }

      if (!checkAgentAuth(req, nodeId)) {
        return jsonResponse(res, { error: 'Unauthorized' }, 401);
      }

      const node = getNode(nodeId);
      if (!node) {
        return jsonResponse(res, { error: 'Node not found' }, 404);
      }

      updateNodeStatus(nodeId, body.data || {});
      return jsonResponse(res, { message: 'Status updated' });
    }

    // POST /api/agent/callback - Agent 换 IP 回调
    if (method === 'POST' && pathname === '/api/agent/callback') {
      const body = await parseBody(req);
      const nodeId = body.node_id || req.headers['x-node-id'];

      if (!nodeId) {
        return jsonResponse(res, { error: 'Missing node_id' }, 400);
      }

      if (!checkAgentAuth(req, nodeId)) {
        return jsonResponse(res, { error: 'Unauthorized' }, 401);
      }

      const node = getNode(nodeId);
      if (!node) {
        return jsonResponse(res, { error: 'Node not found' }, 404);
      }

      const { old_ip, new_ip, success, message } = body.data || {};

      // 记录日志
      addLog({
        node_id: nodeId,
        action: 'switch_ip',
        old_ip,
        new_ip,
        result: success ? 'success' : 'failed',
        message
      });

      // 如果切换成功，执行上报
      if (success && new_ip) {
        const dispatcher = getDispatcher();
        const reportResults = await dispatcher.report(nodeId, new_ip, old_ip);
        return jsonResponse(res, {
          message: 'Callback received',
          report_results: reportResults
        });
      }

      return jsonResponse(res, { message: 'Callback received' });
    }

    // ========== 管理接口（需要 Token） ==========

    if (!checkAuth(req)) {
      return jsonResponse(res, { error: 'Unauthorized' }, 401);
    }

    // ---------- 节点管理 ----------

    // GET /api/nodes - 获取所有节点
    if (method === 'GET' && pathname === '/api/nodes') {
      const nodes = getAllNodes();
      return jsonResponse(res, nodes);
    }

    // GET /api/nodes/:id - 获取单个节点
    if (method === 'GET' && pathname.match(/^\/api\/nodes\/[^/]+$/)) {
      const nodeId = pathname.split('/')[3];
      const node = getNode(nodeId);
      if (!node) {
        return jsonResponse(res, { error: 'Node not found' }, 404);
      }
      return jsonResponse(res, node);
    }

    // POST /api/nodes - 创建节点
    if (method === 'POST' && pathname === '/api/nodes') {
      const body = await parseBody(req);
      if (!body.id || !body.name || !body.url) {
        return jsonResponse(res, { error: 'Missing required fields: id, name, url' }, 400);
      }
      const node = createNode(body);
      return jsonResponse(res, node, 201);
    }

    // PUT /api/nodes/:id - 更新节点
    if (method === 'PUT' && pathname.match(/^\/api\/nodes\/[^/]+$/)) {
      const nodeId = pathname.split('/')[3];
      const body = await parseBody(req);
      const node = updateNode(nodeId, body);
      if (!node) {
        return jsonResponse(res, { error: 'Node not found' }, 404);
      }
      return jsonResponse(res, node);
    }

    // DELETE /api/nodes/:id - 删除节点
    if (method === 'DELETE' && pathname.match(/^\/api\/nodes\/[^/]+$/)) {
      const nodeId = pathname.split('/')[3];
      const deleted = deleteNode(nodeId);
      if (!deleted) {
        return jsonResponse(res, { error: 'Node not found' }, 404);
      }
      return jsonResponse(res, { message: 'Node deleted' });
    }

    // POST /api/nodes/:id/switch - 触发节点换 IP
    if (method === 'POST' && pathname.match(/^\/api\/nodes\/[^/]+\/switch$/)) {
      const nodeId = pathname.split('/')[3];
      const node = getNode(nodeId);
      if (!node) {
        return jsonResponse(res, { error: 'Node not found' }, 404);
      }

      // 调用 Agent API
      try {
        const agentUrl = `${node.url}/switch`;
        const headers = { 'Content-Type': 'application/json' };
        if (node.token) {
          headers['Authorization'] = `Bearer ${node.token}`;
        }

        const response = await fetch(agentUrl, {
          method: 'POST',
          headers
        });

        const result = await response.json();
        return jsonResponse(res, result, response.ok ? 200 : 400);
      } catch (error) {
        return jsonResponse(res, { error: `Failed to contact agent: ${error.message}` }, 500);
      }
    }

    // GET /api/nodes/:id/pool - 获取节点 IP 池
    if (method === 'GET' && pathname.match(/^\/api\/nodes\/[^/]+\/pool$/)) {
      const nodeId = pathname.split('/')[3];
      const node = getNode(nodeId);
      if (!node) {
        return jsonResponse(res, { error: 'Node not found' }, 404);
      }

      try {
        const agentUrl = `${node.url}/pool`;
        const headers = {};
        if (node.token) {
          headers['Authorization'] = `Bearer ${node.token}`;
        }

        const response = await fetch(agentUrl, { headers });
        const result = await response.json();
        return jsonResponse(res, result, response.ok ? 200 : 400);
      } catch (error) {
        return jsonResponse(res, { error: `Failed to contact agent: ${error.message}` }, 500);
      }
    }

    // ---------- 上报目标管理 ----------

    // GET /api/nodes/:id/reporters - 获取节点的上报目标
    if (method === 'GET' && pathname.match(/^\/api\/nodes\/[^/]+\/reporters$/)) {
      const nodeId = pathname.split('/')[3];
      const reporters = getReporters(nodeId);
      return jsonResponse(res, reporters);
    }

    // POST /api/nodes/:id/reporters - 创建上报目标
    if (method === 'POST' && pathname.match(/^\/api\/nodes\/[^/]+\/reporters$/)) {
      const nodeId = pathname.split('/')[3];
      const body = await parseBody(req);
      if (!body.type || !body.config) {
        return jsonResponse(res, { error: 'Missing required fields: type, config' }, 400);
      }
      const reporter = createReporter({
        node_id: nodeId,
        type: body.type,
        config: body.config,
        enabled: body.enabled
      });
      return jsonResponse(res, reporter, 201);
    }

    // PUT /api/reporters/:id - 更新上报目标
    if (method === 'PUT' && pathname.match(/^\/api\/reporters\/\d+$/)) {
      const reporterId = parseInt(pathname.split('/')[3]);
      const body = await parseBody(req);
      const reporter = updateReporter(reporterId, body);
      if (!reporter) {
        return jsonResponse(res, { error: 'Reporter not found' }, 404);
      }
      return jsonResponse(res, reporter);
    }

    // DELETE /api/reporters/:id - 删除上报目标
    if (method === 'DELETE' && pathname.match(/^\/api\/reporters\/\d+$/)) {
      const reporterId = parseInt(pathname.split('/')[3]);
      const deleted = deleteReporter(reporterId);
      if (!deleted) {
        return jsonResponse(res, { error: 'Reporter not found' }, 404);
      }
      return jsonResponse(res, { message: 'Reporter deleted' });
    }

    // ---------- 日志 ----------

    // GET /api/logs - 获取日志
    if (method === 'GET' && pathname === '/api/logs') {
      const nodeId = url.searchParams.get('node_id');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const logs = getLogs({ nodeId, limit, offset });
      return jsonResponse(res, logs);
    }

    // 404
    return jsonResponse(res, { error: 'Not found' }, 404);

  } catch (error) {
    console.error(`[API] Error: ${error.message}`);
    return jsonResponse(res, { error: error.message }, 500);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(50));
  console.log('nyp-manager - Central Management Panel');
  console.log('='.repeat(50));

  // 确保 data 目录存在
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 初始化数据库
  initDB();

  // 启动 HTTP 服务
  const server = http.createServer(handleRequest);

  server.listen(API_PORT, API_HOST, () => {
    console.log(`[API] Server listening on ${API_HOST}:${API_PORT}`);
    console.log(`Auth: ${API_TOKEN ? 'enabled' : 'disabled'}`);
    console.log('');
    console.log('API Endpoints:');
    console.log('  Agent:');
    console.log('    POST /api/agent/report    - Status report');
    console.log('    POST /api/agent/callback  - IP switch callback');
    console.log('  Nodes:');
    console.log('    GET    /api/nodes         - List all nodes');
    console.log('    GET    /api/nodes/:id     - Get node');
    console.log('    POST   /api/nodes         - Create node');
    console.log('    PUT    /api/nodes/:id     - Update node');
    console.log('    DELETE /api/nodes/:id     - Delete node');
    console.log('    POST   /api/nodes/:id/switch - Trigger switch');
    console.log('    GET    /api/nodes/:id/pool   - Get IP pool');
    console.log('  Reporters:');
    console.log('    GET    /api/nodes/:id/reporters - List reporters');
    console.log('    POST   /api/nodes/:id/reporters - Create reporter');
    console.log('    PUT    /api/reporters/:id       - Update reporter');
    console.log('    DELETE /api/reporters/:id       - Delete reporter');
    console.log('  Logs:');
    console.log('    GET    /api/logs          - Get logs');
    console.log('');
  });

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n[Manager] Shutting down...');
    server.close(() => {
      console.log('[Manager] Goodbye!');
      process.exit(0);
    });
  });
}

main().catch(error => {
  console.error(`[Fatal] ${error.message}`);
  process.exit(1);
});
