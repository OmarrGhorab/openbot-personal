// Instance transfer for a server: this computer's own, or a joined server with `instance-transfer-v1`.
// Main opens both file dialogs and moves the file, so the renderer never names a path, and only main
// can reveal the saved file.

import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type ApplyInstanceTransferInput,
  type CopyInstanceTransferInput,
  decodeRemoteInstanceTransferResult,
  decodeRemoteInstanceTransferSummary,
  decodeRollbackInstanceTransferResult,
  type ExportInstanceInput,
  type InstanceExportResult,
  type InstanceTransferPreview,
  LOCAL_SERVER_ID,
  type MoveInstanceSourceInput,
  type MoveInstanceSourceResult,
  parseApplyInstanceTransferInput,
  parseCopyInstanceTransferInput,
  parseExportInstanceInput,
  parseMoveInstanceSourceInput,
  parseRollbackInstanceTransferInput,
  parseShowInstanceArchiveInput,
  type RollbackInstanceTransferInput,
  type RollbackInstanceTransferResult,
  resolveRemoteInstanceTransferResult,
  type ShowInstanceArchiveInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  INSTANCE_TRANSFER_CAPABILITY,
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import {
  INSTANCE_TRANSFER_V2_CAPABILITY,
  INSTANCE_TRANSFER_V2_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v2";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions, shell } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { prepareCopy } from "../instance-transfer-copy";
import type { InstanceTransferService } from "../instance-transfer-service";
import { decodeAgentSummaries } from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import { AGENT_IMPORT_UPLOAD_TIMEOUT_MS, type RemoteServerManager } from "../remote-server-manager";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { stringPayload } from "./validation";

export interface InstanceTransferIpcDependencies {
  instanceTransfer: InstanceTransferService;
  remoteServers: Pick<
    RemoteServerManager,
    "supportsCapability" | "request" | "stageInstanceTransfer" | "downloadInstanceTransfer"
  >;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function instanceTransferIpcHandlers({
  instanceTransfer,
  remoteServers,
  getMainWindow,
  translate,
}: InstanceTransferIpcDependencies): Pick<IpcGroupHandlers, "instanceTransfer"> {
  const filters = [{ name: translate("dialog.filter.transfer"), extensions: ["zip"] }];
  /** The file this computer saved last, for "Show the file". */
  let lastExport: string | null = null;

  const chooseDestination = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const date = new Date().toISOString().slice(0, 10);
    const options: SaveDialogOptions = {
      title: translate("dialog.saveTransfer"),
      defaultPath: join(app.getPath("downloads"), `openbot-transfer-${date}.zip`),
      filters,
      showsTagField: false,
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  };

  const chooseFile = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const options: OpenDialogOptions = {
      title: translate("dialog.chooseTransfer"),
      properties: ["openFile"],
      filters,
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };

  const requireRemote = (serverId: string) => {
    if (!remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_CAPABILITY))
      throw new Error(sourceText("error.team.instanceTransferUnsupported"));
  };

  /** A joined server records the migration only when it serves the v2 routes. */
  const resumableTarget = (serverId: string): boolean =>
    serverId === LOCAL_SERVER_ID ||
    (remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_CAPABILITY) &&
      remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_V2_CAPABILITY));

  const exportLocal = async (input: ExportInstanceInput): Promise<InstanceExportResult> => {
    const path = await chooseDestination();
    if (!path) return { saved: false, fileName: null, warnings: [] };
    const result = await runCauseEffect(instanceTransfer.exportTo(path, input));
    lastExport = path;
    return result;
  };

  const exportRemote = async (input: ExportInstanceInput, serverId: string): Promise<InstanceExportResult> => {
    requireRemote(serverId);
    const path = await chooseDestination();
    if (!path) return { saved: false, fileName: null, warnings: [] };
    const bytes = await runCauseEffect(remoteServers.downloadInstanceTransfer(serverId, input));
    // The file appears only when it is complete, as a local export does.
    const part = `${path}.part`;
    try {
      await writeFile(part, bytes);
      await rename(part, path);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    lastExport = path;
    return { saved: true, fileName: basename(path), warnings: [] };
  };

  const stageRemote = async (serverId: string): Promise<InstanceTransferPreview | null> => {
    requireRemote(serverId);
    const path = await chooseFile();
    if (!path) return null;
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(sourceText("error.import.chooseZip"));
    if (info.size > INSTANCE_TRANSFER_REMOTE_BYTES) throw new Error(sourceText("error.import.transferRemoteTooLarge"));
    return runCauseEffect(remoteServers.stageInstanceTransfer(serverId, new Uint8Array(await readFile(path))));
  };

  const applyRemote = async (input: ApplyInstanceTransferInput, serverId: string) => {
    requireRemote(serverId);
    const v2 =
      remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_V2_CAPABILITY) &&
      remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_CAPABILITY);
    const result = await runCauseEffect(
      remoteServers.request(
        serverId,
        v2 ? INSTANCE_TRANSFER_V2_ROUTES.apply : INSTANCE_TRANSFER_ROUTES.apply,
        decodeRemoteInstanceTransferResult,
        {
          method: "POST",
          body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
        },
      ),
    );
    return resolveRemoteInstanceTransferResult(
      result,
      await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)),
    );
  };

  const rollback = async (input: RollbackInstanceTransferInput): Promise<RollbackInstanceTransferResult> => {
    if (input.targetServerId === LOCAL_SERVER_ID) return runCauseEffect(instanceTransfer.rollback(input.migrationId));
    if (!resumableTarget(input.targetServerId)) throw new Error(sourceText("error.team.instanceTransferUnsupported"));
    return runCauseEffect(
      remoteServers.request(
        input.targetServerId,
        INSTANCE_TRANSFER_V2_ROUTES.rollback,
        decodeRollbackInstanceTransferResult,
        {
          method: "POST",
          body: { migrationId: input.migrationId },
        },
      ),
    );
  };

  const copyPreview = async (input: CopyInstanceTransferInput): Promise<InstanceTransferPreview> => {
    const sourceLocal = input.sourceServerId === LOCAL_SERVER_ID;
    const targetLocal = input.targetServerId === LOCAL_SERVER_ID;
    if (sourceLocal && targetLocal) throw new Error(sourceText("error.import.transferSameServer"));
    if (!sourceLocal) requireRemote(input.sourceServerId);
    if (!targetLocal) requireRemote(input.targetServerId);
    if (input.mode === "move" && !resumableTarget(input.targetServerId))
      throw new Error(sourceText("error.import.transferMoveUnsupported"));

    return prepareCopy({
      readSource: async () => {
        if (!sourceLocal) {
          const bytes = await runCauseEffect(remoteServers.downloadInstanceTransfer(input.sourceServerId, input));
          return { bytes, warnings: [] };
        }
        // A local export writes a file. It is read once and removed before the target is touched.
        const path = join(app.getPath("temp"), `openbot-copy-${randomUUID()}.zip`);
        try {
          const result = await runCauseEffect(instanceTransfer.exportTo(path, input));
          // A local export can hold 2 GB, but a joined target takes one WebRTC file transfer. Refuse
          // the size before reading the archive into memory.
          if (!targetLocal && (await stat(path)).size > INSTANCE_TRANSFER_REMOTE_BYTES)
            throw new Error(sourceText("error.import.transferRemoteTooLarge"));
          return { bytes: new Uint8Array(await readFile(path)), warnings: result.warnings };
        } finally {
          await rm(path, { force: true });
        }
      },
      remoteTarget: !targetLocal,
      stageRemote: (bytes) => runCauseEffect(remoteServers.stageInstanceTransfer(input.targetServerId, bytes)),
      stageLocal: (bytes) => runCauseEffect(instanceTransfer.stageBytes(bytes)),
      maxRemoteBytes: INSTANCE_TRANSFER_REMOTE_BYTES,
      mode: input.mode,
      resumableTarget: resumableTarget(input.targetServerId),
      retain: (migrationId, bytes) => runCauseEffect(instanceTransfer.keepForMove(migrationId, bytes)),
      discardStaged: async (token) => {
        if (targetLocal) {
          await runCauseEffect(instanceTransfer.discard(token));
          return;
        }
        await runCauseEffect(
          remoteServers.request(input.targetServerId, INSTANCE_TRANSFER_ROUTES.discard, decodeVoid, {
            method: "POST",
            body: { token },
          }),
        );
      },
    });
  };

  /** Archives the held source bytes here, then removes the moved agents from the source. */
  const moveSource = async (input: MoveInstanceSourceInput): Promise<MoveInstanceSourceResult> => {
    const archive = await runCauseEffect(instanceTransfer.archiveMove(input.migrationId));
    if (input.sourceServerId === LOCAL_SERVER_ID) {
      const removed = await runCauseEffect(instanceTransfer.deleteSourceAgents(input.agents));
      return {
        archiveFileName: archive.fileName,
        archiveDirectory: archive.directory,
        movedAgentIds: removed.moved,
        retained: removed.retained,
        warnings: [],
      };
    }
    requireRemote(input.sourceServerId);
    const movedAgentIds: string[] = [];
    const retained: MoveInstanceSourceResult["retained"] = [];
    for (const agent of input.agents) {
      try {
        await runCauseEffect(
          remoteServers.request(input.sourceServerId, TEAM_API_ROUTES.agent.one(agent.id), decodeVoid, {
            method: "DELETE",
          }),
        );
        movedAgentIds.push(agent.id);
      } catch (error) {
        retained.push({
          agentId: agent.id,
          name: agent.name,
          reason: (error instanceof Error ? error.message : "The server could not remove the agent.").slice(0, 500),
        });
      }
    }
    return {
      archiveFileName: archive.fileName,
      archiveDirectory: archive.directory,
      movedAgentIds,
      retained,
      warnings: [],
    };
  };

  return {
    instanceTransfer: {
      summary: scopedQueryHandler({
        local: () => runCauseEffect(instanceTransfer.summary()),
        remote: async (serverId) => {
          requireRemote(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, INSTANCE_TRANSFER_ROUTES.summary, decodeRemoteInstanceTransferSummary, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      export: scopedHandler(parseExportInstanceInput, { local: exportLocal, remote: exportRemote }),
      showExport: handler(() => {
        if (lastExport) shell.showItemInFolder(lastExport);
      }),
      choose: scopedQueryHandler({
        local: async () => {
          const path = await chooseFile();
          return path ? runCauseEffect(instanceTransfer.stage(path)) : null;
        },
        remote: stageRemote,
      }),
      apply: scopedHandler(parseApplyInstanceTransferInput, {
        local: (input) => runCauseEffect(instanceTransfer.apply(input)),
        remote: applyRemote,
      }),
      discard: scopedHandler(stringPayload("token"), {
        local: (token) => Effect.runPromise(instanceTransfer.discard(token)),
        remote: async (token, serverId) => {
          requireRemote(serverId);
          await runCauseEffect(
            remoteServers.request(serverId, INSTANCE_TRANSFER_ROUTES.discard, () => undefined, {
              method: "POST",
              body: { token },
            }),
          );
        },
      }),
      copyPreview: payloadHandler(parseCopyInstanceTransferInput, copyPreview),
      rollback: payloadHandler(parseRollbackInstanceTransferInput, rollback),
      moveSource: payloadHandler(parseMoveInstanceSourceInput, moveSource),
      showArchive: payloadHandler(parseShowInstanceArchiveInput, (input: ShowInstanceArchiveInput) => {
        shell.showItemInFolder(instanceTransfer.archivePath(input.archiveFileName));
      }),
    },
  };
}
