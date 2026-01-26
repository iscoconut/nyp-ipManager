import fs from 'fs';
import { NetworkingConfig } from './networking.js';
import { NetplanConfig } from './netplan.js';

/**
 * 网络配置统一接口
 * 自动检测系统类型并使用对应的实现
 */
export class NetworkManager {
  constructor(config) {
    this.config = config;
    this.driver = null;
  }

  /**
   * 自动检测网络配置类型
   */
  static detectConfigType() {
    // 检查是否有 netplan
    if (fs.existsSync('/etc/netplan') && fs.readdirSync('/etc/netplan').some(f => f.endsWith('.yaml'))) {
      return 'netplan';
    }

    // 检查是否有 networking (ifupdown)
    if (fs.existsSync('/etc/network/interfaces') || fs.existsSync('/etc/network/interfaces.d')) {
      return 'networking';
    }

    return 'unknown';
  }

  /**
   * 初始化网络管理器
   */
  init() {
    const configType = this.config.config_type || NetworkManager.detectConfigType();

    switch (configType) {
      case 'netplan':
        this.driver = new NetplanConfig(this.config);
        break;
      case 'networking':
        this.driver = new NetworkingConfig(this.config);
        break;
      default:
        throw new Error(`Unsupported network configuration type: ${configType}`);
    }

    console.log(`[NetworkManager] Using ${configType} driver for ${this.config.interface}`);
    return this;
  }

  /**
   * 切换 IP
   */
  async switchIP(newIpConfig) {
    if (!this.driver) {
      throw new Error('NetworkManager not initialized');
    }
    return await this.driver.switchIP(newIpConfig);
  }

  /**
   * 获取配置类型
   */
  getConfigType() {
    return this.config.config_type || NetworkManager.detectConfigType();
  }
}
