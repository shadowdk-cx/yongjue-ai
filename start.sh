#!/bin/bash
# 涌觉商贸 AI 工具 - 本地启动脚本
#
# 【默认】稳定模式：npm run build + npm run start（与 next dev 不同，不会出现 missing required error components 白屏）
# 开发调试请使用：./start.sh --dev
#
# 其它：./start.sh --clean  清理 .next
#      ./start.sh --kill-ports  释放 3000–3010 端口
#
# 单实例：除 --clean / --kill-ports 外，会先占「锁文件夹」.ecom-ai-tool-running，
# 避免多个 .command 同时跑导致 3000 端口冲突（EADDRINUSE）。

set -e
cd "$(dirname "$0")"

LOCK=".ecom-ai-tool-running"
if [[ "$1" != "--kill-ports" && "$1" != "--clean" ]]; then
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo ""
    echo "=========================================="
    echo "【请勿多开】检测到已有本工具在启动/运行，或上次异常退出留下了锁。"
    echo "  ① 关掉其它黑色终端里正在跑本工具的窗口"
    echo "  ② 若确定没有：删除本文件夹里的目录「$LOCK」后再双击"
    echo ""
    echo "  注意：只使用「双击我启动.command」即可，不要同时双击："
    echo "  「启动完整版」「启动工具」等，否则会抢同一个 3000 端口。"
    echo "=========================================="
    echo ""
    exit 1
  fi
  cleanup_lock() {
    rmdir "$LOCK" 2>/dev/null || true
  }
  trap cleanup_lock EXIT INT TERM
fi

free_port_3000() {
  if ! lsof -ti:3000 &>/dev/null; then
    return 0
  fi
  echo ""
  echo "【端口】3000 已被占用（多为上次未关干净的 Node），正在尝试结束占用进程…"
  lsof -ti:3000 2>/dev/null | xargs kill 2>/dev/null || true
  sleep 1
  if lsof -ti:3000 &>/dev/null; then
    lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
  if lsof -ti:3000 &>/dev/null; then
    echo "仍无法释放 3000，请手动执行: ./start.sh --kill-ports"
    exit 1
  fi
  echo "已释放 3000。"
  echo ""
}

if ! command -v npm &>/dev/null; then
  echo ""
  echo "=========================================="
  echo "【本机还没有 npm】工具无法启动，必须先安装 Node.js"
  echo "  浏览器即将打开官网 → 点绿色「获取 Node.js」→ 安装 LTS 版本"
  echo "  装好后：关掉所有黑色终端窗口 → 再双击「双击我启动.command」"
  echo "=========================================="
  echo ""
  if [[ "$(uname -s 2>/dev/null)" == "Darwin" ]]; then
    osascript -e 'display dialog "您的 Mac 上还没有安装 Node.js（所以没有 npm 命令），完整版工具无法运行。

接下来浏览器会打开 nodejs 中文官网：

① 点击绿色按钮「获取 Node.js」
② 下载并安装 .pkg（选 LTS 长期支持版即可）
③ 安装完成后关掉所有终端窗口
④ 再双击一次「双击我启动.command」

若已装过仍弹出本提示，请重启 Mac 后再试。" buttons {"知道了"} default button "知道了"' 2>/dev/null || true
    open "https://nodejs.org/zh-cn" 2>/dev/null || true
  fi
  exit 1
fi

if [[ "$1" == "--kill-ports" ]]; then
  echo "尝试释放 3000-3010 端口上的 node 进程..."
  for p in 3000 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010; do
    pid=$(lsof -ti:"$p" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
      echo "  端口 $p -> PID $pid，结束进程"
      kill "$pid" 2>/dev/null || true
    fi
  done
  echo "完成。请再运行: ./start.sh"
  exit 0
fi

if [[ "$1" == "--clean" ]]; then
  echo "清理 .next 构建缓存..."
  rm -rf .next
  echo "完成。请再运行: ./start.sh"
  exit 0
fi

ulimit -n 10240 2>/dev/null || true
export WATCHPACK_POLLING=true
export CHOKIDAR_USEPOLLING=true

echo "正在检查依赖..."
npm install

if [[ ! -d node_modules ]]; then
  echo "依赖安装失败，请检查网络后重试 npm install"
  exit 1
fi

if [[ "$1" == "--prod" ]]; then
  shift
fi

if [[ "$1" == "--dev" ]]; then
  echo ""
  echo "【开发模式】npm run dev — 若出现白屏，请用不带参数的 ./start.sh"
  echo ""
  free_port_3000
  if [[ "$(uname -s 2>/dev/null)" == "Darwin" ]] && command -v open &>/dev/null; then
    ( sleep 4 && open "http://localhost:3000" 2>/dev/null ) &
  fi
  npm run dev
  exit 0
fi

# 默认：生产模式启动（推荐日常使用）
echo ""
echo "=========================================="
echo "【稳定模式】正在构建（首次约 1～3 分钟）…"
echo "  启动成功后本机会尝试自动打开浏览器 → http://localhost:3000"
echo "  若未弹出：请自己用浏览器打开上述地址"
echo "  调试代码请使用: ./start.sh --dev"
echo "=========================================="
echo ""
npm run build
echo ""
echo "构建完成。正在启动…"
free_port_3000
if [[ "$(uname -s 2>/dev/null)" == "Darwin" ]] && command -v open &>/dev/null; then
  ( sleep 5 && open "http://localhost:3000" 2>/dev/null ) &
fi
echo "按 Ctrl+C 可停止服务"
npm run start
exit 0

