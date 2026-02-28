/**
 * Nyanpass 上报模块
 * 自动更新 Nyanpass 设备组的连接地址
 */
export class NyanpassReporter {
  constructor(config) {
    this.adminUrl = config.admin_url;
    this.username = config.username;
    this.password = config.password;
    this.deviceGroupId = config.device_group_id;
    this.token = null;
  }

  /**
   * 登录获取 Token
   */
  async login() {
    const response = await fetch(`${this.adminUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`Login failed: HTTP ${response.status}, body: ${JSON.stringify(data)}`);
    }

    // 兼容 token 在 data.data 或 data.data.token 的情况
    this.token = typeof data.data === 'string' ? data.data : data.data?.token;

    if (!this.token) {
      throw new Error(`Login failed: unexpected response format: ${JSON.stringify(data)}`);
    }

    return this.token;
  }

  /**
   * 获取设备组信息
   */
  async getDeviceGroup(retried = false) {
    if (!this.token) {
      await this.login();
    }

    const response = await fetch(`${this.adminUrl}/api/v1/admin/devicegroup`, {
      method: 'GET',
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      // token 过期时重新登录重试一次
      if (!retried && (response.status === 401 || response.status === 403)) {
        this.token = null;
        await this.login();
        return this.getDeviceGroup(true);
      }
      throw new Error(`Failed to get device groups: HTTP ${response.status}, body: ${JSON.stringify(data)}`);
    }

    // 兼容 data.data 为数组或对象
    const groups = Array.isArray(data.data) ? data.data : data.data?.list;
    if (!groups) {
      throw new Error(`Unexpected device group response format: ${JSON.stringify(data).slice(0, 500)}`);
    }

    // ID 类型兼容：配置中可能是字符串，API 返回可能是数字
    const targetId = Number(this.deviceGroupId);
    const deviceGroup = groups.find(d => Number(d.id) === targetId);

    if (!deviceGroup) {
      const ids = groups.map(d => d.id).join(', ');
      throw new Error(`Device group #${this.deviceGroupId} not found. Available IDs: [${ids}]`);
    }

    return deviceGroup;
  }

  /**
   * 更新设备组连接地址
   */
  async updateConnectHost(newIp) {
    if (!this.token) {
      await this.login();
    }

    // 先获取当前设备组信息
    const deviceGroup = await this.getDeviceGroup();
    const oldConnectHost = deviceGroup.connect_host;

    // 检查是否需要更新
    if (oldConnectHost === newIp) {
      return {
        success: true,
        changed: false,
        message: 'IP unchanged',
        old_ip: oldConnectHost,
        new_ip: newIp
      };
    }

    // 构建更新数据（发送完整对象，仅修改 connect_host）
    const updatePayload = {
      ...deviceGroup,
      connect_host: newIp
    };

    // POST /api/v1/admin/devicegroup/{id} 为更新接口
    // 注意：PUT 是创建接口，不能用于更新
    const response = await fetch(`${this.adminUrl}/api/v1/admin/devicegroup/${deviceGroup.id}`, {
      method: 'POST',
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`Failed to update device group: HTTP ${response.status}, body: ${JSON.stringify(result)}`);
    }

    if (result && result.code !== undefined && result.code !== 0) {
      throw new Error(`Update failed: ${result.msg || JSON.stringify(result)}`);
    }

    // 回读验证：重新获取设备组确认 connect_host 是否真的更新了
    const verified = await this.getDeviceGroup();
    if (verified.connect_host !== newIp) {
      throw new Error(`Verification failed: connect_host is still "${verified.connect_host}" after update, expected "${newIp}". API response was: ${JSON.stringify(result).slice(0, 300)}`);
    }

    return {
      success: true,
      changed: true,
      message: 'Updated and verified successfully',
      old_ip: oldConnectHost,
      new_ip: newIp
    };
  }

  /**
   * 上报新 IP
   */
  async report(newIp) {
    try {
      const result = await this.updateConnectHost(newIp);
      console.log(`[Nyanpass] Report result: ${result.message}`);
      return result;
    } catch (error) {
      console.error(`[Nyanpass] Report error: ${error.message}`);
      return {
        success: false,
        changed: false,
        message: error.message,
        new_ip: newIp
      };
    }
  }
}

/**
 * 创建 Nyanpass 上报器
 */
export function createNyanpassReporter(config) {
  return new NyanpassReporter(config);
}
