#!/bin/bash
# 完整版唯一推荐入口（与「启动完整版-稳定模式.command」效果相同）
# 不要同时双击多个 .command，否则会提示「请勿多开」或端口冲突。

cd "$(dirname "$0")" || exit 1
exec bash ./start.sh
