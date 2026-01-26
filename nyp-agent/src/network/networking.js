import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * networking (ifupdown) 网络配置实现
 * 适用于使用 /etc/network/interfaces 的系统
 */
export class NetworkingConfig {
  constructor(config) {
    this.interface = config.interface;
    this.configFile = config.config_file;
    this.routeTable = config.route_table;
  }

  /**
   * 关闭网卡
   */
  async ifdown() {
    try {
      await execAsync(`ifdown ${this.interface}`, { timeout: 30000 });
      return true;
    } catch (error) {
      console.error(`ifdown failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 启动网卡
   */
  async ifup() {
    try {
      await execAsync(`ifup ${this.interface}`, { timeout: 30000 });
      return true;
    } catch (error) {
      console.error(`ifup failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 读取配置文件
   */
  async readConfig() {
    return await fs.readFile(this.configFile, 'utf-8');
  }

  /**
   * 写入配置文件
   */
  async writeConfig(content) {
    // 备份原配置
    const backupPath = `${this.configFile}.bak.${Date.now()}`;
    const currentContent = await this.readConfig();
    await fs.writeFile(backupPath, currentContent, 'utf-8');

    // 写入新配置
    await fs.writeFile(this.configFile, content, 'utf-8');
  }

  /**
   * 生成网卡配置块
   */
  generateInterfaceBlock(ipConfig) {
    const { ip, netmask, gateway, rule_from } = ipConfig;
    const table = this.routeTable;
    const iface = this.interface;

    return `auto ${iface}
iface ${iface} inet static
    address ${ip}/${netmask}
    post-up ip rule add from ${rule_from} table ${table}
    post-up ip route add default via ${gateway} dev ${iface} table ${table}
    pre-down ip rule del from ${rule_from} table ${table}
    pre-down ip route del default via ${gateway} dev ${iface} table ${table}`;
  }

  /**
   * 更新配置文件中的网卡配置
   */
  async updateInterfaceConfig(content, newIpConfig) {
    const iface = this.interface;
    const newBlock = this.generateInterfaceBlock(newIpConfig);

    // 匹配整个网卡配置块（从 auto/iface 开始到下一个 auto/iface 或文件末尾）
    // 这个正则匹配 auto ethX 和对应的 iface ethX inet static 块
    const pattern = new RegExp(
      `(auto\\s+${iface}\\s*\\n)?iface\\s+${iface}\\s+inet\\s+static[\\s\\S]*?(?=\\n(?:auto|iface)\\s|$)`,
      'g'
    );

    if (pattern.test(content)) {
      // 替换现有配置
      return content.replace(pattern, newBlock);
    } else {
      // 追加新配置
      return content.trim() + '\n\n' + newBlock + '\n';
    }
  }

  /**
   * 切换 IP
   * @param {object} newIpConfig 新的 IP 配置
   * @returns {object} 切换结果
   */
  async switchIP(newIpConfig) {
    const result = {
      success: false,
      message: '',
      old_config: null,
      new_config: newIpConfig
    };

    try {
      // 1. 读取当前配置
      const currentContent = await this.readConfig();

      // 2. 关闭网卡
      console.log(`[networking] ifdown ${this.interface}...`);
      const downOk = await this.ifdown();
      if (!downOk) {
        result.message = 'Failed to bring down interface';
        // 继续尝试，有时候 ifdown 失败但可以继续
      }

      // 3. 更新配置文件
      console.log(`[networking] Updating config file...`);
      const newContent = await this.updateInterfaceConfig(currentContent, newIpConfig);
      await this.writeConfig(newContent);

      // 4. 启动网卡
      console.log(`[networking] ifup ${this.interface}...`);
      const upOk = await this.ifup();
      if (!upOk) {
        result.message = 'Failed to bring up interface';
        return result;
      }

      // 5. 等待网络稳定
      await new Promise(resolve => setTimeout(resolve, 2000));

      result.success = true;
      result.message = 'IP switched successfully';
      return result;

    } catch (error) {
      result.message = `Switch failed: ${error.message}`;
      console.error(result.message);
      return result;
    }
  }
}
