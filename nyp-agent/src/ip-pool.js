import fs from 'fs/promises';
import path from 'path';

/**
 * IP 池管理模块
 * 管理可用 IP、当前 IP、废弃 IP
 */
export class IPPool {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = null;
  }

  /**
   * 加载配置
   */
  async load() {
    const content = await fs.readFile(this.configPath, 'utf-8');
    this.config = JSON.parse(content);
    return this.config;
  }

  /**
   * 保存配置
   */
  async save() {
    const content = JSON.stringify(this.config, null, 2);
    await fs.writeFile(this.configPath, content, 'utf-8');
  }

  /**
   * 获取当前 IP 配置
   */
  getCurrent() {
    return this.config.current;
  }

  /**
   * 获取可用 IP 数量
   */
  getAvailableCount() {
    return this.config.available.length;
  }

  /**
   * 检查是否有可用 IP
   */
  hasAvailable() {
    return this.config.available.length > 0;
  }

  /**
   * 是否 IP 池耗尽
   */
  isExhausted() {
    return this.config.available.length === 0;
  }

  /**
   * 获取下一个可用 IP（不移除）
   */
  peekNext() {
    if (!this.hasAvailable()) {
      return null;
    }
    return this.config.available[0];
  }

  /**
   * 切换到下一个 IP
   * - 将当前 IP 移入废弃池
   * - 从可用池取出一个作为新的当前 IP
   * @returns {object|null} 新的 IP 配置，如果无可用 IP 返回 null
   */
  async switchToNext() {
    if (!this.hasAvailable()) {
      return null;
    }

    const oldCurrent = this.config.current;
    const newCurrent = this.config.available.shift();

    // 将旧 IP 放入废弃池
    if (oldCurrent) {
      this.config.discarded.push({
        ...oldCurrent,
        discarded_at: new Date().toISOString(),
        reason: 'auto_switch'
      });
    }

    this.config.current = newCurrent;
    await this.save();

    return {
      old: oldCurrent,
      new: newCurrent
    };
  }

  /**
   * 手动添加 IP 到可用池
   */
  async addAvailable(ipConfig) {
    this.config.available.push(ipConfig);
    await this.save();
  }

  /**
   * 从废弃池恢复 IP 到可用池
   */
  async restoreFromDiscarded(ip) {
    const index = this.config.discarded.findIndex(item => item.ip === ip);
    if (index === -1) {
      throw new Error(`IP ${ip} not found in discarded pool`);
    }

    const restored = this.config.discarded.splice(index, 1)[0];
    // 移除废弃时添加的元数据
    delete restored.discarded_at;
    delete restored.reason;

    this.config.available.push(restored);
    await this.save();

    return restored;
  }

  /**
   * 清空废弃池
   */
  async clearDiscarded() {
    const count = this.config.discarded.length;
    this.config.discarded = [];
    await this.save();
    return count;
  }

  /**
   * 从可用池删除 IP
   */
  async removeFromAvailable(ip) {
    const index = this.config.available.findIndex(item => item.ip === ip);
    if (index === -1) {
      return false;
    }
    this.config.available.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * 从废弃池删除 IP
   */
  async removeFromDiscarded(ip) {
    const index = this.config.discarded.findIndex(item => item.ip === ip);
    if (index === -1) {
      return false;
    }
    this.config.discarded.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * 更新当前 IP 配置（不执行网络切换）
   */
  async updateCurrent(ipConfig) {
    this.config.current = ipConfig;
    await this.save();
  }

  /**
   * 获取完整状态
   */
  getStatus() {
    return {
      interface: this.config.interface,
      config_type: this.config.config_type,
      current: this.config.current,
      available_count: this.config.available.length,
      discarded_count: this.config.discarded.length,
      exhausted: this.isExhausted()
    };
  }

  /**
   * 获取完整配置（用于 API）
   */
  getFullConfig() {
    return {
      interface: this.config.interface,
      config_type: this.config.config_type,
      config_file: this.config.config_file,
      route_table: this.config.route_table,
      current: this.config.current,
      available: this.config.available,
      discarded: this.config.discarded
    };
  }
}
