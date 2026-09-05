#!/bin/zsh

set -e

APP_ROOT="${0:A:h}"
SERVER_LOG="/tmp/aigc-production-os-server.log"
SERVER_BIN="$APP_ROOT/bin/mediago-server"
DOCUMENT_MCP_BIN="$APP_ROOT/bin/mediago-document-mcp"
GENERATION_MCP_BIN="$APP_ROOT/bin/mediago-generation-mcp"

# 2019 Intel Mac 使用 x86_64 版本的本地 Codex ACP。
# 不显式指定时，Taskfile 会回退到 `none`，制作助理随后会报
# `codex-acp executable file not found in $PATH`。
ARCH="$(uname -m)"
case "$ARCH" in
	 x86_64)
		VENDOR_BIN_DIR="$APP_ROOT/packages/vendor/dist/darwin-x64"
		;;
	 arm64)
		VENDOR_BIN_DIR="$APP_ROOT/packages/vendor/dist/darwin-arm64"
		;;
	 *)
		echo "暂不支持的 macOS 架构：$ARCH"
		read -r "?按回车键关闭窗口。"
		exit 1
		;;
esac

ACP_AGENT_JSON="$VENDOR_BIN_DIR/codex/agent.json"
ACP_BIN="$VENDOR_BIN_DIR/codex/codex-acp"
if [[ ! -f "$ACP_AGENT_JSON" || ! -x "$ACP_BIN" ]]; then
	echo "本机制作助理运行文件不完整：$ACP_BIN"
	echo "请确认项目文件夹中的 packages/vendor/dist 与当前 Mac 架构匹配。"
	read -r "?按回车键关闭窗口。"
	exit 1
fi

# Finder 启动 .command 时不会继承终端的 PATH，主动补齐常见 Node/pnpm 安装路径。
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
PNPM_BIN="${PNPM_BIN:-$(command -v pnpm || true)}"
if [[ -z "$PNPM_BIN" ]]; then
	for candidate in \
		"$HOME/.local/share/pnpm/pnpm" \
		"$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm" \
		"/opt/homebrew/bin/pnpm" \
		"/usr/local/bin/pnpm"; do
		if [[ -x "$candidate" ]]; then
			PNPM_BIN="$candidate"
			break
		fi
	done
fi
if [[ -z "$PNPM_BIN" ]]; then
	echo "找不到 pnpm，请先在终端安装 pnpm 后再启动。"
	read -r "?按回车键关闭窗口。"
	exit 1
fi
PNPM_DIR="${PNPM_BIN:h}"
export PATH="$PNPM_DIR:$PATH"

cd "$APP_ROOT"

# Banana 图像凭据只保存在 macOS 钥匙串。启动时短暂导入当前服务进程，
# 不写入项目文件、日志或任何模型 API 配置页面。
BANANA_KEYCHAIN_SERVICE="AIGC Production OS Banana Image"
BANANA_KEY="$(security find-generic-password -s "$BANANA_KEYCHAIN_SERVICE" -a "BANANA_API_KEY" -w 2>/dev/null || true)"
if [[ -n "$BANANA_KEY" ]]; then
	export BANANA_API_KEY="$BANANA_KEY"
	export BANANA_BASE_URL="https://cn.whereslow.online"
	export BANANA_MODEL="nano-banana-pro"
fi

if [[ ! -x "$SERVER_BIN" ]]; then
	"$PNPM_BIN" exec task build:server >>"$SERVER_LOG" 2>&1
fi

# 制作助理需要这两个项目上下文 MCP。只构建缺失的二进制，避免每次启动都重复编译。
# 缺失时如果不补齐，Agent 虽然能启动，但无法读取项目文档、阶段和生成记录。
if [[ ! -x "$DOCUMENT_MCP_BIN" ]]; then
	go build -o "$DOCUMENT_MCP_BIN" ./services/server/cmd/mediago-document-mcp >>"$SERVER_LOG" 2>&1
