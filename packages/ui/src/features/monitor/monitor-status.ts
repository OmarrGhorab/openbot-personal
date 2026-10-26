/**
 * The statuses that the Monitor parts show, and the text for each one. An agent reports
 * `working`, `waiting`, `error` or `idle`; a task or a hand-off can also be `done`.
 */

import { MONITOR_AGENT_STATUSES, type MonitorAgentStatus, type MonitorToolCallStatus } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { AvatarMood } from "../../bloub-avatar";

export type MonitorStatus = MonitorAgentStatus | "done";

/** Every status, in the order that a legend shows them. */
export const MONITOR_STATUSES: readonly MonitorStatus[] = [...MONITOR_AGENT_STATUSES, "done"];

export const MONITOR_STATUS_LABEL = {
  working: "monitor.agentStatus.working",
  waiting: "monitor.agentStatus.waiting",
  error: "monitor.agentStatus.error",
  done: "monitor.agentStatus.done",
  idle: "monitor.agentStatus.idle",
} as const satisfies Record<MonitorStatus, AppTextKey>;

/** A tool call takes the colour of the agent status it is closest to. */
export const MONITOR_TOOL_STATUS_TONE = {
  running: "working",
  done: "done",
  failed: "error",
} as const satisfies Record<MonitorToolCallStatus, MonitorStatus>;

export const MONITOR_TOOL_STATUS_LABEL = {
  running: "monitor.toolStatus.running",
  done: "monitor.toolStatus.done",
  failed: "monitor.toolStatus.failed",
} as const satisfies Record<MonitorToolCallStatus, AppTextKey>;

/** The face of the agent icon for a status. It never changes the silhouette. */
export const MONITOR_STATUS_MOOD = {
  working: "working",
  waiting: "waiting",
  error: "failed",
  done: "idle",
  idle: "idle",
} as const satisfies Record<MonitorStatus, AvatarMood>;

export type MonitorToolKind = "edit" | "read" | "command" | "search" | "web" | "other";

const TOOL_KINDS: Record<string, MonitorToolKind> = {
  edit: "edit",
  multiedit: "edit",
  write: "edit",
  apply_patch: "edit",
  str_replace: "edit",
  str_replace_editor: "edit",
  notebookedit: "edit",
  read: "read",
  view: "read",
  read_file: "read",
  bash: "command",
  shell: "command",
  exec: "command",
  exec_command: "command",
  run_command: "command",
  grep: "search",
  glob: "search",
  ls: "search",
  search: "search",
  codebase_search: "search",
  webfetch: "web",
  websearch: "web",
  web_fetch: "web",
  web_search: "web",
};

/** The kind of a tool name as a provider reports it, such as `Edit` or `exec_command`. */
export function monitorToolKind(tool: string): MonitorToolKind {
  return TOOL_KINDS[tool.trim().toLowerCase()] ?? "other";
}

export const MONITOR_TOOL_KIND_LABEL = {
  edit: "monitor.tool.edit",
  read: "monitor.tool.read",
  command: "monitor.tool.command",
  search: "monitor.tool.search",
  web: "monitor.tool.web",
} as const satisfies Record<Exclude<MonitorToolKind, "other">, AppTextKey>;
