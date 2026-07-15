# niceeval Setup Guide (Execution Steps for AI)

You are being asked to integrate [niceeval](https://github.com/CorrectRoadH/niceeval) into **the repository currently open here** (not niceeval's own source repository). Communicate with the user in the user's language. This file only gives the steps and decision points. It does not restate the exact code to write. Do not improvise from stale API knowledge in model memory.

Docs come from two phases:

- **Before install**: the package isn't on disk yet, so read `https://niceeval.com/docs/en/...` or the raw docs on GitHub to make project-assessment and install decisions.
- **After install**: only trust the bundled docs at `node_modules/niceeval/docs-site/`. They ship with the exact installed version; the website or the GitHub `main` branch may correspond to a different version.

Website links that appear before install can be read directly. Once Step 3 is done, find the `.mdx` file at the matching route inside the bundled directory first, then continue writing config, adapter, experiment, or eval code.

## Step 0: Build the right mental model

niceeval is a TypeScript evals library: you define "what a good result looks like" with a declarative API, then apply that to a coding agent, a deployed agent/service, or a pure function. Read these first. Do not skip them:

- Overview and design intent: https://niceeval.com/docs/en/concepts/overview
- 5-minute integration path: https://niceeval.com/docs/en/quickstart

There are only three core ideas you need to remember:

1. Each of the three files owns exactly one concern: **adapter** (how to talk to the system under test), **experiment** (what to evaluate, with what config, and how many runs), and **eval** (what input to send and what to assert).
2. niceeval **does not define any agent protocol**. If you are connecting to the user's own service, the adapter is just a normal HTTP request. URL and auth belong in adapter factory params, not in niceeval config.
3. CLI positional arguments are only for selecting "which evals to run" (by eval id prefix). Choosing "which agent/model to run against" must always be done via flags or experiment files. Do not overload positional args with URLs, agent names, or runtime config.

## Step 1: Confirm prerequisites

- The system under test can be built with any language or platform (iOS, Python service, anything else). niceeval only requires that this machine can run Node and commands like `npx` or `pnpm exec`. The adapter/experiment/eval trio is written in TS, but the host repo does not need to be a TS/JS project. If the current repo has no `package.json`, create one in place (or in a subdirectory) just to host those files. Do not stop just because the host project uses another language.
- The only real prerequisite is: this machine can install Node dependencies and run Node commands. Only stop and report back if even that is not possible.
- Check whether niceeval is already installed: look for `niceeval.config.ts`, an `evals/` directory, or a `niceeval` dependency in `package.json`. If it is already set up, skip to Step 4 and add the missing files within the existing structure. Do not run `init` again.
- Detect the package manager from lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`) and use that package manager consistently for every command afterward. Do not default to npm.

## Step 2: Explore the project first, then confirm with the user

This step determines the whole path afterward. **Explore the code yourself first, present the conclusions you could verify, and only ask about what you could not infer.** Do not start by throwing a questionnaire at the user, and do not guess before reading the code. You need to establish:

1. **What kind of agent this is**: read the README, inspect `package.json` deps, routing, and the agent loop code. Figure out what stack it uses (AI SDK, LangGraph, OpenAI Agents SDK, Claude Agent SDK, custom loop, etc.) and what the core use case is (support, SQL, coding, etc.).
2. **How the frontend talks to the agent**: HTTP, gRPC, or WebSocket? Is the protocol standard or custom? For example: AI SDK UI Message Stream, OpenAI Responses / Chat Completions, raw SDK-native event streams, or a custom JSON/SSE frame protocol. This determines whether the adapter can use a built-in path (zero mapping) or needs a hand-written `send` implementation (with event mapping).
3. **Whether the backend already has OTel**: search for OTel SDK initialization, AI SDK telemetry, LangSmith, OpenLLMetry, OpenInference, or similar tracing. If it already exists, Tier 2 is almost free.
4. **Whether the user already has A/B tests or feature flags**: if the app already exposes variation toggles, experiment `flags` can flow straight into that mechanism. That is a ready-made path for Tier 3.
5. **What to use for judge**: semantic scoring (`t.judge.autoevals.*`) needs a **judge model separate from the agent under test**, and it must speak an OpenAI-compatible `/chat/completions` API. That can be OpenAI, DeepSeek, or any compatible gateway. Ask which provider/key/model the user wants to use. There is no built-in default. If the user has no key yet, that does not block initial integration: judge assertions will silently skip, and you can still wire up exact assertions first.
6. **Whether the agent itself must run inside a sandbox**: if the system under test is a coding-agent CLI, or a Skill/Plugin/Hook/MCP server for a coding agent (something that edits files or runs commands inside an isolated workspace), it must use a sandbox. You cannot treat it like a plain HTTP service. Default to recommending `dockerSandbox()`, but **confirm with the user first**: does local/CI have Docker, or do they want Vercel Sandbox or another remote backend? If the user has no objection, default to Docker. Sandbox backends are configured only in code (experiment or the `sandbox` field in `niceeval.config.ts`), not via CLI flags and not via auto-detection. See: https://niceeval.com/docs/en/guides/sandbox-backends

After exploration, introduce the Tier model and recommend a path (details: https://niceeval.com/docs/en/concepts/tier):

- **Tier 1 (send only)**: no app changes, full assertion power already available here (text assertions, judge, multi-turn, tools, HITL).
- **Tier 2 (send + OTel)**: the app also sends OTel spans to niceeval, which unlocks the waterfall trace view in `niceeval view`. If tracing already exists (point 3 above), this is nearly zero-cost.
- **Tier 3 (invasive integration + flags)**: expose internal product variants through `flags` for feature A/B evaluation. If feature flags already exist (point 4 above), this becomes a natural path.

**Default recommendation: get Tier 1 working first, then upgrade to Tier 2.** Especially if the app already has OTel, say explicitly that "upgrading to Tier 2 is close to free because it is just forwarding spans you already emit." Only recommend Tier 3 when the user explicitly wants variant comparison.

Choose the matching doc path based on what you found. Do not start writing an adapter before reading the right docs:

| System under test | Read this |
|---|---|
| An app built with Vercel AI SDK (`useChat` backend) | https://niceeval.com/docs/en/reference/builtin-agents (`uiMessageStreamAgent` provides no-intrusion integration, no manual event mapping needed) |
| Coding-agent CLI (claude-code / codex / bub / anything that edits files) | https://niceeval.com/docs/en/guides/sandbox-agent (must configure `sandbox`, default `dockerSandbox()`, but confirm backend with the user first) |
| A Skill for Claude Code / Codex | https://niceeval.com/docs/en/example/claude-code-codex-skill (also runs in sandbox; backend confirmation is the same) |
| A Plugin / Hook / MCP server for Claude Code / Codex | https://niceeval.com/docs/en/example/claude-code-codex-plugin (also runs in sandbox; backend confirmation is the same) |
| Other custom agent loops, LangGraph, OpenAI Agents SDK, deployed agents | Start with https://niceeval.com/docs/en/guides/connect-your-agent, and use https://niceeval.com/docs/en/guides/write-send for the full hand-written `send` tutorial |
| Pure functions, no standalone service | First read the "why not direct calls" section in https://niceeval.com/docs/en/guides/connect-your-agent, then confirm with the user that this really is the edge-case path they want before continuing |

## Step 3: Install

```sh
<detected package manager> add -D niceeval
<detected package manager> exec niceeval init
```

`init` generates `niceeval.config.ts` and `evals/`. The installed CLI reference lives at `node_modules/niceeval/docs-site/reference/cli.mdx`.

From this step onward, stop using the website or the GitHub `main` branch to judge the API. First confirm the bundled docs exist:

```sh
test -f node_modules/niceeval/docs-site/quickstart.mdx
test -f node_modules/niceeval/docs-site/reference/cli.mdx
```

Then read:

- `node_modules/niceeval/docs-site/quickstart.mdx`
- `node_modules/niceeval/docs-site/reference/cli.mdx`
- `node_modules/niceeval/docs-site/guides/agent-feedback-loop.mdx`

`niceeval init` also adds a managed block to the project's `AGENTS.md` (or to `CLAUDE.md` if that's the only file present) reminding future coding agents to read this bundled doc directory. Do not delete or hand-edit the content inside the markers; re-run `init` after upgrading niceeval to refresh it.

Once installed, configure judge right away using the provider/model the user confirmed in Step 2. Judge uses an **OpenAI-compatible `/chat/completions`** API, configured in `niceeval.config.ts`:

```ts
import { defineConfig } from "niceeval";

export default defineConfig({
  judge: {
    model: "gpt-5.4-mini",                // required: there is no built-in default
    // Add these only when using a non-OpenAI compatible service (DeepSeek, gateway, etc.):
    // baseUrl: "https://api.deepseek.com/v1",
    // apiKeyEnv: "DEEPSEEK_API_KEY",     // reads the key from this env var; defaults to OPENAI_API_KEY
  },
});
```

Remind the user of two important behaviors:

- **If the key cannot be resolved, judge assertions silently skip**: no error, no score. So after configuring judge, run at least one eval with `t.judge` and confirm in `niceeval view` that a judge score was actually produced.
- The judge model must be **separate from the system under test**, so the same model is not grading itself. For model resolution priority (per-call -> per-eval -> global config) and the three scoring shapes, see the bundled `concepts/judge.mdx`; the full `judge` config schema is in `reference/define-config.mdx`.

## Step 4: Write the three artifacts

Based on the doc path chosen in Step 2, read the matching `.mdx` file inside `node_modules/niceeval/docs-site/`, then write these in order:

1. **adapter** (`agents/*.ts` or the repo's existing convention) - implement only `send` in `defineAgent`. All runtime config must come through factory params, never hardcoded and never read from `process.env` inside the adapter. Contract details (`TurnInput`, `AgentContext`, `Turn`, field-by-field): `concepts/adapter.mdx`. API signature: `reference/define-agent.mdx`. Standard event mapping for tool calls and multi-turn flows: `reference/events.mdx`.
2. **experiment** (`experiments/*.ts`) - reference the adapter and declare `model`, `flags`, `runs`, and related runtime config. If the system under test is an agent, also declare `sandbox` using the backend confirmed in Step 2, usually imported as `dockerSandbox()` from `niceeval/sandbox`. **By default, create one experiment folder specifically for model comparison**: create two files under `experiments/compare-models/`, both using the same adapter and everything else pinned, differing only by `model` (for example `compare-models/gpt-5.4.ts` and `compare-models/deepseek-v4-pro.ts`; `model` is a single string, not an array). Then one run of `niceeval exp compare-models` produces a side-by-side report. This is the clearest first demonstration of niceeval's value. Confirm with the user which two models they actually support and have keys for. If the app interface does not accept a model parameter, fall back to a single experiment file and explain why. Full field reference: `guides/write-experiment.mdx`. Project-level config (`niceeval.config.ts`): `reference/define-config.mdx`.
3. **eval** (`evals/*.eval.ts`) - **first figure out what the app actually does, then write one eval that matches a real use case**. Read the README, routes, tool definitions, or system prompt. Identify the core use case, and use that as the first eval input and assertions. Do not start with a meaningless placeholder like "hello". A support bot should get a real support-style question; a SQL agent should get a realistic query task. Start with the smallest working form: one input, `t.succeeded()`, and one content assertion against the expected answer. Once that runs, then add more assertion density. `defineEval` signature: `reference/define-eval.mdx`. Assertion authoring and `t.judge`: `guides/authoring.mdx` and `guides/scoring-guide.mdx`. Built-in assertion library: `reference/expect.mdx`.

For how parameters flow from experiment to adapter, and how to separate static config from per-turn dynamic values (factory params vs `ctx`), read: `guides/connect-your-agent.mdx`.

All the relative paths above are inside `node_modules/niceeval/docs-site/`.

There are two hard architecture rules. Do not violate them when writing the adapter:

- **Do not do in-process direct calls.** Even if the agent runtime lives in the same repo as the evals, the adapter should still use HTTP (or the real transport), not replace `fetch` with a direct `import` of the target function. The rationale is in the "why not direct calls" section of connect-your-agent.
- **Do not manage the target process from the eval side.** Do not spawn the app or open a separate port. The app should be started by the user the same way they normally run it (`pnpm dev`, etc.). If the adapter cannot connect, fail with a clear message like "start the app first". Do not try to boot it yourself.

## Step 5: Run and verify

```sh
<package manager> exec niceeval exp compare-models   # run the experiment group and get side-by-side results
<package manager> exec niceeval view                 # inspect the comparison in the local viewer
```

First read `node_modules/niceeval/docs-site/guides/agent-feedback-loop.mdx` so the AI uses `niceeval show`, `--transcript`, `--trace`, and `--diff` to run, observe, modify, and rerun. Viewer usage is documented in `node_modules/niceeval/docs-site/guides/viewing-results.mdx`. If something fails, split debugging into three buckets based on the error location (the full troubleshooting matrix is in `node_modules/niceeval/docs-site/guides/connect-your-agent.mdx`):

- `fetch` throws directly -> the app is not running, or the URL is wrong
- `t.succeeded()` fails -> the app responded with a non-success status
- only content assertions fail -> integration is working, now fix either assertions or app behavior

## Step 6: Close the loop and tell the user what you did

Once the first run works, summarize before suggesting anything else. The summary must state clearly: what system was connected, which files were created (where adapter / experiments / evals live), how to run `niceeval exp compare-models` and `niceeval view`, and what the first run result looked like. Do not refactor unrelated user code unless explicitly asked. Do not introduce new abstractions outside these files.

## Step 7: Ask whether the user wants deeper integration

After the summary, offer the next integration options. For each one, state **what it enables, roughly how much code it needs, and what benefit it buys**. Let the user choose. Do not do extra work on your own:

| What it enables | Rough change size | Benefit | Docs |
|---|---|---|---|
| Tool-call assertions (`t.calledTool()` etc.) | Adapter-only: map the app response into standard event streams, usually about 10-30 lines of mapping code | Evals can assert whether the agent used the right tools with the right params, instead of only checking the final reply | `guides/write-send.mdx`, `reference/events.mdx` |
| Multi-turn conversations and session isolation | Adapter-only: wire up `ctx.session` (`history()` or `id` + `capture()`), from a few lines to maybe a dozen | Evals can cover multi-turn scenarios and use `t.newSession()` to verify sessions do not bleed into each other | `guides/write-send.mdx` |
| Human-in-the-loop approval flows (HITL) | Adapter-only: return `waiting` + `input.requested` when blocked, then resume on the answer turn, usually around 10-20 lines | Evals can cover "what happens after approve/reject" workflows | `concepts/hitl.mdx` |
| Waterfall traces (upgrade to Tier 2) | If the app already has OTel (confirmed in Step 2): just forward spans to niceeval, a few config lines. If not: add a standard OTel init block | `niceeval view` shows internal model calls, tool runs, timing, and token timeline. It does not change any assertion behavior | `guides/connect-otel.mdx` |
| Feature A/B comparison (upgrade to Tier 3) | App change required: expose internal variants as switchable `flags`; size depends on the app. If feature flags already exist (confirmed in Step 2), the entry point is already there | Compare prompt changes, toolset changes, or feature toggles directly at the experiment layer | `concepts/tier.mdx`, `concepts/experiment.mdx` |

These paths are likewise relative to `node_modules/niceeval/docs-site/`. Also tell the user the key shared property: all of these are incremental adapter/app additions, and **none of the existing evals need to be rewritten**. For the three investment tiers and when each is worth it, see `concepts/tier.mdx`. If Step 2 found existing OTel instrumentation, actively recommend the waterfall trace upgrade because the cost is close to zero.
