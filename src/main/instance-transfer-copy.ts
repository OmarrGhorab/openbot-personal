// Direct copy: read the selected agents from one server, then stage the same archive on another.
// The file flow stages on the computer that opened the dialog; a copy has a different target, so the
// bytes are read from the source and handed to the target in one main-process call.

import type { InstanceTransferPreview } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

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
}

/** Reads, checks, and stages one archive. A target that cannot accept the size is refused before upload. */
export async function prepareCopy(options: PrepareCopyOptions): Promise<InstanceTransferPreview> {
  const { bytes, warnings } = await options.readSource();
  if (options.remoteTarget && bytes.byteLength > options.maxRemoteBytes)
    throw new Error(sourceText("error.import.transferRemoteTooLarge"));
  const preview = options.remoteTarget ? await options.stageRemote(bytes) : await options.stageLocal(bytes);
  return { ...preview, warnings: [...warnings, ...preview.warnings] };
}
