<div align="center">

# NiceEval

**Una herramienta de evals para agentes de IA: progresiva, Agent-Native y con una DX excelente**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](../tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](../docs/README.md)

[English](../README.md) | [中文](../README.zh.md) | [Deutsch](README.de.md) | [français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

NiceEval es una herramienta de eval Agent-Native inspirada en [eve](https://eve.dev), que persigue la mejor DX posible.

Gracias a su diseño universal, NiceEval puede evaluar casi cualquier aplicación de agent.
Tanto si necesitas evaluar plugins, Hooks y Skills de coding agents escritos para Claude Code / Codex, como si quieres evaluar tu propia aplicación de AI Agent, la integración es sencilla.

Al terminar una eval se genera un informe fácil de leer y puedes inspeccionar el detalle del comportamiento del agent, lo que facilita hacer debug y entender qué hizo el agent.

## Por qué necesitas NiceEval si ya existen DeepEval, LangFuse o BrainTrust

NiceEval es una herramienta de evaluación Agent-Native. El patrón de Dataset / golden —«construir un Input y un Expected Output»— no encaja con la evaluación de agents reales.
Hoy los agents necesitan evaluarse en escenarios de grano fino: conversaciones de múltiples turnos, colaboración entre múltiples agents, llamadas a herramientas, carga de Skills, etc., y NiceEval lo hace mejor.

Al mismo tiempo, NiceEval puede coexistir con LangFuse y BrainTrust: puedes usarlos para hacer tracing, o subir los resultados de la evaluación a ambos (esta parte está en desarrollo).

## Arquitectura

NiceEval admite dos formas de integración, según si el agent bajo prueba necesita un sistema de archivos aislado en un sandbox.

**Modo 1: Sandbox (Docker, E2B) — para ejecutar coding agents como Codex o Claude Code que necesitan sandbox**

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
   ┌───────────────────────────────────────┐
   │            Docker Sandbox             │
   │   ┌───────────────────────────────┐   │
   │   │ Codex / Claude Code           │   │
   │   │ apps que necesitan un sistema │   │
   │   │ de archivos aislado           │   │
   │   └───────────────────────────────┘   │
   └───────────────────────────────────────┘
```

**Modo 2: Conexión directa — conecta directamente tu propio AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Adaptador de Agent (oficial o propio)
        ▼
   ┌───────────────────────────┐
   │    Tu propio AI Agent     │
   │  (AI SDK·LangGraph·Pi)    │
   └───────────────────────────┘
```

- **El núcleo de NiceEval** se encarga de descubrir evals, orquestar la ejecución, calificar, y generar informes y artifacts.
- **El Adaptador de Agent** es el límite abierto: tú decides cómo invocar al sistema bajo prueba.
- Los coding agents que necesitan aislamiento del sistema de archivos pasan por el **Docker Sandbox**; tu propio AI Agent puede conectarse directamente, sin necesidad de Docker.


## Ejemplo

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "Prueba la capacidad del agent de llamar correctamente a la herramienta en preguntas sobre el clima en tiempo real y responder según el resultado",

  async test(t) {
    const turn = await t.send("¿Qué tiempo hace hoy en Beijing?");
    t.succeeded();

    await t.group("Llama a get_weather con la ciudad correcta", () => {
      t.calledTool("get_weather", { input: { city: "Beijing" } });
      t.messageIncludes(/°C|temperatura|clima|soleado|nublado|lluvia/);
    });

    const second = await t.send("¿Qué tiempo hará mañana en Shanghai?");
    second.messageIncludes("Shanghai");

    t.judge.autoevals
      .closedQA("¿La respuesta del asistente se basa en los datos meteorológicos devueltos por la herramienta, en lugar de inventar la temperatura?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // tu propio adaptador de agent, que conecta con el web agent bajo prueba

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // usa el experiment local para ejecutar solo eval-tool-call
pnpm exec niceeval view // consulta los resultados de la evaluación
```

## Inicio rápido

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

Empieza por tu escenario:

- [Si necesitas evaluar tu plugin de Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Si necesitas evaluar tu Skill de Claude Code / Codex](https://niceeval.com/docs/example/claude-code-codex-skill)
- [Si necesitas evaluar tu aplicación de AI Agent](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
Adaptadores oficiales
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

## Documentación

- [Inicio rápido](https://niceeval.com/docs/quickstart)

# Agradecimientos
Este proyecto está inspirado en los siguientes proyectos, o fue escrito por una IA que aprendió del código de los siguientes proyectos
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

Gracias a las siguientes comunidades
