// 规范工具名归一的唯一出处。canonical ToolName 是跨 agent 断言(calledTool("file_read"))
// 的命中基础:基表收「跨 agent 一致」的通用别名,各 parser 只声明自己特有的别名叠加在
// 基表上——新增一个 canonical 名只改这里,不必同步 4 张漂移的表。

import type { ToolName } from "../types.ts";

/** 通用别名基表(键一律小写;normalizeToolName 匹配前先 toLowerCase)。 */
const BASE_TOOL_ALIASES: Record<string, ToolName> = {
  // 文件
  read_file: "file_read",
  write_file: "file_write",
  create_file: "file_write",
  delete_file: "file_write",
  edit_file: "file_edit",
  patch_file: "file_edit",
  apply_patch: "file_edit",
  str_replace_editor: "file_edit",

  // shell
  shell: "shell",
  bash: "shell",
  exec: "shell",
  execute: "shell",
  run: "shell",
  terminal: "shell",
  command_execution: "shell",
  local_shell: "shell",
  execute_command: "shell",
  run_command: "shell",

  // web
  fetch: "web_fetch",
  http_request: "web_fetch",
  curl: "web_fetch",
  web_fetch: "web_fetch",
  fetch_url: "web_fetch",
  web_search: "web_search",
  search: "web_search",

  // 检索 / 导航
  glob: "glob",
  find_files: "glob",
  list_files: "glob",
  grep: "grep",
  search_files: "grep",
  ripgrep: "grep",
  ls: "list_dir",
  list_dir: "list_dir",
  list_directory: "list_dir",
  dir: "list_dir",

  // 子 agent / 计划
  task: "agent_task",
};

/**
 * 原始工具名 → 规范 ToolName。先查 agent 特有别名(overrides),再查通用基表,
 * 都没有则 "unknown"。键匹配不区分大小写(Claude Code 的 PascalCase 名靠这里兜住)。
 */
export function normalizeToolName(name: string, overrides?: Record<string, ToolName>): ToolName {
  const key = name.toLowerCase();
  return overrides?.[key] ?? BASE_TOOL_ALIASES[key] ?? "unknown";
}
