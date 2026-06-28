import { register } from "tsx/esm/api";
register();
import { readFileSync } from "node:fs";
for (const line of readFileSync("/Users/ctrdh/Code/coding-agent-memory-evals/.env","utf8").split("\n")){
  const t=line.trim(); if(!t||t.startsWith("#"))continue; const i=t.indexOf("="); if(i<0)continue;
  const k=t.slice(0,i).trim(); let v=t.slice(i+1).trim().replace(/^["']|["']$/g,""); if(!process.env[k])process.env[k]=v;
}
const { DockerSandbox } = await import("./src/sandbox/docker.ts");
const log=(...a)=>console.log(new Date().toISOString().slice(11,19), ...a);
const sb = await DockerSandbox.create({ timeout: 600000, runtime: "node24" });
try {
  log("sandbox up", sb.sandboxId);
  log("installing curl (root)...");
  // curl needed for uv installer; node:24-slim may lack it
  const hascurl = await sb.runShell("command -v curl || true");
  if(!hascurl.stdout.trim()){
    // try install as root via docker exec — runCommand is non-root; use a root shell trick is not available.
    log("curl missing; trying wget");
  }
  log("installing uv + bub (this downloads python 3.12, ~minutes)...");
  const inst = await sb.runShell(
    "curl -LsSf https://astral.sh/uv/install.sh | sh && $HOME/.local/bin/uv tool install --python 3.12 --prerelease allow 'bub>=0.3.0a1'",
    { });
  log("install exit", inst.exitCode);
  console.log("install tail:\n" + (inst.stdout+inst.stderr).split("\n").slice(-20).join("\n"));
  if(inst.exitCode!==0) throw new Error("bub install failed");
  const ver = await sb.runShell("$HOME/.local/bin/bub --help 2>&1 | head -20");
  console.log("bub --help:\n"+ver.stdout);
  log("running bub run...");
  const env = { BUB_API_KEY: process.env.BUB_API_KEY, BUB_API_BASE: process.env.BUB_API_BASE, BUB_MODEL:"openai:gpt-5.4", BUB_HOME:"/home/node/.bub" };
  const r = await sb.runShell(
    `$HOME/.local/bin/bub --workspace /home/sandbox/workspace run 'Create a file named hello.txt containing the single word: hi. Then stop.' --session-id probe1`,
    { env });
  log("bub run exit", r.exitCode);
  console.log("bub stdout tail:\n"+r.stdout.split("\n").slice(-20).join("\n"));
  if(r.exitCode!==0) console.log("bub stderr tail:\n"+r.stderr.split("\n").slice(-20).join("\n"));
  console.log("hello.txt:", (await sb.runShell("cat /home/sandbox/workspace/hello.txt 2>/dev/null || echo MISSING")).stdout.trim());
  console.log("tapes:", (await sb.runShell("ls -la /home/node/.bub/tapes/ 2>/dev/null || echo NO_TAPES")).stdout);
  log("DONE");
} finally { await sb.stop(); log("sandbox stopped"); }
