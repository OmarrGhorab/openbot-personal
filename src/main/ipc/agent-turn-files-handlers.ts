// The files a turn changed, for the Changes panel. Only the main window reads them: a turn's files
// name workspace paths, and every window of the app shares one origin, so the trusted-URL gate
// alone would also let a chat window read another agent's files.

import { parseTurnFileDiffInput, parseTurnFilesInput } from "@openbot/contracts/ipc";
import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { HostService } from "../host-service";
import { authorizedHandler, type IpcGroupHandlers } from "./define-ipc-group";

export interface AgentTurnFilesIpcDependencies {
  host: Pick<HostService, "listTurnFiles" | "readTurnFileDiff">;
  /** The web contents ids of the main window, read on each call. */
  mainRendererIds: () => ReadonlySet<number>;
}

function requireMainSender(actualId: number, expectedIds: ReadonlySet<number>): void {
  if (!expectedIds.has(actualId)) throw new Error("Rejected turn files IPC request outside the main renderer.");
}

export function agentTurnFilesIpcHandlers({
  host,
  mainRendererIds,
}: AgentTurnFilesIpcDependencies): Pick<IpcGroupHandlers, "agentTurnFiles"> {
  const fromMainRenderer = (event: IpcMainInvokeEvent) => requireMainSender(event.sender.id, mainRendererIds());
  return {
    agentTurnFiles: {
      listTurnFiles: authorizedHandler(fromMainRenderer, parseTurnFilesInput, (_event, input) =>
        runCauseEffect(host.listTurnFiles(input.agentId, input.turnId)),
      ),
      readTurnFileDiff: authorizedHandler(fromMainRenderer, parseTurnFileDiffInput, (_event, input) =>
        runCauseEffect(host.readTurnFileDiff(input.agentId, input.path)),
      ),
    },
  };
}
