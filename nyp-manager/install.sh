#!/bin/bash

# nyp-manager 安装脚本
# 用法: ./install.sh

set -e

INSTALL_DIR="/opt/nyp-manager"
SERVICE_NAME="nyp-manager"

echo "=========================================="
echo "nyp-manager 安装脚本"
echo "=========================================="

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
  echo "请使用 root 权限运行此脚本"
  exit 1
fi

# 安装依赖
echo ""
echo "[1/5] 检查并安装依赖..."

# 安装 curl 和 git
if ! command -v curl &> /dev/null; then
  echo "  安装 curl..."
  apt-get update && apt-get install -y curl
fi

if ! command -v git &> /dev/null; then
  echo "  安装 git..."
  apt-get update && apt-get install -y git
fi

# 安装 Node.js
if ! command -v node &> /dev/null; then
  echo "  安装 Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# 检查 Node.js 版本
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "  Node.js 版本过低，需要 >= 18"
  echo "  安装 Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "  Node.js 版本: $(node -v)"
echo "  npm 版本: $(npm -v)"

# 创建安装目录
echo ""
echo "[2/5] 创建安装目录..."
mkdir -p $INSTALL_DIR

# 复制文件
echo ""
echo "[3/5] 复制文件..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -r "$SCRIPT_DIR/src" $INSTALL_DIR/
cp -r "$SCRIPT_DIR/public" $INSTALL_DIR/
cp "$SCRIPT_DIR/package.json" $INSTALL_DIR/
mkdir -p $INSTALL_DIR/config
mkdir -p $INSTALL_DIR/data

# 如果存在配置示例，复制它
if [ -f "$SCRIPT_DIR/config/config.example.json" ]; then
  cp "$SCRIPT_DIR/config/config.example.json" $INSTALL_DIR/config/
fi

# 安装 npm 依赖
echo ""
echo "[4/5] 安装 npm 依赖..."
cd $INSTALL_DIR
npm install --production

# 安装 systemd 服务
echo ""
echo "[5/5] 安装 systemd 服务..."
cat > /etc/systemd/system/$SERVICE_NAME.service << 'EOF'
[Unit]
Description=nyp-manager - nyanpass IP Manager Central Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/nyp-manager
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# 取消下面的注释来启用 Token 认证
# Environment=API_TOKEN=your-secret-token

# 可选配置
# Environment=API_PORT=3001
# Environment=API_HOST=0.0.0.0
# Environment=DB_PATH=/opt/nyp-manager/data/manager.db

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo ""
echo "=========================================="
echo "安装完成！"
echo "=========================================="
echo ""
echo "下一步操作："
echo ""
echo "1. 编辑配置（可选）:"
echo "   nano /etc/systemd/system/nyp-manager.service"
echo "   # 设置 API_TOKEN 来启用认证"
echo ""
echo "2. 启动服务:"
echo "   systemctl start $SERVICE_NAME"
echo ""
echo "3. 开机自启:"
echo "   systemctl enable $SERVICE_NAME"
echo ""
echo "4. 查看日志:"
echo "   journalctl -u $SERVICE_NAME -f"
echo ""
echo "5. 访问管理界面:"
echo "   http://YOUR_SERVER_IP:3001"
echo ""
