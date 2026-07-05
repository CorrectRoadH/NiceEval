<div align="center">

# NiceEval

**Прогрессивный, Agent Native инструмент оценки AI-агентов с отличным DX**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md)

</div>

NiceEval — это универсальный инструмент для оценки agent'ов (agent eval), вдохновлённый [eve](https://eve.dev). Прежде всего у него очень качественный DX: разобраться и всё настроить можно примерно за 10 минут. При этом дизайн максимально универсален: с его помощью можно оценивать плагины, хуки (Hook) и скиллы (Skill), написанные для coding agent'ов вроде Claude Code/Codex. А ещё можно напрямую оценивать собственный AI Agent фреймворк — неважно, построен ли он на AI SDK, LangGraph или Pi, подключить его легко.

После завершения evals формируется удобный для чтения отчёт, в котором можно посмотреть детали поведения агента. Это упрощает отладку и понимание того, как ведёт себя агент.

## Зачем нужен NiceEval, если уже есть DeepEval, LangFuse, BrainTrust

NiceEval — это AI-нативный инструмент оценки. В таких инструментах построение датасетов и golden-примеров через Input и Expected Output плохо подходит для оценки реальных агентов. Кроме того, когда агентов нужно оценивать с высокой детализацией — по многораундовым диалогам с пользователем, работе нескольких агентов, вызовам инструментов, загрузке скиллов и так далее — NiceEval справляется с этим лучше.

При этом NiceEval прекрасно сосуществует с LangFuse и BrainTrust: первый можно использовать для трейсинга, либо загружать результаты оценки в оба сервиса (в разработке).

## Архитектура

NiceEval поддерживает два способа подключения — в зависимости от того, нужна ли тестируемой системе изолированная файловая система в песочнице.

**Режим 1: Sandbox (Docker, E2B) — для запуска Codex, Claude Code и других coding agent'ов, которым нужна песочница**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     NiceEval        │
   └─────────────────────┘
        │
        │ Адаптер Agent (официальный)
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox        │
   │   ┌────────────────────────┐ │
   │   │ Codex / Claude Code |  │ │
   │   │ приложения, которым    │ │
   │   │ нужна изолированная ФС │ │
   │   └────────────────────────┘ │
   └──────────────────────────────┘
```

**Режим 2: Прямое подключение — напрямую к вашему собственному AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     NiceEval        │
   └─────────────────────┘
        │
        │ Адаптер Agent (официальный или собственная реализация)
        ▼
   ┌──────────────────────────────┐
   │   Ваш собственный Web Agent   │
   │   (HTTP / AI SDK·LangGraph   │
   │    Pi и другие фреймворки,    │
   │    Docker не нужен)           │
   └──────────────────────────────┘
```

- **Ядро NiceEval** отвечает за обнаружение eval'ов, планирование запусков, выставление оценок, генерацию отчётов и артефактов.
- **Адаптер Agent** — открытая граница: вы сами решаете, как вызывать тестируемую систему.
- Coding agent'ам, которым нужна изоляция файловой системы, подходит **Docker Sandbox**; собственный Web Agent можно подключить напрямую, без Docker.


## Пример

Для запуска одного eval нужны два файла: сам eval (что проверяем) и experiment (какого агента запускаем). CLI не принимает «голый» eval id — именно experiment в команде `niceeval exp <experiment> <eval-префикс>` определяет, «к какому тестируемому объекту подключаться». Ниже — реальный сценарий с прямым подключением к Web Agent (полный проект см. в [`examples/zh/ai-sdk/`](../examples/zh/ai-sdk/)): проверяем, что при вопросе о погоде в реальном времени агент вызывает нужный инструмент и отвечает на основе его результата, а не выдумывает данные:

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
      t.messageIncludes(/°C|солнечно|облачно|дождь/);
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
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // запускает только eval-tool-call в рамках experiment local
pnpm exec niceeval view // просмотр результатов оценки
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
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent-фреймворки
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
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
</content>
</invoke>
