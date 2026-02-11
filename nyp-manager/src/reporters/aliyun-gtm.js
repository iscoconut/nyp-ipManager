/**
 * 阿里云 GTM 3.0 上报模块
 * 自动更新阿里云全局流量管理的地址记录
 *
 * API 文档: https://api.alibabacloud.com/document/Alidns/2015-01-09/UpdateCloudGtmAddress
 */
import crypto from 'crypto';

export class AliyunGtmReporter {
  constructor(config) {
    this.accessKeyId = config.access_key_id;
    this.accessKeySecret = config.access_key_secret;
    this.region = config.region || 'ap-southeast-1';
    this.addressId = config.address_id;
    this.addressName = config.address_name;
    this.healthTemplateId = config.health_template_id;
    this.healthPort = config.health_port || 22;
  }

  /**
   * 生成签名 Nonce
   */
  generateNonce() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  /**
   * 对字符串进行 URL 编码（符合阿里云规范）
   */
  percentEncode(str) {
    return encodeURIComponent(str)
      .replace(/\+/g, '%20')
      .replace(/\*/g, '%2A')
      .replace(/%7E/g, '~');
  }

  /**
   * 构建签名字符串
   */
  buildSignature(params, method = 'POST') {
    // 1. 按参数名排序
    const sortedKeys = Object.keys(params).sort();

    // 2. 构造规范化请求字符串
    const canonicalizedQueryString = sortedKeys
      .map(key => `${this.percentEncode(key)}=${this.percentEncode(params[key])}`)
      .join('&');

    // 3. 构造待签名字符串
    const stringToSign = `${method}&${this.percentEncode('/')}&${this.percentEncode(canonicalizedQueryString)}`;

    // 4. 计算签名（HMAC-SHA1）
    const hmac = crypto.createHmac('sha1', this.accessKeySecret + '&');
    hmac.update(stringToSign);
    return hmac.digest('base64');
  }

  /**
   * 调用阿里云 API
   */
  async callApi(action, params = {}) {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    // 公共参数
    const commonParams = {
      Format: 'JSON',
      Version: '2015-01-09',
      AccessKeyId: this.accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      Timestamp: timestamp,
      SignatureVersion: '1.0',
      SignatureNonce: this.generateNonce(),
      Action: action,
      ...params
    };

    // 计算签名
    const signature = this.buildSignature(commonParams);
    commonParams.Signature = signature;

    // 构建请求体
    const body = Object.keys(commonParams)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(commonParams[key])}`)
      .join('&');

    // 发送请求
    const endpoint = `https://alidns.${this.region}.aliyuncs.com/`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-acs-action': action,
        'x-acs-version': '2015-01-09'
      },
      body
    });

    const result = await response.json();

    if (!response.ok || result.Code) {
      throw new Error(`Aliyun API error: ${result.Message || result.Code || response.status}`);
    }

    return result;
  }

  /**
   * 更新 GTM 地址
   */
  async updateAddress(newIp) {
    // 构建 HealthTasks JSON
    const healthTasks = JSON.stringify([
      {
        Port: this.healthPort,
        TemplateId: this.healthTemplateId
      }
    ]);

    const params = {
      AddressId: this.addressId,
      Name: this.addressName,
      Address: newIp,
      HealthJudgement: 'any_ok',
      HealthTasks: healthTasks
    };

    const result = await this.callApi('UpdateCloudGtmAddress', params);

    return {
      success: true,
      changed: true,
      message: 'GTM address updated successfully',
      new_ip: newIp,
      request_id: result.RequestId
    };
  }

  /**
   * 上报新 IP
   */
  async report(newIp) {
    try {
      const result = await this.updateAddress(newIp);
      console.log(`[AliyunGTM] Report result: ${result.message}`);
      return result;
    } catch (error) {
      console.error(`[AliyunGTM] Report error: ${error.message}`);
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
 * 创建阿里云 GTM 上报器
 */
export function createAliyunGtmReporter(config) {
  return new AliyunGtmReporter(config);
}
