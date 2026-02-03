#!/bin/bash

# nyp-agent 安装脚本

set -e

INSTALL_DIR="/opt/nyp-agent"
SERVICE_FILE="/etc/systemd/system/nyp-agent.service"

echo "=========================================="
echo "nyp-agent 安装脚本"
echo "=========================================="

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
  echo "请使用 root 权限运行此脚本"
  exit 1
fi

# 检查并安装依赖
install_dependencies() {
  echo "[0/5] 检查依赖..."

  # 检查 curl
  if ! command -v curl &> /dev/null; then
    echo "  -> 安装 curl..."
    apt update && apt install -y curl
  fi

  # 检查 Node.js
  if ! command -v node &> /dev/null; then
    echo "  -> 安装 Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
  else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
      echo "  -> Node.js 版本过低 ($(node -v))，升级到 20.x..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt install -y nodejs
    fi
  fi

  echo "  -> Node.js $(node -v) 已就绪"
}

install_dependencies

echo "[1/5] 创建安装目录..."
mkdir -p $INSTALL_DIR

echo "[2/5] 复制文件..."
cp -r src $INSTALL_DIR/
cp -r config $INSTALL_DIR/
cp package.json $INSTALL_DIR/

echo "[3/5] 安装服务..."
cp nyp-agent.service $SERVICE_FILE

echo "[4/5] 重载 systemd..."
systemctl daemon-reload

# 创建默认 .env 文件
if [ ! -f "$INSTALL_DIR/config/.env" ]; then
  cp $INSTALL_DIR/config/.env.example $INSTALL_DIR/config/.env
  echo "  -> 已创建默认 .env 配置"
fi

echo "[5/5] 安装 npm 依赖..."
cd $INSTALL_DIR && npm install --production

echo ""
echo "=========================================="
echo "安装完成!"
echo "=========================================="
echo ""
echo "下一步:"
echo ""
echo "1. 编辑主配置文件:"
echo "   cp $INSTALL_DIR/config/config.example.json $INSTALL_DIR/config/config.json"
echo "   nano $INSTALL_DIR/config/config.json"
echo ""
echo "2. (可选) 编辑环境配置:"
echo "   nano $INSTALL_DIR/config/.env"
echo ""
echo "3. 启动服务:"
echo "   systemctl start nyp-agent"
echo ""
echo "4. 设置开机自启:"
echo "   systemctl enable nyp-agent"
echo ""
echo "4. 查看日志:"
echo "   journalctl -u nyp-agent -f"
echo ""
echo "5. 查看状态:"
echo "   curl http://localhost:3000/status"
echo ""
