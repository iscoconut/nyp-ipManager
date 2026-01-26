import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * IP 状态检测模块
 * 检测 curl、ping、网卡带宽
 */
export class Detector {
  constructor(config) {
    this.interface = config.interface;
    this.curlTarget = config.curl_target || 'baidu.com';
    this.pingTarget = config.ping_target || '223.5.5.5';
    this.curlTimeout = config.curl_timeout || 3;
    this.pingTimeout = config.ping_timeout || 3;
    this.bandwidthThreshold = config.bandwidth_threshold || 10; // Mbps

    // 用于计算带宽的上一次统计
    this.lastStats = null;
    this.lastStatsTime = null;
  }

  /**
   * 执行 curl 检测
   * @returns {boolean} 成功返回 true
   */
  async checkCurl() {
    try {
      await execAsync(
        `curl --interface ${this.interface} -so /dev/null -m ${this.curlTimeout} ${this.curlTarget}`,
        { timeout: (this.curlTimeout + 2) * 1000 }
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 执行 ping 检测
   * @returns {boolean} 成功返回 true
   */
  async checkPing() {
    try {
      await execAsync(
        `ping -I ${this.interface} -c 1 -W ${this.pingTimeout} ${this.pingTarget}`,
        { timeout: (this.pingTimeout + 2) * 1000 }
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 读取网卡流量统计
   * @returns {object} { rx_bytes, tx_bytes }
   */
  async getNetworkStats() {
    try {
      const rxPath = `/sys/class/net/${this.interface}/statistics/rx_bytes`;
      const txPath = `/sys/class/net/${this.interface}/statistics/tx_bytes`;

      const [rxBytes, txBytes] = await Promise.all([
        fs.readFile(rxPath, 'utf-8'),
        fs.readFile(txPath, 'utf-8')
      ]);

      return {
        rx_bytes: parseInt(rxBytes.trim(), 10),
        tx_bytes: parseInt(txBytes.trim(), 10)
      };
    } catch (error) {
      console.error(`Failed to read network stats: ${error.message}`);
      return null;
    }
  }

  /**
   * 计算当前带宽 (Mbps)
   * 基于两次统计的差值计算
   * @returns {number|null} 带宽 Mbps，如果无法计算返回 null
   */
  async calculateBandwidth() {
    const currentStats = await this.getNetworkStats();
    const currentTime = Date.now();

    if (!currentStats) {
      return null;
    }

    if (!this.lastStats || !this.lastStatsTime) {
      // 首次调用，保存统计，返回 null
      this.lastStats = currentStats;
      this.lastStatsTime = currentTime;
      return null;
    }

    const timeDiff = (currentTime - this.lastStatsTime) / 1000; // 秒
    if (timeDiff <= 0) {
      return null;
    }

    // 计算收发总字节差
    const rxDiff = currentStats.rx_bytes - this.lastStats.rx_bytes;
    const txDiff = currentStats.tx_bytes - this.lastStats.tx_bytes;
    const totalDiff = rxDiff + txDiff;

    // 更新统计
    this.lastStats = currentStats;
    this.lastStatsTime = currentTime;

    // 处理计数器溢出或重置的情况
    if (totalDiff < 0) {
      return null;
    }

    // 字节/秒 -> Mbps
    const bytesPerSec = totalDiff / timeDiff;
    const mbps = (bytesPerSec * 8) / (1024 * 1024);

    return mbps;
  }

  /**
   * 检查带宽是否低于阈值
   * @returns {boolean} 低于阈值返回 true
   */
  async isBandwidthLow() {
    const bandwidth = await this.calculateBandwidth();

    if (bandwidth === null) {
      // 无法计算带宽时，视为正常（避免误判）
      return false;
    }

    return bandwidth < this.bandwidthThreshold;
  }

  /**
   * 执行完整检测
   * @returns {object} 检测结果
   */
  async check() {
    const curlOk = await this.checkCurl();
    const pingOk = await this.checkPing();

    const result = {
      timestamp: new Date().toISOString(),
      interface: this.interface,
      curl: curlOk,
      ping: pingOk,
      connectivity: curlOk || pingOk, // 任一成功即连通
      bandwidth: null,
      bandwidth_low: false,
      should_switch: false
    };

    // 只有在 curl 和 ping 都失败时才检测带宽
    if (!curlOk && !pingOk) {
      const bandwidth = await this.calculateBandwidth();
      result.bandwidth = bandwidth;

      if (bandwidth !== null) {
        result.bandwidth_low = bandwidth < this.bandwidthThreshold;
        // curl/ping 都失败且带宽低于阈值，标记需要切换
        result.should_switch = result.bandwidth_low;
      }
    }

    return result;
  }

  /**
   * 获取当前网卡 IP（用于验证）
   */
  async getCurrentIP() {
    try {
      const { stdout } = await execAsync(
        `ip -4 addr show ${this.interface} | grep -oP '(?<=inet\\s)\\d+(\\.\\d+){3}'`
      );
      return stdout.trim().split('\n')[0] || null;
    } catch (error) {
      return null;
    }
  }
}