fi
if [[ ! -x "$GENERATION_MCP_BIN" ]]; then
	go build -o "$GENERATION_MCP_BIN" ./services/server/cmd/mediago-generation-mcp >>"$SERVER_LOG" 2>&1
fi

server_pid="$(lsof -t -nP -iTCP:8080 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
server_command=""
if [[ -n "$server_pid" ]]; then
	server_command="$(ps -p "$server_pid" -o command= 2>/dev/null || true)"
fi

# Finder 可能复用一个旧的 mediago-server。仅仅看到 8080 被占用并不代表
# 它加载了当前 Intel 版 ACP；旧进程会让制作助理退化成 503。确认进程属于
# 本项目且环境完整后才复用，否则优雅结束旧进程并按当前架构重新启动。
server_needs_restart=0
if [[ -n "$server_pid" ]]; then
	# Finder、终端和 Task 启动服务时，ps 里可能分别显示绝对路径、相对路径
	# 或仅显示可执行文件名。通过 lsof 解析真实可执行文件，避免把本项目
	# 已经运行的服务误判成“端口被其他程序占用”。
	server_executable="$(lsof -p "$server_pid" -a -d txt -Fn 2>/dev/null | awk 'substr($0,1,1)=="n" {print substr($0,2); exit}')"
	if [[ "$server_executable" != "$SERVER_BIN" ]]; then
		 echo "8080 端口已被其他程序占用：$server_command"
		 echo "请先关闭该程序，再重新启动本地 App。"
		 read -r "?按回车键关闭窗口。"
		 exit 1
	fi
	server_env="$(ps eww -p "$server_pid" 2>/dev/null || true)"
	if [[ "$server_env" != *"MEDIAGO_AGENT_ID=codex"* || "$server_env" != *"MEDIAGO_AGENT_BIN_DIR=$VENDOR_BIN_DIR"* ]]; then
		server_needs_restart=1
	fi
fi

if [[ "$server_needs_restart" -eq 1 ]]; then
	kill "$server_pid" 2>/dev/null || true
	for _ in {1..30}; do
		if ! lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
			break
		fi
		sleep 1
	done
	server_pid=""
fi

if [[ -z "$server_pid" ]] || ! lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
	# 直接守护服务二进制，避免后台 Task 结束时回收子进程。
	# 通过环境变量显式选择本机架构的 ACP，不依赖 Finder 启动时的 PATH。
	nohup env \
		MEDIAGO_AGENT_ID=codex \
		MEDIAGO_AGENT_BIN_DIR="$VENDOR_BIN_DIR" \
		MEDIAGO_FFMPEG_BIN_DIR="$VENDOR_BIN_DIR/tools" \
		MEDIAGO_JIMENG_BIN_DIR="$VENDOR_BIN_DIR/tools" \
		MEDIAGO_LIBTV_BIN_DIR="$VENDOR_BIN_DIR/tools" \
		MEDIAGO_PIPPIT_BIN_DIR="$VENDOR_BIN_DIR/tools" \
		MEDIAGO_SERVER_PORT=8080 \
		"$SERVER_BIN" --config "$APP_ROOT/services/server/configs/server.yaml" \
		>"$SERVER_LOG" 2>&1 &
	for _ in {1..120}; do
		if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
			break
		fi
		sleep 1
	done
fi

if ! lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
	echo "本地服务启动失败，请查看：$SERVER_LOG"
	read -r "?按回车键关闭窗口。"
	exit 1
fi

# 如果已有 Vite 工作区服务，直接复用它打开 Electron，避免 Finder 重复启动
# `strictPort` 导致“31420 已被占用”的假故障。
if lsof -nP -iTCP:31420 -sTCP:LISTEN >/dev/null 2>&1; then
	cd "$APP_ROOT/apps/workspace"
	"$PNPM_BIN" electron:compile
	exec env ELECTRON_RENDERER_URL="http://127.0.0.1:31420" "$PNPM_BIN" exec electron electron/dist/main.js
fi

exec "$PNPM_BIN" dev:desktop
