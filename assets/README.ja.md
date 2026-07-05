<div align="center">

# NiceEval

**段階的に導入できる、Agent Nativeで優れたDXを持つAIエージェントeval(評価)ツール**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEvalは[eve](https://eve.dev)にインスパイアされたAgent-Nativeなeval(評価)ツールで、究極のDX(開発者体験)を追求しています。

汎用的な設計により、NiceEvalはほぼすべてのAgentアプリケーションを評価できます。
Claude Code / Codex向けに書かれたcoding agentのプラグイン、Hook、Skillを評価する場合でも、自分自身のAI Agentアプリケーションを評価する場合でも、簡単に接続できます。

evalの完了後には読みやすいレポートを生成し、Agentの挙動を細部まで確認できます。デバッグやAgentの挙動理解に便利です。

## DeepEval、LangFuse、BrainTrustがあるのに、なぜNiceEvalが必要なのか
NiceEvalはAgent-Nativeな評価ツールです。Dataset / goldenの「InputとExpected Outputを構築する」というパターンは、実際のAgent評価には適していません。
現在のAgentは、複数ターンの対話、マルチAgent協調、ツール呼び出し、Skillのロードといったきめ細かいシナリオで評価される必要があり、NiceEvalはそれをより上手くこなせます。

同時に、NiceEvalはLangFuseやBrainTrustとも共存できます。それらをtracingに使ったり、評価結果を両者にアップロードしたりできます(この機能は開発中です)。

## アーキテクチャ

NiceEvalは、テスト対象のagentが隔離されたサンドボックスファイルシステムを必要とするかどうかに応じて、2種類の接続方式をサポートします。

**モード1: Sandbox(Docker、E2B) —— Codex、Claude Codeなどsandboxが必要なcoding agentを動かす**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agentアダプター(公式)
        ▼
   ┌──────────────────────────────────────────┐
   │              Docker Sandbox              │
   │  ┌────────────────────────────────────┐  │
   │  │ Codex / Claude Code                │  │
   │  │ 隔離ファイルシステムが必要なアプリ │  │
   │  └────────────────────────────────────┘  │
   └──────────────────────────────────────────┘
```

**モード2: 直接接続 —— 自分自身のAI Agentに直接接続する**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agentアダプター(公式、または自作)
        ▼
   ┌──────────────────────────────┐
   │      自分自身のAI Agent      │
   │     (AI SDK·LangGraph·Pi)    │
   └──────────────────────────────┘
```

- **NiceEvalコア**はevalの発見、実行のスケジューリング、採点、レポートとartifactsの生成を担います。
- **Agentアダプター**はオープンな境界です。テスト対象システムをどう呼び出すかは開発者側で決められます。
- ファイルシステムの隔離が必要なcoding agentは**Docker Sandbox**経由で動かし、自分自身のAI Agentは直接接続でき、Dockerは不要です。


## サンプル

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "agentがリアルタイムの天気に関する質問で正しくツールを呼び出し、その結果に基づいて回答できるかをテストする",

  async test(t) {
    const turn = await t.send("北京の今日の天気はどうですか？");
    t.succeeded();

    await t.group("get_weatherを正しい都市名で呼び出す", () => {
      t.calledTool("get_weather", { input: { city: "北京" } });
      t.messageIncludes(/°C|気温|天気|晴れ|曇り|雨/);
    });

    const second = await t.send("上海の明日の天気はどうですか?");
    second.messageIncludes("上海");

    t.judge.autoevals
      .closedQA("アシスタントは気温をでたらめに作るのではなく、ツールが返した天気データに基づいて回答しているか？")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // 自分で書いたagent adapter。テスト対象のweb agentに接続する

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // local experimentでeval-tool-callだけを実行する
pnpm exec niceeval view // 評価結果を確認する
```

## クイックスタート

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

自分のシナリオから始めましょう。

- [Claude Code / CodexのプラグインをEvalしたい場合](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Claude Code / CodexのSkillをEvalしたい場合](https://niceeval.com/docs/example/claude-code-codex-skill)
- [自分のAIエージェントアプリケーションをEvalしたい場合](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
公式アダプター
- [ ] Agentソフトウェア
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agentフレームワーク
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## ドキュメント

- [クイックスタート](https://niceeval.com/docs/quickstart)

# 謝辞
このプロジェクトは以下のプロジェクトにインスパイアされている、あるいはAIが以下のプロジェクトのコードから学んで書かれています。
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

以下のコミュニティに感謝します
