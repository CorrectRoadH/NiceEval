<div align="center">

# fasteval

**Lightweight TypeScript agent evals for every project.**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)

</div>

> fasteval is a lightweight TypeScript evals library for evaluating agents,
> services, functions, and coding-agent fixtures with one `defineEval` surface.

Write small TypeScript evals, run them against named agents, and inspect
verdicts, traces, costs, diffs, transcripts, and artifacts without building a
bespoke harness for every project.

fasteval is intentionally general-purpose. It is not tied to one agent protocol,
one coding-agent CLI, or one sandbox provider. The core owns eval discovery,
scoring, scheduling, reporting, and artifacts; your `Agent` adapter owns how to
talk to the system under test; your `Sandbox` owns where isolated coding-agent
work runs.

## Status

This repository is an early implementation, not a fully polished npm product.
The current code already has the core shape, but some documented target-DX
features are still on the roadmap.

### Supported today

- TypeScript runtime through `tsx`, including `fasteval.config.ts`,
  `evals/*.eval.ts`, `experiments/*.ts`, and user-defined agent adapters.
- Public definition APIs: `defineEval`, `defineConfig`, `defineExperiment`,
  `defineAgent`, and `defineSandboxAgent`.
- Eval discovery from `evals/`, with path-derived ids and array fan-out.
- Sandbox-agent execution through user-registered `defineSandboxAgent`
  adapters.
- Docker sandbox backend.
- Workspace upload, git baseline, generated-file diff capture, sandbox command
  execution, and Vitest-based `EVAL.ts` validation.
- Value assertions such as `includes`, `excludes`, `equals`, `matches`,
  `similarity`, and `satisfies`.
- Scoped assertions over the normalized event stream: tool calls, message
  content, failed actions, workspace diffs, scripts, token usage, and cost.
- LLM-as-judge through an OpenAI-compatible `/chat/completions` endpoint.
- Normalized transcript/event parsing helpers for Codex, Claude Code, and bub.
  The adapters themselves are registered by the evaluated project.
- Run artifacts under `.fasteval/`, including summary data, events, traces,
  o11y summaries, diffs, and raw transcripts.
- `fasteval list`, default run, `fasteval exp`, `fasteval view`,
  `fasteval clean`, `--dry`, `--agent`, `--sandbox`, `--model`, `--runs`,
  `--max-concurrency`, `--timeout`, `--strict`, and `--quiet`.

### Not yet supported

- Built-in agent names such as `claude-code`, `codex`, or `bub` in the default
  registry. Today the target repo registers adapters in `fasteval.config.ts`.
- Remote / in-process `defineAgent` execution in the runner. The API exists,
  but the current runner path only executes sandbox agents.
- `fasteval init` and `fasteval watch`. The CLI accepts these commands, but they
  are MVP placeholders.
- Vercel or other third-party sandbox backends. `auto` currently falls back to
  Docker unless a future backend is implemented.
- Fingerprint result cache and watch-mode reruns.
- CLI flags for every target option in the design docs, such as `--junit`,
  `--json`, `--force`, `--tag`, `--budget`, `--scripts`, and `--smoke`.
  Some reporter and budget primitives exist in code, but the CLI surface is not
  complete yet.

## Install

For a project that depends on a published package:

```sh
npm install -D fasteval
```

For local development in this repository:

```sh
pnpm install
pnpm run typecheck
```

CLI smoke runs need a target repository with `fasteval.config.ts` and at least
one registered agent.

## Quick Start

Create a `fasteval.config.ts` and register at least one sandbox agent. The
adapter is where you install and invoke the coding-agent CLI, then normalize its
transcript into fasteval events.

```ts
// fasteval.config.ts
import { defineConfig } from "fasteval";
import codex from "./agents/codex.ts";

export default defineConfig({
  agents: [codex],
  defaultAgent: "codex",
  sandbox: "docker",
  maxConcurrency: 4,
  timeoutMs: 600_000,
});
```

Then add a small eval:

```ts
// evals/button.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "Build a Button component with a label and click handler.",
  workspace: "fixtures/button",
  async test(t) {
    await t.send("Create src/components/Button.tsx with label and onClick props.");

    t.succeeded();
    t.fileChanged("src/components/Button.tsx");
    t.check(t.file("src/components/Button.tsx"), includes("onClick"));
    t.testsPassed();
  },
});
```

Run it:

```sh
npx fasteval button --agent codex --sandbox docker
npx fasteval view
```

The output is both a verdict and a set of artifacts: the normalized event
stream, transcript-derived facts, diff, validation output, token usage, cost
estimate, and optional trace spans.

## Agent Init Guide

