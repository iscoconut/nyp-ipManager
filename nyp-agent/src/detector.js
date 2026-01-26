import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * IP 状态检测模块
 * 检测两个 curl 目标、网卡带宽
 */
export class Detector {
  constructor(config) {
    this.interface = config.interface;
    this.curlTarget1 = config.curl_target_1 || config.curl_target || 'baidu.com';
    this.curlTarget2 = config.curl_target_2 || 'https://223.5.5.5/dns-query';
    this.curlTimeout = config.curl_timeout || 3;
    this.bandwidthThreshold = config.bandwidth_threshold || 10; // Mbps

    // 用于计算带宽的上一次统计
    this.lastStats = null;
    this.lastStatsTime = null;
  }

  /**
   * 执行 curl 检测
   * @param {string} target 目标 URL
   * @returns {boolean} 成功返回 true
   */
  async curlCheck(target) {
    try {
      await execAsync(
        `curl --interface ${this.interface} -so /dev/null -m ${this.curlTimeout} "${target}"`,
        { timeout: (this.curlTimeout + 2) * 1000 }
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检测目标 1
   */
  async checkTarget1() {
    return await this.curlCheck(this.curlTarget1);
  }

  /**
   * 检测目标 2
   */
  async checkTarget2() {
    return await this.curlCheck(this.curlTarget2);
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
    const target1Ok = await this.checkTarget1();
    const target2Ok = await this.checkTarget2();

    const result = {
      timestamp: new Date().toISOString(),
      interface: this.interface,
      target1: target1Ok,
      target2: target2Ok,
      target1_url: this.curlTarget1,
      target2_url: this.curlTarget2,
      connectivity: target1Ok || target2Ok, // 任一成功即连通
      bandwidth: null,
      bandwidth_low: false,
      should_switch: false
    };

    // 只有在两个目标都失败时才检测带宽
    if (!target1Ok && !target2Ok) {
      const bandwidth = await this.calculateBandwidth();
      result.bandwidth = bandwidth;

      if (bandwidth !== null) {
        result.bandwidth_low = bandwidth < this.bandwidthThreshold;
        // 两个目标都失败且带宽低于阈值，标记需要切换
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
