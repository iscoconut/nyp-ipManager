#!/bin/bash

# nyp-manager 升级脚本
# 用法: ./upgrade.sh

set -e

INSTALL_DIR="/opt/nyp-manager"
SERVICE_NAME="nyp-manager"
REPO_URL="https://github.com/iscoconut/nyp-ipManager.git"
TEMP_DIR="/tmp/nyp-manager-upgrade-$$"

echo "=========================================="
echo "nyp-manager 升级脚本"
echo "=========================================="

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
  echo "请使用 root 权限运行此脚本"
  exit 1
fi

# 检查安装目录
if [ ! -d "$INSTALL_DIR" ]; then
  echo "错误: 未找到安装目录 $INSTALL_DIR"
  echo "请先运行 install.sh 进行安装"
  exit 1
fi

# 获取当前版本信息
echo ""
echo "[1/5] 检查当前版本..."
if [ -f "$INSTALL_DIR/.version" ]; then
  CURRENT_VERSION=$(cat "$INSTALL_DIR/.version")
  echo "  当前版本: $CURRENT_VERSION"
else
  echo "  当前版本: 未知"
fi

# 下载最新代码
echo ""
echo "[2/5] 下载最新代码..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

git clone --depth 1 "$REPO_URL" "$TEMP_DIR/repo"
NEW_VERSION=$(cd "$TEMP_DIR/repo" && git rev-parse --short HEAD)
echo "  最新版本: $NEW_VERSION"

# 停止服务
echo ""
echo "[3/5] 停止服务..."
if systemctl is-active --quiet $SERVICE_NAME; then
  systemctl stop $SERVICE_NAME
  echo "  服务已停止"
else
  echo "  服务未运行"
fi

# 备份当前版本
echo ""
echo "[4/5] 更新文件..."
BACKUP_DIR="$INSTALL_DIR/backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 备份源文件
if [ -d "$INSTALL_DIR/src" ]; then
  cp -r "$INSTALL_DIR/src" "$BACKUP_DIR/"
fi
if [ -d "$INSTALL_DIR/public" ]; then
  cp -r "$INSTALL_DIR/public" "$BACKUP_DIR/"
fi

echo "  已备份到: $BACKUP_DIR"

# 更新文件（保留 config、data 目录）
cp -r "$TEMP_DIR/repo/nyp-manager/src" "$INSTALL_DIR/"
cp -r "$TEMP_DIR/repo/nyp-manager/public" "$INSTALL_DIR/"
cp "$TEMP_DIR/repo/nyp-manager/package.json" "$INSTALL_DIR/"

# 更新升级脚本自身
if [ -f "$TEMP_DIR/repo/nyp-manager/upgrade.sh" ]; then
  cp "$TEMP_DIR/repo/nyp-manager/upgrade.sh" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/upgrade.sh"
fi

# 记录版本
echo "$NEW_VERSION" > "$INSTALL_DIR/.version"

# 更新依赖
echo "  更新 npm 依赖..."
cd "$INSTALL_DIR"
npm install --production

# 清理临时文件
rm -rf "$TEMP_DIR"

# 重启服务
echo ""
echo "[5/5] 重启服务..."
systemctl daemon-reload
systemctl start $SERVICE_NAME

# 等待服务启动
sleep 2

if systemctl is-active --quiet $SERVICE_NAME; then
  echo "  服务已启动"
else
  echo "  警告: 服务启动失败，请检查日志"
  echo "  journalctl -u $SERVICE_NAME -f"
fi

echo ""
echo "=========================================="
echo "升级完成！"
echo "=========================================="
echo ""
echo "版本: $NEW_VERSION"
echo "备份: $BACKUP_DIR"
echo ""
echo "查看日志: journalctl -u $SERVICE_NAME -f"
echo ""
echo "如需回滚:"
echo "  systemctl stop $SERVICE_NAME"
echo "  cp -r $BACKUP_DIR/src $INSTALL_DIR/"
echo "  cp -r $BACKUP_DIR/public $INSTALL_DIR/"
echo "  systemctl start $SERVICE_NAME"
echo ""
