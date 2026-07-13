import { createHash } from "node:crypto";

export const DEFAULT_BUB_OVERRIDE =
  "bub @ git+https://github.com/CorrectRoadH/bub.git@86fbd0febc1665353f5131173554e1f513e66b4c";

export const DEFAULT_BUB_OTEL_PLUGIN =
  "git+https://github.com/bubbuild/bub-contrib.git@add4a6a133c5658aec8f167ef50804d9ee55d22e#subdirectory=packages/bub-tapestore-otel";

export const BUB_CHECKPOINT_SUBDIRS = [".local"] as const;
export const BUB_INSTALL_MARKER = ".local/share/niceeval/bub-install-hash";

export function normalizeBubPackages(packages: readonly string[]): string[] {
  return [...new Set(packages.map((value) => value.trim()).filter(Boolean))].sort();
}

export function bubInstallSpec(
  packages: readonly string[],
  override = DEFAULT_BUB_OVERRIDE,
  otelPlugin = DEFAULT_BUB_OTEL_PLUGIN,
): string {
  const normalized = normalizeBubPackages(packages);
  const plugins = normalized.length ? ` --with ${normalized.join(" --with ")}` : "";
  return `bub --override(${override}) --with ${otelPlugin}${plugins} --checkpoint(${BUB_CHECKPOINT_SUBDIRS.join(",")})`;
}

export function bubInstallHash(
  packages: readonly string[],
  override = DEFAULT_BUB_OVERRIDE,
  otelPlugin = DEFAULT_BUB_OTEL_PLUGIN,
): string {
  return createHash("md5").update(bubInstallSpec(packages, override, otelPlugin)).digest("hex").slice(0, 12);
}
