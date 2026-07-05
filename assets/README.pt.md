<div align="center">

# NiceEval

**Uma ferramenta de evals para agentes de IA progressiva, Agent-Native e com DX excelente**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md)

</div>

O NiceEval é uma ferramenta de eval Agent-Native inspirada no [eve](https://eve.dev), que busca a melhor DX possível.

Graças ao seu design universal, o NiceEval pode avaliar praticamente qualquer aplicação de agent.
Seja para avaliar plugins, Hooks e Skills de coding agent escritos para o Claude Code / Codex, seja para avaliar a sua própria aplicação de AI Agent, a integração é fácil.

Depois que a eval termina, é gerado um relatório fácil de ler, com os detalhes do comportamento do agent à disposição. Isso facilita o debug e a compreensão do comportamento do agent.

## Por que usar o NiceEval quando já existem DeepEval, LangFuse e BrainTrust
O NiceEval é uma ferramenta de avaliação Agent-Native. O padrão de Dataset / golden — construir Input e Expected Output — não é adequado para a avaliação real de agents.
Hoje, os agents precisam ser avaliados em cenários de granularidade fina — múltiplas rodadas de conversa, colaboração entre múltiplos agents, chamadas de ferramentas, carregamento de Skills — e o NiceEval faz isso melhor.

Ao mesmo tempo, o NiceEval pode coexistir com o LangFuse e o BrainTrust: você pode usá-los para fazer tracing, ou enviar os resultados da avaliação para ambos (essa parte ainda está em desenvolvimento).

## Arquitetura

O NiceEval suporta duas formas de integração, dependendo se o agent sob teste precisa de um sistema de arquivos isolado em sandbox.

**Modo 1: Sandbox (Docker, E2B) — para rodar coding agents como Codex e Claude Code, que precisam de sandbox**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptador de Agent (oficial)
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox        │
   │   ┌────────────────────────┐ │
   │   │ Codex / Claude Code    │ │
   │   │ apps que precisam de   │ │
   │   │ um sistema de arquivos │ │
   │   │ isolado                │ │
   │   └────────────────────────┘ │
   └──────────────────────────────┘
```

**Modo 2: Conexão direta — conecte diretamente ao seu próprio AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptador de Agent (oficial, ou implementado por você)
        ▼
   ┌──────────────────────────────┐
   │     Seu próprio AI Agent     │
   │    (AI SDK·LangGraph·Pi)     │
   └──────────────────────────────┘
```

- O **núcleo do NiceEval** é responsável por descobrir evals, agendar execuções, pontuar, gerar relatórios e artifacts.
- O **Adaptador de Agent** é a fronteira aberta: você decide como chamar o sistema sob teste.
- Coding agents que precisam de isolamento de sistema de arquivos passam pelo **Docker Sandbox**; o seu próprio AI Agent pode se conectar diretamente, sem precisar de Docker.


## Exemplo

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "Testa se o agent chama a ferramenta correta para perguntas sobre o clima em tempo real e responde com base no resultado",

  async test(t) {
    const turn = await t.send("Como está o tempo em Beijing hoje?");
    t.succeeded();

    await t.group("Chama get_weather com a cidade correta", () => {
      t.calledTool("get_weather", { input: { city: "Beijing" } });
      t.messageIncludes(/°C|temperatura|tempo|ensolarado|nublado|chuva/);
    });

    const second = await t.send("Como estará o tempo em Shanghai amanhã?");
    second.messageIncludes("Shanghai");

    t.judge.autoevals
      .closedQA("O assistente respondeu com base nos dados de clima retornados pela ferramenta, em vez de inventar a temperatura?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // seu próprio agent adapter, conectando ao web agent sob teste

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // roda apenas eval-tool-call usando o experiment local
pnpm exec niceeval view // visualiza os resultados da avaliação
```

## Começo rápido

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

Comece pelo seu cenário:

- [Se você precisa avaliar seu plugin do Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Se você precisa avaliar sua Skill do Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Se você precisa avaliar sua aplicação de AI Agent](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
Adaptadores oficiais
- [ ] Software de Agent
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Frameworks de Agent
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentação

- [Começo rápido](https://niceeval.com/docs/quickstart)

# Agradecimentos
Este projeto foi inspirado pelos projetos abaixo, ou teve trechos de código escritos pela IA a partir do aprendizado com eles
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

Agradecimentos às seguintes comunidades
