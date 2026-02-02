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

    if (!response.ok) {
      throw new Error(`Login failed: ${response.status}`);
    }

    const data = await response.json();
    this.token = data.data;

    if (!this.token) {
      throw new Error('Login failed: no token returned');
    }

    return this.token;
  }

  /**
   * 获取设备组信息
   */
  async getDeviceGroup() {
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

    if (!response.ok) {
      throw new Error(`Failed to get device groups: ${response.status}`);
    }

    const data = await response.json();
    const deviceGroup = data.data?.find(d => d.id === this.deviceGroupId);

    if (!deviceGroup) {
      throw new Error(`Device group #${this.deviceGroupId} not found`);
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

    // 构建更新数据
    const updatePayload = {
      id: deviceGroup.id,
      name: deviceGroup.name,
      type: deviceGroup.type,
      config: deviceGroup.config,
      connect_host: newIp,
      display_name: deviceGroup.display_name,
      display_num: deviceGroup.display_num,
      display_traffic: deviceGroup.display_traffic,
      enable_for_gid: deviceGroup.enable_for_gid,
      note: deviceGroup.note,
      ratio: deviceGroup.ratio,
      show_order: deviceGroup.show_order,
      token: deviceGroup.token,
      traffic_used: deviceGroup.traffic_used
    };

    const response = await fetch(`${this.adminUrl}/api/v1/admin/devicegroup/${this.deviceGroupId}`, {
      method: 'POST',
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!response.ok) {
      throw new Error(`Failed to update device group: ${response.status}`);
    }

    const result = await response.json();

    if (result.code !== 0) {
      throw new Error(`Update failed: ${result.msg || 'Unknown error'}`);
    }

    return {
      success: true,
      changed: true,
      message: result.msg || 'Updated successfully',
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
