import { Detector } from './detector.js';
import { IPPool } from './ip-pool.js';
import { NetworkManager } from './network/index.js';

/**
 * IP 切换调度器
 * 协调检测、IP 池管理和网络配置
 */
export class Switcher {
  constructor(configPath) {
    this.configPath = configPath;
    this.ipPool = null;
    this.detector = null;
    this.networkManager = null;

    // 状态
    this.failCount = 0;
    this.failThreshold = 10;
    this.checkInterval = 5000; // 5秒
    this.isRunning = false;
    this.isSwitching = false;
    this.timer = null;

    // 统计
    this.stats = {
      total_checks: 0,
      failed_checks: 0,
      switches: 0,
      last_check: null,
      last_switch: null,
      last_check_result: null
    };

    // 回调函数
    this.onSwitch = null;
  }

  /**
   * 设置 IP 切换回调
   */
  setOnSwitch(callback) {
    this.onSwitch = callback;
  }

  /**
   * 初始化
   */
  async init() {
    // 加载 IP 池配置
    this.ipPool = new IPPool(this.configPath);
    await this.ipPool.load();

    const config = this.ipPool.config;

    // 读取检测配置
    this.failThreshold = config.fail_threshold || 10;
    this.checkInterval = config.check_interval || 3000;

    // 初始化检测器
    this.detector = new Detector({
      interface: config.interface,
      curl_target_1: config.curl_target_1 || config.curl_target,
      curl_target_2: config.curl_target_2,
      curl_timeout: config.curl_timeout,
      bandwidth_threshold: config.bandwidth_threshold
    });

    // 初始化网络管理器
    this.networkManager = new NetworkManager(config);
    this.networkManager.init();

    console.log(`[Switcher] Initialized for interface ${config.interface}`);
    console.log(`[Switcher] Fail threshold: ${this.failThreshold}, Check interval: ${this.checkInterval}ms`);

    return this;
  }

  /**
   * 执行一次检测
   */
  async doCheck() {
    if (this.isSwitching) {
      console.log('[Switcher] Skip check: switching in progress');
      return null;
    }

    this.stats.total_checks++;
    const result = await this.detector.check();
    this.stats.last_check = result.timestamp;
    this.stats.last_check_result = result;

    console.log(`[Switcher] Check result: target1=${result.target1}, target2=${result.target2}, bandwidth=${result.bandwidth?.toFixed(2) || 'N/A'} Mbps`);

    if (result.connectivity) {
      // 连通性正常，重置失败计数
      this.failCount = 0;
    } else if (result.should_switch) {
      // curl/ping 都失败且带宽低
      this.failCount++;
      this.stats.failed_checks++;
      console.log(`[Switcher] Fail count: ${this.failCount}/${this.failThreshold}`);

      if (this.failCount >= this.failThreshold) {
        console.log('[Switcher] Threshold reached, triggering IP switch...');
        await this.triggerSwitch();
      }
    } else {
      // curl/ping 失败但带宽正常或无法计算
      // 仍然计入失败
      this.failCount++;
      this.stats.failed_checks++;
      console.log(`[Switcher] Fail count (no bandwidth data): ${this.failCount}/${this.failThreshold}`);

      if (this.failCount >= this.failThreshold) {
        console.log('[Switcher] Threshold reached, triggering IP switch...');
        await this.triggerSwitch();
      }
    }

    return result;
  }

  /**
   * 触发 IP 切换
   */
  async triggerSwitch() {
    if (this.isSwitching) {
      console.log('[Switcher] Already switching, skip');
      return { success: false, message: 'Already switching' };
    }

    // 检查是否有可用 IP
    if (this.ipPool.isExhausted()) {
      console.log('[Switcher] IP pool exhausted, cannot switch');
      return {
        success: false,
        message: 'IP pool exhausted',
        pool_exhausted: true
      };
    }

    this.isSwitching = true;
    const oldIp = this.ipPool.getCurrent();

    try {
      // 从池中获取下一个 IP
      const switchResult = await this.ipPool.switchToNext();
      if (!switchResult) {
        return {
          success: false,
          message: 'Failed to get next IP from pool',
          pool_exhausted: true
        };
      }

      const newIpConfig = switchResult.new;

      // 执行网络切换
      console.log(`[Switcher] Switching from ${oldIp?.ip} to ${newIpConfig.ip}...`);
      const netResult = await this.networkManager.switchIP(newIpConfig);

      if (netResult.success) {
        // 重置失败计数
        this.failCount = 0;
        this.stats.switches++;
        this.stats.last_switch = new Date().toISOString();

        console.log(`[Switcher] Switch successful: ${oldIp?.ip} -> ${newIpConfig.ip}`);

        // 调用回调
        if (this.onSwitch) {
          try {
            await this.onSwitch(oldIp?.ip, newIpConfig.ip, true, 'IP switched successfully');
          } catch (e) {
            console.error(`[Switcher] onSwitch callback error: ${e.message}`);
          }
        }

        return {
          success: true,
          message: 'IP switched successfully',
          old_ip: oldIp?.ip,
          new_ip: newIpConfig.ip,
          pool_exhausted: this.ipPool.isExhausted()
        };
      } else {
        console.error(`[Switcher] Network switch failed: ${netResult.message}`);

        // 调用回调（失败）
        if (this.onSwitch) {
          try {
            await this.onSwitch(oldIp?.ip, newIpConfig.ip, false, netResult.message);
          } catch (e) {
            console.error(`[Switcher] onSwitch callback error: ${e.message}`);
          }
        }

        return {
          success: false,
          message: netResult.message,
          old_ip: oldIp?.ip,
          attempted_ip: newIpConfig.ip
        };
      }

    } catch (error) {
      console.error(`[Switcher] Switch error: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    } finally {
      this.isSwitching = false;
    }
  }

  /**
   * 手动切换 IP（API 调用）
   */
  async manualSwitch() {
    console.log('[Switcher] Manual switch triggered');
    return await this.triggerSwitch();
  }

  /**
   * 启动自动检测
   */
  start() {
    if (this.isRunning) {
      console.log('[Switcher] Already running');
      return;
    }

    this.isRunning = true;
    console.log(`[Switcher] Starting auto-detection (interval: ${this.checkInterval}ms)`);

    // 立即执行一次检测
    this.doCheck();

    // 设置定时检测
    this.timer = setInterval(() => {
      this.doCheck();
    }, this.checkInterval);
  }

  /**
   * 停止自动检测
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Switcher] Stopped');
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    const poolStatus = this.ipPool.getStatus();
    const currentIp = this.detector ? this.detector.getCurrentIP() : null;

    return {
      running: this.isRunning,
      switching: this.isSwitching,
      interface: poolStatus.interface,
      config_type: poolStatus.config_type,
      current_ip: poolStatus.current?.ip,
      fail_count: this.failCount,
      fail_threshold: this.failThreshold,
      pool: {
        available: poolStatus.available_count,
        discarded: poolStatus.discarded_count,
        exhausted: poolStatus.exhausted
      },
      stats: this.stats
    };
  }

  /**
   * 获取完整配置（用于 API）
   */
  getFullConfig() {
    return this.ipPool.getFullConfig();
  }

  /**
   * 重新加载配置
   */
  async reload() {
    await this.ipPool.load();
    console.log('[Switcher] Configuration reloaded');
  }
}
