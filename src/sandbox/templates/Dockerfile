# fasteval 预制 agent 镜像 —— 把 codex / claude-code / bub 三个 CLI 烘焙进来,
# 让后续 eval 跳过 setup 阶段的安装(几十秒~几分钟)直接开跑。
#
# 一份 Dockerfile,三种后端共用(见同目录 README.md):
#   · docker  : docker build -t fasteval-agents:node24 .
#   · e2b     : e2b template build(由 e2b.toml 引用本文件)
#   · vercel  : build-vercel-snapshot.mts 在 microVM 里跑等价安装后 snapshot
#
# 关键约定:三个 CLI 都装到 /usr/local/bin(对所有沙箱用户都在 PATH 上)——
# docker 跑命令用 node 用户、e2b 用 user、vercel 用 vercel-sandbox,均能 `command -v` 命中,
# 于是 agent adapter 的 setup() 探测到就跳过安装(见 agents/{codex,claude-code,bub}.ts)。

FROM node:24-slim

# bub 的安装规格必须与 agents/bub.ts 保持一致(改一处就改两处)。
ARG BUB_OVERRIDE="bub @ git+https://github.com/CorrectRoadH/bub.git@fix/streaming-usage-include-usage"
ARG OTEL_PLUGIN="git+https://github.com/CorrectRoadH/bub-contrib.git@fix/tapestore-otel-tape-entry-validation#subdirectory=packages/bub-tapestore-otel"

# 系统依赖:git/curl(git+https 安装、uv 安装脚本)、ca-certificates、build-essential(bub 的原生依赖编译)。
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

# ── codex + claude-code:npm 全局装 → /usr/local/bin/{codex,claude} ──
RUN npm install -g @openai/codex @anthropic-ai/claude-code

# ── bub:uv 装 python3.12 工具,二进制落到 /usr/local/bin(对所有用户可见)──
# UV_INSTALL_DIR  : uv 自身装到 /usr/local/bin。
# UV_TOOL_BIN_DIR : `uv tool install` 暴露的入口(bub)落到 /usr/local/bin。
# UV_TOOL_DIR     : 工具的虚拟环境放到 /opt(与用户 home 无关,任何沙箱用户都能用)。
ENV UV_INSTALL_DIR=/usr/local/bin \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_TOOL_DIR=/opt/uv-tools
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && printf '%s\n' "${BUB_OVERRIDE}" > /tmp/bub-override.txt \
 && uv tool install --python 3.12 --prerelease allow 'bub' \
      --overrides /tmp/bub-override.txt --with "${OTEL_PLUGIN}" \
 && rm -f /tmp/bub-override.txt

# 自检:三个 CLI 都应在 PATH 上(构建时即失败,而非到 eval 才发现)。
RUN command -v codex && command -v claude && command -v bub
