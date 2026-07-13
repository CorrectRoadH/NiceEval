# niceeval 预制 agent 镜像 —— 把 codex / claude-code / bub 三个 CLI 烘焙进来,
# 让后续 eval 跳过 setup 阶段的安装(几十秒~几分钟)直接开跑。
#
# 这是 Docker provider 的基线镜像。E2B 从 provider 官方 Agent template 派生，Vercel
# 对运行中的 microVM 拍 snapshot；三者的构建入口见 ../README.md。
#
# Codex / Claude Code 装到 /usr/local/bin；Bub 按 Docker provider 的标准 node 用户装到
# $HOME/.local，并写 NiceEval 安装规格指纹。Adapter 只有在指纹完全匹配时才跳过安装。

FROM node:24-slim

# 系统依赖:git/curl(git+https 安装、uv 安装脚本)、ca-certificates、build-essential(bub 的原生依赖编译)。
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

# ── codex + claude-code:npm 全局装 → /usr/local/bin/{codex,claude} ──
ARG CODEX_VERSION=0.144.1
ARG CLAUDE_CODE_VERSION=2.1.207
RUN npm install -g @openai/codex@${CODEX_VERSION} @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# ── bub:以运行时的 node 用户安装,布局与 adapter 的运行时回退完全相同 ──
# bub-override.txt 把 bub 钉到不可变 commit。
# --overrides 是必须的:OTEL 插件依赖上游 bubbuild/bub,与 fork 冲突,靠 override 统一。
# override 行与 --with 的 OTEL 插件都必须与 agents/bub.ts 的 BUB_OVERRIDE / OTEL_PLUGIN 一致。
# COPY 到 /opt(持久),不要用 /tmp —— e2b 的层间不保证保留 /tmp。
COPY bub-override.txt /opt/bub-override.txt
RUN chown node:node /opt/bub-override.txt
USER node
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && $HOME/.local/bin/uv tool install --python 3.12 --prerelease allow 'bub' \
      --overrides /opt/bub-override.txt \
      --with 'git+https://github.com/bubbuild/bub-contrib.git@add4a6a133c5658aec8f167ef50804d9ee55d22e#subdirectory=packages/bub-tapestore-otel' \
 && mkdir -p $HOME/.local/share/niceeval \
 && printf '%s' '83770925b77a' > $HOME/.local/share/niceeval/bub-install-hash

# 自检:三个 CLI 都应在 PATH 上(构建时即失败,而非到 eval 才发现)。
RUN command -v codex && command -v claude && test -x $HOME/.local/bin/bub
