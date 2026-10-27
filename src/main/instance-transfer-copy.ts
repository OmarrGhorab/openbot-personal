// Direct copy: read the selected agents from one server, then stage the same archive on another.
// The file flow stages on the computer that opened the dialog; a copy has a different target, so the
// bytes are read from the source and handed to the target in one main-process call.

import type { CopyInstanceTransferMode, InstanceTransferPreview } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { migrationIdFor } from "./instance-transfer-ledger";

interface CopyArchive {
  bytes: Uint8Array;
  /** What the source left out, such as files deleted while the archive was written. */
  warnings: readonly string[];
}

export interface PrepareCopyOptions {
  readSource: () => Promise<CopyArchive>;
  /** The target is a joined server, so one WebRTC file transfer bounds the archive. */
  remoteTarget: boolean;
  stageRemote: (bytes: Uint8Array) => Promise<InstanceTransferPreview>;
  /** Stages on this computer, which keeps the bytes until `apply` or `discard`. */
  stageLocal: (bytes: Uint8Array) => Promise<InstanceTransferPreview>;
  maxRemoteBytes: number;
  mode: CopyInstanceTransferMode;
  /** The target records the migration, so it can confirm a move and roll it back. */
  resumableTarget: boolean;
  /** Holds the source bytes until the target confirms a move. */
  retain?: ((migrationId: string, bytes: Uint8Array) => Promise<void>) | undefined;
  /** Releases a staged token when the move's bytes cannot be held. */
  discardStaged?: ((token: string) => Promise<void>) | undefined;
}

/** Reads, checks, and stages one archive. A target that cannot accept the size is refused before upload. */
export async function prepareCopy(options: PrepareCopyOptions): Promise<InstanceTransferPreview> {
  if (options.mode === "move" && !options.resumableTarget)
    throw new Error(sourceText("error.import.transferMoveUnsupported"));
  const { bytes, warnings } = await options.readSource();
  if (options.remoteTarget && bytes.byteLength > options.maxRemoteBytes)
    throw new Error(sourceText("error.import.transferRemoteTooLarge"));
  const preview = options.remoteTarget ? await options.stageRemote(bytes) : await options.stageLocal(bytes);
  // A v1 target answers no migration id; the preview's keys still name the same migration.
  const migrationId = preview.migrationId ?? migrationIdFor(preview.agents.map((agent) => agent.key));
  if (options.mode === "move") {
    if (!options.retain) throw new Error(sourceText("error.import.transferMoveInvalid"));
    try {
      await options.retain(migrationId, bytes);
    } catch (error) {
      await options.discardStaged?.(preview.token).catch(() => undefined);
      throw error;
    }
  }
  return { ...preview, migrationId, warnings: [...warnings, ...preview.warnings] };
}
