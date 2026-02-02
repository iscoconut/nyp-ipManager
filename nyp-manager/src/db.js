import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/manager.db');

let db = null;

/**
 * 初始化数据库
 */
export function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // 创建表
  db.exec(`
    -- 节点表
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      token TEXT,
      status TEXT DEFAULT '{}',
      last_report_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 上报目标表
    CREATE TABLE IF NOT EXISTS reporters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    -- 操作日志表
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT,
      action TEXT NOT NULL,
      old_ip TEXT,
      new_ip TEXT,
      result TEXT,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_logs_node_id ON logs(node_id);
    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_reporters_node_id ON reporters(node_id);
  `);

  console.log('[DB] Database initialized');
  return db;
}

/**
 * 获取数据库实例
 */
export function getDB() {
  if (!db) {
    initDB();
  }
  return db;
}

// ========== 节点操作 ==========

/**
 * 获取所有节点
 */
export function getAllNodes() {
  const stmt = getDB().prepare('SELECT * FROM nodes ORDER BY created_at DESC');
  return stmt.all().map(row => ({
    ...row,
    status: JSON.parse(row.status || '{}')
  }));
}

/**
 * 获取单个节点
 */
export function getNode(id) {
  const stmt = getDB().prepare('SELECT * FROM nodes WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return {
    ...row,
    status: JSON.parse(row.status || '{}')
  };
}

/**
 * 创建节点
 */
export function createNode(node) {
  const stmt = getDB().prepare(`
    INSERT INTO nodes (id, name, url, token)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(node.id, node.name, node.url, node.token || null);
  return getNode(node.id);
}

/**
 * 更新节点
 */
export function updateNode(id, updates) {
  const fields = [];
  const values = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.url !== undefined) {
    fields.push('url = ?');
    values.push(updates.url);
  }
  if (updates.token !== undefined) {
    fields.push('token = ?');
    values.push(updates.token);
  }

  if (fields.length === 0) return getNode(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  const stmt = getDB().prepare(`UPDATE nodes SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
  return getNode(id);
}

/**
 * 更新节点状态（Agent 上报）
 */
export function updateNodeStatus(id, status) {
  const stmt = getDB().prepare(`
    UPDATE nodes
    SET status = ?, last_report_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(JSON.stringify(status), id);
  return getNode(id);
}

/**
 * 删除节点
 */
export function deleteNode(id) {
  const stmt = getDB().prepare('DELETE FROM nodes WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ========== 上报目标操作 ==========

/**
 * 获取节点的所有上报目标
 */
export function getReporters(nodeId) {
  const stmt = getDB().prepare('SELECT * FROM reporters WHERE node_id = ?');
  return stmt.all(nodeId).map(row => ({
    ...row,
    config: JSON.parse(row.config || '{}'),
    enabled: !!row.enabled
  }));
}

/**
 * 获取单个上报目标
 */
export function getReporter(id) {
  const stmt = getDB().prepare('SELECT * FROM reporters WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return {
    ...row,
    config: JSON.parse(row.config || '{}'),
    enabled: !!row.enabled
  };
}

/**
 * 创建上报目标
 */
export function createReporter(reporter) {
  const stmt = getDB().prepare(`
    INSERT INTO reporters (node_id, type, config, enabled)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    reporter.node_id,
    reporter.type,
    JSON.stringify(reporter.config || {}),
    reporter.enabled !== false ? 1 : 0
  );
  return getReporter(result.lastInsertRowid);
}

/**
 * 更新上报目标
 */
export function updateReporter(id, updates) {
  const fields = [];
  const values = [];

  if (updates.type !== undefined) {
    fields.push('type = ?');
    values.push(updates.type);
  }
  if (updates.config !== undefined) {
    fields.push('config = ?');
    values.push(JSON.stringify(updates.config));
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }

  if (fields.length === 0) return getReporter(id);

  values.push(id);
  const stmt = getDB().prepare(`UPDATE reporters SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
  return getReporter(id);
}

/**
 * 删除上报目标
 */
export function deleteReporter(id) {
  const stmt = getDB().prepare('DELETE FROM reporters WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ========== 日志操作 ==========

/**
 * 添加日志
 */
export function addLog(log) {
  const stmt = getDB().prepare(`
    INSERT INTO logs (node_id, action, old_ip, new_ip, result, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    log.node_id || null,
    log.action,
    log.old_ip || null,
    log.new_ip || null,
    log.result || null,
    log.message || null
  );
  return result.lastInsertRowid;
}

/**
 * 获取日志
 */
export function getLogs(options = {}) {
  const { nodeId, limit = 100, offset = 0 } = options;

  let sql = 'SELECT * FROM logs';
  const params = [];

  if (nodeId) {
    sql += ' WHERE node_id = ?';
    params.push(nodeId);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const stmt = getDB().prepare(sql);
  return stmt.all(...params);
}

/**
 * 清理旧日志
 */
export function cleanOldLogs(days = 30) {
  const stmt = getDB().prepare(`
    DELETE FROM logs
    WHERE created_at < datetime('now', '-' || ? || ' days')
  `);
  const result = stmt.run(days);
  return result.changes;
}
