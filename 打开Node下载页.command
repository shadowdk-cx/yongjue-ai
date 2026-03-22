#!/bin/bash
# 双击本文件（或在终端执行）会打开 Node.js 中文官网，用于安装 LTS（安装后才有 npm）
cd "$(dirname "$0")"
open "https://nodejs.org/zh-cn" 2>/dev/null || echo "请手动在浏览器打开: https://nodejs.org/zh-cn"
echo ""
echo "请在网页上下载并安装「长期支持版 LTS」。安装完成后关掉终端再运行 start.sh"
echo ""
read -r -t 8 -p "按回车关闭窗口（8 秒后自动退出）…" || true