To ask an AI coding agent to initialize fasteval in another repository, give it
this prompt:

```text
Read https://raw.githubusercontent.com/CorrectRoadH/fasteval/refs/heads/main/INIT.md and initialize fasteval for this repository.
```

That guide is written for agents. It tells them to inspect the target repo,
choose the right first eval, create `fasteval.config.ts`, register an adapter,
add a minimal eval, run a dry check, and leave the project with readable docs.

## Common Commands

```sh
fasteval list                         # list discovered evals
fasteval --dry                        # discover and show what would run
fasteval <id-prefix> --agent <name>   # run matching evals against one agent
fasteval exp [group-or-id]            # run checked-in experiment configs
fasteval view                         # open the local artifact viewer
fasteval view --out report.html       # export a static HTML report
fasteval clean                        # remove .fasteval/ artifacts
```

The CLI model is deliberately simple:

- Positionals select **which evals** to run. They are eval id prefixes.
- Flags select **how to run** and **which agent** to use.

Agent names, URLs, and runtime choices are not positional arguments. To talk to
your own service, write an `Agent` adapter and let it read its URL from env or
config.

## Configuration Example

```ts
// fasteval.config.ts
import { defineConfig } from "fasteval";
import { Json, JUnit } from "fasteval/reporters";
import codex from "./agents/codex.ts";

export default defineConfig({
  agents: [codex],
  defaultAgent: "codex",
  sandbox: "docker",
  maxConcurrency: 4,
  timeoutMs: 600_000,
  judge: {
    model: "gpt-5.4-mini",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  reporters: [
    Json(".fasteval/results.json"),
    JUnit(".fasteval/junit.xml"),
  ],
});
```

Configuration answers stable project questions: which adapters exist, which one
is the default, where sandboxed work runs, how much concurrency is allowed, how
judge scoring is authenticated, and which reports are emitted.

## Concepts

**Eval** is a small TypeScript file that describes correct behavior. The eval id
comes from the path, so `evals/weather/brooklyn.eval.ts` becomes
`weather/brooklyn`.

**Agent** is a named connection to the system under test. An adapter decides how
to call a function, service, or coding-agent CLI and returns normalized events.
fasteval does not define one universal HTTP agent protocol.

**Sandbox** is where isolated coding-agent work runs. Docker is implemented
today; other backends are planned behind the same interface.

**Scoring** combines value assertions, scoped assertions over the event stream,
Vitest validation, and optional LLM-as-judge checks.

**Artifacts** are first-class. A run should tell you not just pass/fail, but what
the agent did, which files changed, which tools ran, how much it cost, and where
the failure came from.

## Roadmap

1. **Readable onboarding:** ship `fasteval init`, project templates, example
   adapters, and a shorter first-run path.
2. **Agent adapter packs:** provide maintained Codex, Claude Code, and bub
   adapters so most projects can register a known adapter instead of writing one
   from scratch.
3. **Remote and in-process runner path:** execute `defineAgent` adapters for
   services, functions, and deployed agents, not only sandbox agents.
4. **Watch and cache:** add fingerprint caching, changed-only reruns, watch
   mode, and force reruns.
5. **More sandbox backends:** implement Vercel Sandbox and keep room for E2B,
   Modal, Daytona, or project-owned backends.
6. **CI polish:** complete CLI flags for JSON/JUnit output, smoke checks,
   budgets, tags, extra scripts, and stricter machine-readable summaries.
7. **Viewer depth:** expand `fasteval view` with better trace inspection,
   transcript search, diff navigation, and experiment comparison.

## Documentation

The docs are designed to be easy to enter and easy to route:

- [Documentation home](docs/README.md) - what fasteval is and where to start.
- [Getting Started](docs/getting-started.md) - target workflow examples.
- [Authoring](docs/authoring.md) - how to write evals.
- [Scoring](docs/scoring.md) - gates, soft scores, matchers, and judge checks.
- [Agents and Adapters](docs/agents-and-adapters.md) - how to connect systems
  under test.
- [Sandbox](docs/sandbox.md) - isolation boundary and backend contract.
- [Runner](docs/runner.md) - discovery, scheduling, attempts, and lifecycle.
- [Experiments](docs/experiments.md) - checked-in run matrices.
- [Observability](docs/observability.md) - events, traces, usage, cost, and
  artifacts.
- [CLI](docs/cli.md) - command model and reference.
- [Source Map](docs/source-map.md) - map documented behavior back to source
  files.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run site:build
```

When changing `src/` or `bin/`, run `pnpm run typecheck`. When changing the
product site, run `pnpm run site:build`. CLI behavior should be smoked from a
fixture or target repository that has `fasteval.config.ts`.
