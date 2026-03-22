#!/bin/bash
# 【开发模式】与完整版共用 3000 端口与单实例锁，请勿与「双击我启动」同时运行。
cd "$(dirname "$0")" || exit 1
exec bash ./start.sh --dev
