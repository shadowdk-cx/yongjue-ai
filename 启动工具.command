#!/bin/bash
cd "$(dirname "$0")"
if ! command -v npm &>/dev/null; then
  echo "未检测到 npm，请先安装 Node.js: https://nodejs.org/"
  echo ""
  read -p "按回车键关闭..."
  exit 1
fi
echo "正在安装依赖..."
npm install
echo ""
echo "正在启动开发服务器..."
echo "启动成功后，用浏览器打开: http://localhost:3000"
echo ""
npm run dev
read -p "按回车键关闭..."
