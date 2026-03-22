#!/bin/bash
# 与「双击我启动.command」相同；任选其一即可，切勿两个一起开。

cd "$(dirname "$0")" || exit 1
exec bash ./start.sh
