# niceeval Setup Guide (Execution Steps for AI)

You are being asked to integrate [niceeval](https://github.com/CorrectRoadH/niceeval) into **the repository currently open here** (not niceeval's own source repository). Communicate with the user in the user's language. Do not improvise from stale API knowledge in model memory.

This file is responsible for exactly one thing: getting the package into the project. The integration workflow itself (exploring the project, confirming the path with the user, writing adapter / experiment / eval, getting the first run green) lives entirely in the bundled docs, which ship with the installed version — so this file contains no online doc links. Once installed, route everything through `node_modules/niceeval/INDEX.md`. The bundled docs are written in Chinese — read them anyway; they are the version-accurate source, and you still communicate with the user in the user's language.

## Step 0: Three core ideas

niceeval is a TypeScript evals library: you define "what a good result looks like" with a declarative API, then apply that to a coding agent, a deployed agent/service, or a pure function. These three ideas are all you need for the install decision:

1. Each of the three files owns exactly one concern: **adapter** (how to talk to the system under test), **experiment** (what to evaluate, with what config, and how many runs), and **eval** (what input to send and what to assert).
2. niceeval **does not define any agent protocol**. If you are connecting to the user's own service, the adapter is just a normal HTTP request. URL and auth belong in adapter factory params, not in niceeval config.
3. CLI positional arguments are only for selecting "which evals to run" (by eval id prefix). Choosing "which agent/model to run against" must always be done via flags or experiment files. Do not overload positional args with URLs, agent names, or runtime config.

## Step 1: Confirm prerequisites

- The system under test can be built with any language or platform (iOS, Python service, anything else). niceeval only requires that this machine has Node and can run commands like `npx` or `pnpm exec`. The adapter/experiment/eval trio is written in TS, but the host repo does not need to be a TS/JS project. If the current repo has no `package.json`, create one in place (or in a subdirectory) just to host those files. Do not stop just because the host project uses another language.
- The only real prerequisite is: this machine can install Node dependencies and run Node commands. Only if even that is confirmed impossible, tell the user honestly and stop for their decision.
- Check whether niceeval is already installed: look for `niceeval.config.ts`, an `evals/` directory, or a `niceeval` dependency in `package.json`. If it is already set up, skip installing, go straight to Step 3 and read the bundled docs, then add the missing files within the existing structure. Do not run `init` again.
- Detect the package manager from lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`) and use that package manager for every command afterward. Do not default to npm.

## Step 2: Install

Installing is adding one dev dependency — cheap and reversible. You do not need to understand the whole project before doing it; exploring the project belongs to the post-install integration workflow:

```sh
<detected package manager> add -D niceeval
<detected package manager> exec niceeval init
```

`init` generates `niceeval.config.ts` and `evals/`, and adds a managed block to the project's `AGENTS.md` (or to `CLAUDE.md` when that is the only file present), reminding future coding agents to read the bundled docs. Do not delete or hand-edit the content inside the markers; re-run `init` after upgrading niceeval to refresh it.

## Step 3: Hand off to the bundled docs

First confirm the bundled docs exist:

```sh
test -f node_modules/niceeval/INDEX.md
```

Then read `node_modules/niceeval/INDEX.md`. Every page has a one-line self-description in the index; pick pages by task. For integrating from scratch, choose the "Coding Agent 从零接入" (Coding Agent onboarding from scratch) tutorial page and follow it for all remaining work: exploring the project and confirming the path with the user, configuring judge, writing the three artifacts, running and verifying, wrapping up, and asking whether the user wants deeper integration.

The bundled docs ship with the exact installed version; the website or the GitHub `main` branch may correspond to a different version. From this step onward, do not use them to judge the API.
