#!/bin/bash
# 直接開啟打包好的 Better Agent Terminal app
# 用法: ./runbat.sh

APP="/Users/jiunhaulin/Downloads/test/test-terminal/better-agent-terminal/release/mac-arm64/Better Agent Terminal.app"

if [ ! -d "$APP" ]; then
  echo "找不到 app，請先打包： npm run build:release"
  echo "預期路徑： $APP"
  exit 1
fi

echo "開啟： $APP"
open "$APP"
