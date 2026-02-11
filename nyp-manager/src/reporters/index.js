import { createNyanpassReporter } from './nyanpass.js';
import { createAliyunGtmReporter } from './aliyun-gtm.js';
import { getReporters, addLog } from '../db.js';

/**
 * 上报调度器
 * 根据节点配置的上报目标，执行上报操作
 */
export class ReporterDispatcher {
  constructor() {
    this.reporters = new Map(); // 缓存上报器实例
  }

  /**
   * 获取或创建上报器实例
   */
  getReporter(type, config) {
    const key = `${type}:${JSON.stringify(config)}`;

    if (!this.reporters.has(key)) {
      switch (type) {
        case 'nyanpass':
          this.reporters.set(key, createNyanpassReporter(config));
          break;
        case 'aliyun-gtm':
          this.reporters.set(key, createAliyunGtmReporter(config));
          break;
        default:
          console.log(`[Reporter] Unknown reporter type: ${type}`);
          return null;
      }
    }

    return this.reporters.get(key);
  }

  /**
   * 执行上报
   */
  async report(nodeId, newIp, oldIp = null) {
    const reporters = getReporters(nodeId);
    const results = [];

    for (const reporterConfig of reporters) {
      if (!reporterConfig.enabled) {
        continue;
      }

      const reporter = this.getReporter(reporterConfig.type, reporterConfig.config);
      if (!reporter) {
        continue;
      }

      console.log(`[Reporter] Reporting to ${reporterConfig.type} for node ${nodeId}: ${newIp}`);

      try {
        const result = await reporter.report(newIp);
        results.push({
          type: reporterConfig.type,
          ...result
        });

        // 记录日志
        addLog({
          node_id: nodeId,
          action: `report_${reporterConfig.type}`,
          old_ip: oldIp || result.old_ip,
          new_ip: newIp,
          result: result.success ? 'success' : 'failed',
          message: result.message
        });

      } catch (error) {
        console.error(`[Reporter] Error reporting to ${reporterConfig.type}: ${error.message}`);
        results.push({
          type: reporterConfig.type,
          success: false,
          message: error.message
        });

        addLog({
          node_id: nodeId,
          action: `report_${reporterConfig.type}`,
          old_ip: oldIp,
          new_ip: newIp,
          result: 'failed',
          message: error.message
        });
      }
    }

    return results;
  }
}

// 单例
let dispatcher = null;

export function getDispatcher() {
  if (!dispatcher) {
    dispatcher = new ReporterDispatcher();
  }
  return dispatcher;
}
