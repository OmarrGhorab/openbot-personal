// The Monitor snapshot of a channel. Only the main window reads it: every window of the app shares
// one origin, so the trusted-URL gate alone would also let a chat window, the Dynamic Island or the
// browser dock overlay read every agent's tool calls.

import { parseMonitorConversationInput, parseMonitorSnapshotInput } from "@openbot/contracts/ipc";
import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { MonitorService } from "../monitor-service";
import { authorizedHandler, type IpcGroupHandlers } from "./define-ipc-group";

export interface MonitorIpcDependencies {
  monitor: Pick<MonitorService, "snapshot" | "conversation">;
  /** The web contents ids of the main window, read on each call. */
  mainRendererIds: () => ReadonlySet<number>;
}

export function requireMonitorSender(actualId: number, expectedIds: ReadonlySet<number>): void {
  if (!expectedIds.has(actualId)) throw new Error("Rejected monitor IPC request outside the main renderer.");
}

export function monitorIpcHandlers({
  monitor,
  mainRendererIds,
}: MonitorIpcDependencies): Pick<IpcGroupHandlers, "monitor"> {
  const fromMainRenderer = (event: IpcMainInvokeEvent) => requireMonitorSender(event.sender.id, mainRendererIds());
  return {
    monitor: {
      getSnapshot: authorizedHandler(fromMainRenderer, parseMonitorSnapshotInput, (_event, input) =>
        runCauseEffect(monitor.snapshot(input.channelId)),
      ),
      getConversation: authorizedHandler(fromMainRenderer, parseMonitorConversationInput, (_event, input) =>
        runCauseEffect(monitor.conversation(input)),
      ),
    },
  };
}
