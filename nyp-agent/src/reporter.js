/**
 * Manager 上报模块
 * 负责向中心管理面板上报状态和事件
 */
export class Reporter {
  constructor(config) {
    this.managerUrl = config?.url || null;
    this.token = config?.token || null;
    this.nodeId = config?.node_id || null;
    this.reportInterval = config?.report_interval || 60000;
    this.enabled = !!this.managerUrl;
    this.timer = null;
    this.statusGetter = null;
  }

  /**
   * 设置状态获取函数
   */
  setStatusGetter(fn) {
    this.statusGetter = fn;
  }

  /**
   * 发送 HTTP 请求到 Manager
   */
  async send(endpoint, data) {
    if (!this.enabled) return null;

    const url = `${this.managerUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
          'X-Node-ID': this.nodeId || ''
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        console.error(`[Reporter] Failed to send to ${endpoint}: ${response.status}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`[Reporter] Error sending to ${endpoint}: ${error.message}`);
      return null;
    }
  }

  /**
   * 上报当前状态
   */
  async reportStatus() {
    if (!this.enabled || !this.statusGetter) return;

    const status = this.statusGetter();
    console.log('[Reporter] Reporting status to manager...');

    await this.send('/api/agent/report', {
      type: 'status',
      node_id: this.nodeId,
      timestamp: new Date().toISOString(),
      data: status
    });
  }

  /**
   * 上报 IP 切换事件
   */
  async reportSwitch(oldIp, newIp, success, message) {
    if (!this.enabled) return;

    console.log(`[Reporter] Reporting IP switch: ${oldIp} -> ${newIp}`);

    await this.send('/api/agent/callback', {
      type: 'switch',
      node_id: this.nodeId,
      timestamp: new Date().toISOString(),
      data: {
        old_ip: oldIp,
        new_ip: newIp,
        success: success,
        message: message
      }
    });
  }

  /**
   * 启动定时上报
   */
  start() {
    if (!this.enabled) {
      console.log('[Reporter] Disabled (no manager URL configured)');
      return;
    }

    console.log(`[Reporter] Starting periodic reporting (interval: ${this.reportInterval}ms)`);

    // 立即上报一次
    this.reportStatus();

    // 定时上报
    this.timer = setInterval(() => {
      this.reportStatus();
    }, this.reportInterval);
  }

  /**
   * 停止定时上报
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
