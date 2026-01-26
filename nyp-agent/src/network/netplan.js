import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

/**
 * 简单的 YAML 解析和生成
 * 不引入外部依赖，手动处理 netplan 配置
 */

/**
 * netplan 网络配置实现
 * 适用于使用 /etc/netplan/*.yaml 的系统
 */
export class NetplanConfig {
  constructor(config) {
    this.interface = config.interface;
    this.configFile = config.config_file;
    this.routeTable = config.route_table;
  }

  /**
   * 应用 netplan 配置
   */
  async apply() {
    try {
      await execAsync('netplan apply', { timeout: 30000 });
      return true;
    } catch (error) {
      console.error(`netplan apply failed: ${error.message}`);
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
   * 解析 YAML 中指定网卡的配置
   * 简化实现：只处理我们需要的字段
   */
  parseInterfaceBlock(content) {
    const iface = this.interface;
    const lines = content.split('\n');

    let inInterface = false;
    let interfaceIndent = 0;
    let startLine = -1;
    let endLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      const indent = line.length - trimmed.length;

      // 查找网卡定义行
      if (trimmed.startsWith(`${iface}:`)) {
        inInterface = true;
        interfaceIndent = indent;
        startLine = i;
        continue;
      }

      // 在网卡块内
      if (inInterface) {
        // 如果遇到同级或更高级别的配置，结束
        if (trimmed && !trimmed.startsWith('#') && indent <= interfaceIndent) {
          endLine = i;
          break;
        }
      }
    }

    // 如果到文件末尾还在网卡块内
    if (inInterface && endLine === -1) {
      endLine = lines.length;
    }

    return { startLine, endLine, lines };
  }

  /**
   * 生成网卡配置块
   */
  generateInterfaceBlock(ipConfig, baseIndent = 8) {
    const { ip, netmask, gateway, rule_from } = ipConfig;
    const table = this.routeTable;
    const iface = this.interface;
    const spaces = ' '.repeat(baseIndent);
    const spaces2 = ' '.repeat(baseIndent + 2);
    const spaces3 = ' '.repeat(baseIndent + 4);

    return `${spaces}${iface}:
${spaces2}addresses:
${spaces3}- ${ip}/${netmask}
${spaces2}routes:
${spaces3}- to: 0.0.0.0/0
${spaces3}  via: ${gateway}
${spaces3}  table: ${table}
${spaces2}routing-policy:
${spaces3}- from: ${rule_from}
${spaces3}  table: ${table}`;
  }

  /**
   * 更新配置文件中的网卡配置
   */
  async updateInterfaceConfig(content, newIpConfig) {
    const { startLine, endLine, lines } = this.parseInterfaceBlock(content);

    if (startLine === -1) {
      // 网卡配置不存在，需要添加（这种情况比较复杂，暂不处理）
      throw new Error(`Interface ${this.interface} not found in config file`);
    }

    // 获取原始缩进
    const originalLine = lines[startLine];
    const baseIndent = originalLine.length - originalLine.trimStart().length;

    // 生成新配置块
    const newBlock = this.generateInterfaceBlock(newIpConfig, baseIndent);
    const newBlockLines = newBlock.split('\n');

    // 替换配置
    const newLines = [
      ...lines.slice(0, startLine),
      ...newBlockLines,
      ...lines.slice(endLine)
    ];

    return newLines.join('\n');
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
      console.log(`[netplan] Reading config file...`);
      const currentContent = await this.readConfig();

      // 2. 更新配置文件
      console.log(`[netplan] Updating config file...`);
      const newContent = await this.updateInterfaceConfig(currentContent, newIpConfig);
      await this.writeConfig(newContent);

      // 3. 应用配置
      console.log(`[netplan] Applying configuration...`);
      const applyOk = await this.apply();
      if (!applyOk) {
        result.message = 'Failed to apply netplan configuration';
        return result;
      }

      // 4. 等待网络稳定
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
