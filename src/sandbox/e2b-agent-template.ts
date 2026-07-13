import { Template, type TemplateBuilder } from "e2b";
import {
  BUB_INSTALL_MARKER,
  DEFAULT_BUB_OTEL_PLUGIN,
  DEFAULT_BUB_OVERRIDE,
  bubInstallHash,
  normalizeBubPackages,
} from "../agents/bub-install-spec.ts";

export type E2BCodingAgent = "claude-code" | "codex" | "bub";

export interface E2BCodingAgentTemplateOptions {
  /** Extra packages installed in Bub's uv tool environment and included in its compatibility marker. */
  bubPythonPackages?: readonly string[];
}

/** Provider-owned template aliases. Bub is built from NiceEval's pinned recipe. */
export const E2B_OFFICIAL_AGENT_TEMPLATES = {
  "claude-code": "claude",
  codex: "codex",
} as const;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Start an extensible E2B template for a coding agent.
 *
 * Claude Code and Codex extend E2B's official templates. Bub uses NiceEval's
 * immutable install recipe because E2B does not currently publish a Bub base.
 * Callers can chain normal E2B TemplateBuilder operations before building.
 */
export function e2bCodingAgentTemplate(
  agent: E2BCodingAgent,
  options: E2BCodingAgentTemplateOptions = {},
): TemplateBuilder {
  if (agent === "claude-code" || agent === "codex") {
    if (options.bubPythonPackages?.length) {
      throw new Error("bubPythonPackages can only be used with the Bub E2B template");
    }
    return Template().fromTemplate(E2B_OFFICIAL_AGENT_TEMPLATES[agent]);
  }

  const packages = normalizeBubPackages(options.bubPythonPackages ?? []);
  const installHash = bubInstallHash(packages);
  const withPackages = packages.map((value) => ` --with ${shellQuote(value)}`).join("");
  const marker = `/home/user/${BUB_INSTALL_MARKER}`;
  const overrideFile = "/tmp/bub-override.txt";
  return Template()
    .fromBaseImage()
    .runCmd("curl -LsSf https://astral.sh/uv/install.sh | sh", { user: "user" })
    .runCmd(
      [
        `printf '%s\\n' ${shellQuote(DEFAULT_BUB_OVERRIDE)} > ${overrideFile}`,
        `$HOME/.local/bin/uv tool install --python 3.12 --prerelease allow bub --overrides ${overrideFile} --with ${shellQuote(DEFAULT_BUB_OTEL_PLUGIN)}${withPackages}`,
        `mkdir -p $(dirname ${marker}) && printf '%s' ${shellQuote(installHash)} > ${marker}`,
      ],
      { user: "user" },
    );
}
