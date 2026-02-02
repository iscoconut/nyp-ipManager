import { WebSocketServer } from 'ws';
import { getAllNodes, getNode } from './db.js';

let wss = null;
const clients = new Set();

// 节点状态缓存
const nodeStatusCache = new Map();

/**
 * 初始化 WebSocket 服务
 */
export function initWebSocket(server, verifyToken) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // 验证 Token
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (verifyToken && !verifyToken(token)) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    console.log('[WS] Client connected');
    clients.add(ws);

    // 发送当前所有节点状态
    sendAllNodeStatus(ws);

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
      clients.delete(ws);
    });
  });

  console.log('[WS] WebSocket server initialized');
}

/**
 * 发送所有节点状态给单个客户端
 */
function sendAllNodeStatus(ws) {
  const nodes = getAllNodes();
  const nodesWithStatus = nodes.map(node => ({
    ...node,
    status: nodeStatusCache.get(node.id) || null
  }));

  ws.send(JSON.stringify({
    type: 'nodes',
    data: nodesWithStatus
  }));
}

/**
 * 广播消息给所有客户端
 */
export function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
}

/**
 * 更新节点状态并广播
 */
export function updateNodeStatusAndBroadcast(nodeId, status) {
  nodeStatusCache.set(nodeId, status);

  broadcast({
    type: 'node_status',
    nodeId,
    status
  });
}

/**
 * 广播节点列表更新
 */
export function broadcastNodesUpdate() {
  const nodes = getAllNodes();
  const nodesWithStatus = nodes.map(node => ({
    ...node,
    status: nodeStatusCache.get(node.id) || null
  }));

  broadcast({
    type: 'nodes',
    data: nodesWithStatus
  });
}

/**
 * 获取连接的客户端数量
 */
export function getClientCount() {
  return clients.size;
}

/**
 * 获取缓存的节点状态
 */
export function getCachedStatus(nodeId) {
  return nodeStatusCache.get(nodeId);
}

/**
 * 清除节点状态缓存
 */
export function clearStatusCache(nodeId) {
  nodeStatusCache.delete(nodeId);
}
