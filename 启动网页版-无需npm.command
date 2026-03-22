#!/bin/bash
# 不装 Node、不用 npm：用 Mac 自带的 Python 或 Ruby 开本地网页
# 双击本文件即可（若提示无法打开：按住 Control 点文件 → 打开）

cd "$(dirname "$0")"
PORT=8765
SRC_HTML="涌觉商贸AI图文视频制作工具-本地版.html"
LINK="ecom-local.html"
ln -sf "$SRC_HTML" "$LINK" 2>/dev/null || cp -f "$SRC_HTML" "$LINK"

SRV_PID=""

cleanup() {
  [[ -n "$SRV_PID" ]] && kill "$SRV_PID" 2>/dev/null
}
trap cleanup INT TERM

if command -v python3 &>/dev/null; then
  echo "使用本机 Python3 启动服务…"
  python3 -m http.server "$PORT" &
  SRV_PID=$!
elif command -v ruby &>/dev/null; then
  echo "使用本机 Ruby 启动服务（Mac 通常自带）…"
  ruby -run -e httpd -- . -p "$PORT" &
  SRV_PID=$!
else
  osascript -e 'display dialog "本机未找到 python3 和 ruby，无法自动开网页。将打开 Node 下载页：请安装 LTS 后双击 start.sh；或先安装 Python3 再双击本文件。" buttons {"好"} default button "好"' 2>/dev/null || true
  open "https://nodejs.org/zh-cn" 2>/dev/null || true
  exit 1
fi

sleep 1
echo ""
echo "=========================================="
echo "  简易网页版（无需 npm）"
echo "  地址: http://127.0.0.1:${PORT}/${LINK}"
echo "  关掉本窗口 = 停止服务"
echo "=========================================="
echo ""
open "http://127.0.0.1:${PORT}/${LINK}" 2>/dev/null || true
echo "按 Ctrl+C 可停止服务"
wait "$SRV_PID"
