import http from 'http';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Switcher } from './switcher.js';
import { Reporter } from './reporter.js';
import { VERSION } from './version.js';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置文件路径
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '../config/config.json');
const API_PORT = parseInt(process.env.API_PORT || '3000', 10);
const API_HOST = process.env.API_HOST || '0.0.0.0';

// 全局实例
let switcher = null;
let reporter = null;
let apiToken = null;

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
  if (!apiToken) return true;

  // 支持 Bearer token 和 query 参数
  const authHeader = req.headers['authorization'];
  const url = new URL(req.url, `http://${req.headers.host}`);
  const queryToken = url.searchParams.get('token');

  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    return token === apiToken;
  }

  if (queryToken) {
    return queryToken === apiToken;
  }

  return false;
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

    // GET /version - 获取版本
    if (method === 'GET' && pathname === '/version') {
      return jsonResponse(res, { version: VERSION });
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

    // PUT /config - 更新配置
    if (method === 'PUT' && pathname === '/config') {
      const body = await parseBody(req);
      await switcher.updateConfig(body);
      // 更新本地 apiToken
      if (body.api_token !== undefined) {
        apiToken = body.api_token || null;
      }
      return jsonResponse(res, { message: 'Configuration updated', reload_required: true });
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
      if (!body.ip || body.netmask === undefined || !body.gateway || !body.rule_from) {
        return jsonResponse(res, { error: 'Missing required fields: ip, netmask, gateway, rule_from' }, 400);
      }
      await switcher.ipPool.addAvailable({
        ip: body.ip,
        netmask: body.netmask,
        gateway: body.gateway,
        rule_from: body.rule_from
      });
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

    // DELETE /pool/available/:ip - 从可用池删除 IP
    if (method === 'DELETE' && pathname.startsWith('/pool/available/')) {
      const ip = decodeURIComponent(pathname.split('/pool/available/')[1]);
      if (!ip) {
        return jsonResponse(res, { error: 'Missing IP in URL' }, 400);
      }
      const removed = await switcher.ipPool.removeFromAvailable(ip);
      if (removed) {
        return jsonResponse(res, { message: 'IP removed from available pool', ip });
      } else {
        return jsonResponse(res, { error: 'IP not found in available pool' }, 404);
      }
    }

    // DELETE /pool/discarded/:ip - 从废弃池删除 IP
    if (method === 'DELETE' && pathname.startsWith('/pool/discarded/')) {
      const ip = decodeURIComponent(pathname.split('/pool/discarded/')[1]);
      if (!ip) {
        return jsonResponse(res, { error: 'Missing IP in URL' }, 400);
      }
      const removed = await switcher.ipPool.removeFromDiscarded(ip);
      if (removed) {
        return jsonResponse(res, { message: 'IP removed from discarded pool', ip });
      } else {
        return jsonResponse(res, { error: 'IP not found in discarded pool' }, 404);
      }
    }

    // PUT /pool/current - 更新当前 IP 配置（不执行网络切换）
    if (method === 'PUT' && pathname === '/pool/current') {
      const body = await parseBody(req);
      if (!body.ip || body.netmask === undefined || !body.gateway || !body.rule_from) {
        return jsonResponse(res, { error: 'Missing required fields: ip, netmask, gateway, rule_from' }, 400);
      }
      await switcher.ipPool.updateCurrent({
        ip: body.ip,
        netmask: body.netmask,
        gateway: body.gateway,
        rule_from: body.rule_from
      });
      return jsonResponse(res, { message: 'Current IP config updated', ip: body.ip });
    }

    // DELETE /pool/discarded - 清空废弃池
    if (method === 'DELETE' && pathname === '/pool/discarded') {
      const count = await switcher.ipPool.clearDiscarded();
      return jsonResponse(res, { message: `Cleared ${count} IPs from discarded pool` });
    }

    // POST /upgrade - 远程升级
    if (method === 'POST' && pathname === '/upgrade') {
      console.log('[API] Remote upgrade triggered');

      // 发送响应后再执行升级
      jsonResponse(res, { message: 'Upgrade started, agent will restart shortly' });

      // 延迟执行升级，确保响应已发送
      setTimeout(async () => {
        try {
          const upgradeScript = '/opt/nyp-agent/upgrade.sh';
          console.log(`[API] Executing upgrade script: ${upgradeScript}`);
          await execAsync(`bash ${upgradeScript}`, { timeout: 120000 });
        } catch (error) {
          console.error(`[API] Upgrade error: ${error.message}`);
        }
      }, 500);

      return;
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
  console.log(`API listen: ${API_HOST}:${API_PORT}`);
  console.log('='.repeat(50));

  // 初始化 Switcher
  switcher = new Switcher(CONFIG_PATH);
  await switcher.init();

  // 从配置文件读取 token（环境变量优先）
  const config = switcher.ipPool.config;
  apiToken = process.env.API_TOKEN || config.api_token || null;
  console.log(`Auth: ${apiToken ? 'enabled' : 'disabled'}`);

  // 初始化 Reporter
  reporter = new Reporter(config.manager);
  reporter.setStatusGetter(() => switcher.getStatus());

  // 设置 Switcher 的回调
  switcher.setOnSwitch(async (oldIp, newIp, success, message) => {
    await reporter.reportSwitch(oldIp, newIp, success, message);
  });

  // 启动 HTTP 服务
  const server = http.createServer(handleRequest);

  server.listen(API_PORT, API_HOST, () => {
    console.log(`[API] Server listening on ${API_HOST}:${API_PORT}`);
    console.log('');
    console.log('Available endpoints:');
    console.log('  GET    /health              - Health check');
    console.log('  GET    /status              - Get current status');
    console.log('  GET    /config              - Get full configuration');
    console.log('  GET    /pool                - Get IP pool details');
    console.log('  POST   /switch              - Manual IP switch');
    console.log('  POST   /start               - Start auto-detection');
    console.log('  POST   /stop                - Stop auto-detection');
    console.log('  POST   /reload              - Reload configuration');
    console.log('  POST   /pool/add            - Add IP to available pool');
    console.log('  POST   /pool/restore        - Restore IP from discarded');
    console.log('  PUT    /pool/current        - Update current IP config');
    console.log('  DELETE /pool/available/:ip  - Remove IP from available');
    console.log('  DELETE /pool/discarded/:ip  - Remove IP from discarded');
    console.log('  DELETE /pool/discarded      - Clear discarded pool');
    console.log('');
  });

  // 自动启动检测（可选）
  const autoStart = process.env.AUTO_START !== 'false';
  if (autoStart) {
    console.log('[Agent] Auto-starting detection...');
    switcher.start();
  }

  // 启动 Reporter
  reporter.start();

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n[Agent] Shutting down...');
    switcher.stop();
    reporter.stop();
    server.close(() => {
      console.log('[Agent] Goodbye!');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n[Agent] Shutting down...');
    switcher.stop();
    reporter.stop();
    server.close(() => {
      process.exit(0);
    });
  });
}

main().catch(error => {
  console.error(`[Fatal] ${error.message}`);
  process.exit(1);
});
