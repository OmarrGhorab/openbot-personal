/** DOM-free logic of the tool-calls view of the Monitor: the filter chips and the output lines. */

import type { MonitorToolCallStatus } from "@openbot/contracts/ipc";

/** The chips of the tool-calls view. Running and Failed match the call status. */
export const MONITOR_TOOL_CALL_FILTERS = ["all", "running", "failed"] as const;
export type MonitorToolCallFilter = (typeof MONITOR_TOOL_CALL_FILTERS)[number];

/** The output lines that show before "Show more". A long output does not freeze the view. */
export const MONITOR_TOOL_OUTPUT_LINE_STEP = 200;

/** The calls that a filter keeps, in their order. */
export function filterMonitorToolCalls<T extends { status: MonitorToolCallStatus }>(
  calls: readonly T[],
  filter: MonitorToolCallFilter,
): T[] {
  if (filter === "all") return [...calls];
  return calls.filter((call) => call.status === filter);
}

export type MonitorDiffLineKind = "added" | "removed" | "plain";

/** How an output line shows: a green added line, a red removed line, or plain text. */
export function monitorDiffLineKind(line: string): MonitorDiffLineKind {
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  return "plain";
}
