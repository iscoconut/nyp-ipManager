import http from 'http';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import { Switcher } from './switcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置文件路径
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '../config/config.json');
const API_PORT = parseInt(process.env.API_PORT || '3000', 10);
const API_TOKEN = process.env.API_TOKEN || null;

// 全局 switcher 实例
let switcher = null;

/**
 * 简单的 JSON 响应
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
  if (!authHeader) return false;

  const token = authHeader.replace('Bearer ', '');
  return token === API_TOKEN;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Token 验证（除了健康检查）
  if (pathname !== '/health' && !checkAuth(req)) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  try {
    // GET /health - 健康检查
    if (method === 'GET' && pathname === '/health') {
      return jsonResponse(res, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // GET /status - 获取当前状态
    if (method === 'GET' && pathname === '/status') {
      const status = switcher.getStatus();
      return jsonResponse(res, status);
    }

    // GET /config - 获取完整配置
    if (method === 'GET' && pathname === '/config') {
      const config = switcher.getFullConfig();
      return jsonResponse(res, config);
    }

    // POST /switch - 手动触发换 IP
    if (method === 'POST' && pathname === '/switch') {
      const result = await switcher.manualSwitch();
      return jsonResponse(res, result, result.success ? 200 : 400);
    }

    // POST /start - 启动自动检测
    if (method === 'POST' && pathname === '/start') {
      switcher.start();
      return jsonResponse(res, { message: 'Auto-detection started' });
    }

    // POST /stop - 停止自动检测
    if (method === 'POST' && pathname === '/stop') {
      switcher.stop();
      return jsonResponse(res, { message: 'Auto-detection stopped' });
    }

    // POST /reload - 重新加载配置
    if (method === 'POST' && pathname === '/reload') {
      await switcher.reload();
      return jsonResponse(res, { message: 'Configuration reloaded' });
    }

    // GET /pool - 获取 IP 池详情
    if (method === 'GET' && pathname === '/pool') {
      const config = switcher.getFullConfig();
      return jsonResponse(res, {
        current: config.current,
        available: config.available,
        discarded: config.discarded
      });
    }

    // POST /pool/add - 添加 IP 到可用池
    if (method === 'POST' && pathname === '/pool/add') {
      const body = await parseBody(req);
      if (!body.ip || !body.netmask || !body.gateway || !body.rule_from) {
        return jsonResponse(res, { error: 'Missing required fields: ip, netmask, gateway, rule_from' }, 400);
      }
      await switcher.ipPool.addAvailable(body);
      return jsonResponse(res, { message: 'IP added to available pool', ip: body.ip });
    }

    // POST /pool/restore - 从废弃池恢复 IP
    if (method === 'POST' && pathname === '/pool/restore') {
      const body = await parseBody(req);
      if (!body.ip) {
        return jsonResponse(res, { error: 'Missing required field: ip' }, 400);
      }
      const restored = await switcher.ipPool.restoreFromDiscarded(body.ip);
      return jsonResponse(res, { message: 'IP restored to available pool', ip: restored.ip });
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
  console.log('nyp-agent - IP Failover Agent');
  console.log('='.repeat(50));
  console.log(`Config path: ${CONFIG_PATH}`);
  console.log(`API port: ${API_PORT}`);
  console.log(`Auth: ${API_TOKEN ? 'enabled' : 'disabled'}`);
  console.log('='.repeat(50));

  // 初始化 Switcher
  switcher = new Switcher(CONFIG_PATH);
  await switcher.init();

  // 启动 HTTP 服务
  const server = http.createServer(handleRequest);

  server.listen(API_PORT, () => {
    console.log(`[API] Server listening on port ${API_PORT}`);
    console.log('');
    console.log('Available endpoints:');
    console.log('  GET  /health       - Health check');
    console.log('  GET  /status       - Get current status');
    console.log('  GET  /config       - Get full configuration');
    console.log('  GET  /pool         - Get IP pool details');
    console.log('  POST /switch       - Manual IP switch');
    console.log('  POST /start        - Start auto-detection');
    console.log('  POST /stop         - Stop auto-detection');
    console.log('  POST /reload       - Reload configuration');
    console.log('  POST /pool/add     - Add IP to pool');
    console.log('  POST /pool/restore - Restore IP from discarded');
    console.log('');
  });

  // 自动启动检测（可选）
  const autoStart = process.env.AUTO_START !== 'false';
  if (autoStart) {
    console.log('[Agent] Auto-starting detection...');
    switcher.start();
  }

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n[Agent] Shutting down...');
    switcher.stop();
    server.close(() => {
      console.log('[Agent] Goodbye!');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n[Agent] Shutting down...');
    switcher.stop();
    server.close(() => {
      process.exit(0);
    });
  });
}

main().catch(error => {
  console.error(`[Fatal] ${error.message}`);
  process.exit(1);
});
