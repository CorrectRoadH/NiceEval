<div align="center">

# NiceEval

**Прогрессивный, Agent Native инструмент оценки AI-агентов с отличным DX**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md)

</div>

NiceEval — это Agent-Native инструмент оценки, вдохновлённый [eve](https://eve.dev) и стремящийся к максимально качественному DX.

Благодаря универсальному дизайну NiceEval может оценивать практически любые агентные приложения.
Нужно ли вам оценить плагины, Hook'и и Skill'ы, написанные для coding agent'ов Claude Code / Codex, или ваше собственное AI Agent-приложение — подключить их одинаково легко.

После завершения evals формируется удобный для чтения отчёт, в котором можно посмотреть детали поведения агента. Это упрощает отладку и понимание того, как ведёт себя агент.

## Зачем нужен NiceEval, если уже есть DeepEval, LangFuse, BrainTrust
NiceEval — это Agent-Native инструмент оценки. Схема Dataset / golden — «построить Input и Expected Output» — плохо подходит для оценки реальных агентов.
Сегодня агентов нужно оценивать в детализированных сценариях — многораундовые диалоги, взаимодействие нескольких агентов, вызовы инструментов, загрузка Skill'ов — и с этим NiceEval справляется лучше.

При этом NiceEval может сосуществовать с LangFuse и BrainTrust: их можно использовать для трейсинга или загружать в них результаты оценки (эта часть функциональности ещё в разработке).

## Архитектура

NiceEval поддерживает два способа подключения — в зависимости от того, нужна ли тестируемому агенту изолированная файловая система в песочнице.

**Режим 1: Sandbox (Docker, E2B) — для запуска Codex, Claude Code и других coding agent'ов, которым нужна песочница**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │      NiceEval       │
   └─────────────────────┘
        │
        │ Адаптер Agent (официальный)
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox        │
   │  ┌────────────────────────┐  │
   │  │ Codex / Claude Code    │  │
   │  │ приложения, которым    │  │
   │  │ нужна изолированная ФС │  │
   │  └────────────────────────┘  │
   └──────────────────────────────┘
```

**Режим 2: Прямое подключение — напрямую к вашему собственному AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │      NiceEval       │
   └─────────────────────┘
        │
        │ Адаптер Agent (официальный или собственная реализация)
        ▼
   ┌──────────────────────────────┐
   │  Ваш собственный AI Agent    │
   │    (AI SDK·LangGraph·Pi)     │
   └──────────────────────────────┘
```

- **Ядро NiceEval** отвечает за обнаружение eval'ов, планирование запусков, выставление оценок, генерацию отчётов и артефактов.
- **Адаптер Agent** — открытая граница: вы сами решаете, как вызывать тестируемую систему.
- Coding agent'ам, которым нужна изоляция файловой системы, подходит **Docker Sandbox**; ваш собственный AI Agent можно подключить напрямую, без Docker.


## Пример

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "Проверяет, что агент корректно вызывает инструмент при вопросах о погоде в реальном времени и отвечает на основе его результата",

  async test(t) {
    const turn = await t.send("Какая сегодня погода в Beijing?");
    t.succeeded();

    await t.group("вызывает get_weather с правильным городом", () => {
      t.calledTool("get_weather", { input: { city: "Beijing" } });
      t.messageIncludes(/°C|температура|погода|солнечно|облачно|дождь/);
    });

    const second = await t.send("А как насчёт Shanghai завтра?");
    second.messageIncludes("Shanghai");

    t.judge.autoevals
      .closedQA("Отвечает ли ассистент на основе данных о погоде от инструмента, а не выдумывает температуру?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // ваш собственный agent adapter, подключённый к тестируемому web agent

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // запустить только eval-tool-call с experiment local
pnpm exec niceeval view // посмотреть результаты оценки
```

## Быстрый старт

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

Начните со своего сценария:

- [Если вам нужно оценить ваш плагин для Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Если вам нужно оценить ваш Skill для Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Если вам нужно оценить ваше AI Agent приложение](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
Официальные адаптеры
- [ ] Agent-приложения
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent-фреймворки
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Документация

- [Быстрый старт](https://niceeval.com/docs/quickstart)

# Благодарности
Этот проект был вдохновлён нижеперечисленными проектами, а также ИИ, изучавшим их код при написании NiceEval:
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

Благодарим следующие сообщества
