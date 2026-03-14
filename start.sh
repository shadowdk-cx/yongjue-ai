#!/bin/bash
cd "$(dirname "$0")"
if ! command -v npm &>/dev/null; then
  echo "未检测到 npm，请先安装 Node.js: https://nodejs.org/"
  exit 1
fi
echo "正在安装依赖..."
npm install
echo "正在启动开发服务器..."
npm run dev
