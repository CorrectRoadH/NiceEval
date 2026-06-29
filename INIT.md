## Role and Language

You are helping the user initialize `fasteval` in the current repository. First
read the target repository's `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`,
`README.md`, package metadata, and relevant docs. Infer the user's usual
language from those files and continue in that language.

Your goal is not to add a generic eval framework demo. Your goal is to leave the
repo with one small, meaningful eval that the team can run and extend.

## 0. Understand the Target Repo

Identify:

- The package manager (`pnpm`, `npm`, `yarn`, `bun`).
- The main language and framework.
- The normal local validation command, such as `test`, `typecheck`, `lint`, or
  `build`.
- The kind of system that should be evaluated first:
  - a coding-agent fixture;
  - a service or HTTP agent;
  - an in-process function or agent;
  - an existing workflow the user repeatedly asks agents to perform.

Prefer a narrow first eval. It should run quickly and prove the integration
shape, not cover the whole product.

## 1. Install fasteval

Use the target repo's package manager:

```sh
pnpm add -D fasteval
```

If the package is not published in the user's environment, use the local repo or
workspace dependency requested by the user. Do not invent a hidden install
method. State clearly which dependency form you used.

Then check that the CLI is reachable:

```sh
npx fasteval list
```

If this fails because `fasteval.config.ts` does not exist yet, that is expected.
Continue with the next step.

## 2. Create `fasteval.config.ts`

Create a minimal config at the repository root:

```ts
import { defineConfig } from "fasteval";
import agent from "./agents/fasteval-agent.ts";

export default defineConfig({
  agents: [agent],
  defaultAgent: agent.name,
  sandbox: "docker",
  maxConcurrency: 2,
  timeoutMs: 600_000,
});
```

Keep the config small. Add reporters, judge config, pricing, hooks, or
experiments only when the first eval actually needs them.

## 3. Create the First Agent Adapter

Create `agents/fasteval-agent.ts`.

For the current implementation, prefer a sandbox agent unless the user has
explicitly asked for a remote/in-process eval. The runner currently executes
sandbox agents; remote/in-process `defineAgent` is part of the API shape but not
the primary runnable path yet.

Template:

```ts
import { defineSandboxAgent } from "fasteval";

export default defineSandboxAgent({
  name: "local-coding-agent",
  async setup(sandbox, ctx) {
    // Install or configure the coding-agent CLI here.
    // Example: write config files, install a package, or verify a binary.
    ctx.log("agent setup complete");
  },
  async send(input, ctx) {
    const result = await ctx.sandbox.runCommand(
      "sh",
      ["-lc", `printf %s ${JSON.stringify(input.text)}`],
      { stream: true },
    );

    return {
      status: result.exitCode === 0 ? "completed" : "failed",
      events: [
        {
          type: "message",
          role: "assistant",
          text: result.stdout || result.stderr,
        },
      ],
    };
  },
});
```

Replace the shell placeholder with the real command for the user's agent. If the
agent writes a transcript, use `shared.captureLatestJsonl` and the parser helpers
exported through `shared` where appropriate. The adapter's job is to turn the
agent's native transcript into fasteval `events`.

Do not hardcode secrets. Read API keys, base URLs, and model settings from env or
from the repo's existing config conventions.

## 4. Add a Minimal Eval

Create `evals/<name>.eval.ts`.

For a coding-agent fixture:

```ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "Create a tiny feature and validate the changed files.",
  workspace: "fixtures/basic",
  async test(t) {
    await t.send("Create src/example.ts exporting a function named example.");

    t.succeeded();
    t.fileChanged("src/example.ts");
    t.check(t.file("src/example.ts"), includes("export"));
    t.testsPassed();
  },
});
```

Create `fixtures/basic/` with the smallest starter project needed by the eval.
If validation needs hidden tests, place `EVAL.ts` in the fixture and make sure it
is meaningful but small.

For a service/function-style eval, still keep the first eval narrow. If the
current runner cannot execute the desired `defineAgent` path yet, document that
as a TODO and create the sandbox eval first so the project has a runnable
vertical slice.

## 5. Run a Dry Check

Run:

```sh
npx fasteval list
npx fasteval --dry
```

Confirm:

- The eval id is derived from the file path.
- The configured agent name appears.
- The selected eval set is what you expect.

If discovery fails, fix imports, package type, TypeScript syntax, or paths before
moving on.

## 6. Run the First Eval

Run the smallest command that should work:

```sh
npx fasteval <eval-id-prefix> --agent <agent-name> --sandbox docker
```

If Docker is not available, stop and tell the user. Do not silently switch to an
unimplemented sandbox backend.

After the run, inspect `.fasteval/` and, if helpful, start the viewer:

```sh
npx fasteval view
```

## 7. Add Project Documentation

Add a short section to the target repo's README or developer docs:

````md
## Evals

This repo uses `fasteval` for agent evals.

```sh
npx fasteval list
npx fasteval --dry
npx fasteval <eval-id-prefix> --agent <agent-name> --sandbox docker
npx fasteval view
```

Eval files live in `evals/`. Coding-agent fixtures live in `fixtures/`.
````

If the repo has `AGENTS.md`, add one concise note for future agents:

```md
## fasteval

When changing evals or agent adapters, run `npx fasteval list` and
`npx fasteval --dry`. If you change runnable eval behavior, run the smallest
matching `npx fasteval <id-prefix> --agent <agent-name> --sandbox docker`
smoke test when Docker and credentials are available.
```

Keep the docs readable. Prefer a small command block and a link to the eval
directory over a long explanation of the whole fasteval architecture.

## 8. Final Verification

Before summarizing, run the checks that are appropriate for the target repo:

```sh
npx fasteval list
npx fasteval --dry
```

If you changed TypeScript code and the repo has a typecheck command, run it. If
you changed a fixture with a build or test script, run the smallest relevant
script.

## Final Summary

Tell the user:

- Which package manager and dependency form you used.
- Which files you created or changed.
- Which agent adapter name is registered.
- Which eval id was added.
- Which commands you ran and whether they passed.
- What remains blocked, such as missing Docker, missing credentials, or a
  placeholder adapter command that needs the user's real agent CLI.

Do not claim that `fasteval init` or `watch` is available unless the current
version actually implements those commands.
