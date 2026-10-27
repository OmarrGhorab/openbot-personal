import type { InstanceTransferPreview, InstanceTransferResult, InstanceTransferSummary } from "@openbot/contracts/ipc";
import {
  CopySetupDialog,
  type CopySetupOptions,
  type CopySetupPhase,
} from "@openbot/ui/features/servers/CopySetupDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, untrack } from "solid-js";
import { canCopyFrom, copyTargetOptions } from "./copy-setup-targets";
import { useServers } from "./servers-context";

interface CopySetupState {
  summary: InstanceTransferSummary | null;
  summaryError: string | null;
  targetId: string | null;
  phase: CopySetupPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  error: string | null;
  failedStep: "prepare" | "apply" | null;
}

const INITIAL: CopySetupState = {
  summary: null,
  summaryError: null,
  targetId: null,
  phase: "choose",
  preview: null,
  result: null,
  error: null,
  failedStep: null,
};

/**
 * Server switcher > Copy setup to…: one dialog over the two servers. Main reads the source and
 * stages on the target; the dialog then applies the token on the target and reports what moved.
 * Nothing on the source is removed.
 */
export function CopySetupOverlay() {
  const { servers, copySetupSourceId, setCopySetupSourceId } = useServers();
  const { t, errorMessage } = useText();
  const calls = window.openbot.instanceTransfer;
  const [state, setState] = createStore<CopySetupState>({ ...INITIAL });
  /** Distinguishes the current copy from an answer that arrived after the dialog closed. */
  let run = 0;

  const source = () => servers().find((server) => server.id === copySetupSourceId()) ?? null;

  const targets = createMemo(() =>
    copyTargetOptions(servers(), copySetupSourceId() ?? "").map(({ server, disabledReason }) => ({
      id: server.id,
      name: server.name,
      kind: server.kind,
      disabledReason,
    })),
  );
  const enabledTargets = createMemo(() => targets().filter((target) => target.disabledReason === null));

  // A new source loads its agents and starts with the first eligible target.
  createEffect(
    () => copySetupSourceId(),
    (sourceId) => {
      if (sourceId === null) return;
      run += 1;
      const current = run;
      setState((draft) => {
        Object.assign(draft, INITIAL);
      });
      const from = untrack(source);
      if (!canCopyFrom(from)) {
        setState((draft) => {
          draft.summaryError = t("error.team.instanceTransferUnsupported");
        });
        return;
      }
      const first = untrack(enabledTargets)[0];
      if (first) {
        setState((draft) => {
          draft.targetId = first.id;
        });
      }
      void calls
        .summary(sourceId)
        .then((summary) => {
          if (current === run) {
            setState((draft) => {
              draft.summary = summary;
            });
          }
        })
        .catch((error: unknown) => {
          if (current !== run) return;
          setState((draft) => {
            draft.summaryError = errorMessage(error, t("settings.transfer.copy.sourceFailed"));
          });
        });
    },
  );

  // A target that left the rail or lost its admin role cannot stay selected.
  createEffect(
    () => enabledTargets(),
    (available) => {
      const selected = untrack(() => state.targetId);
      if (selected !== null && available.some((target) => target.id === selected)) return;
      setState((draft) => {
        draft.targetId = available[0]?.id ?? null;
      });
    },
  );

  // A source that left the rail closes the dialog and discards a staged copy.
  createEffect(
    () => source(),
    (current) => {
      if (current === null && untrack(copySetupSourceId) !== null) close();
    },
  );

  async function discard(token: string, serverId: string): Promise<void> {
    try {
      await calls.discard(token, serverId);
    } catch {
      // The staging expires on its own; a failed cleanup must not hide the copy result.
    }
  }

  function prepare(options: CopySetupOptions): void {
    const from = source();
    if (!from) return;
    const current = ++run;
    setState((draft) => {
      draft.targetId = options.targetId;
      draft.phase = "preparing";
      draft.preview = null;
      draft.result = null;
      draft.error = null;
      draft.failedStep = null;
    });
    void (async () => {
      try {
        const preview = await calls.copyPreview({
          sourceServerId: from.id,
          targetServerId: options.targetId,
          agentIds: options.agentIds,
          includeFiles: options.includeFiles,
          includeSettings: options.includeSettings,
        });
        if (current !== run) {
          await discard(preview.token, options.targetId);
          return;
        }
        setState((draft) => {
          draft.preview = preview;
          draft.phase = "copying";
        });
        try {
          const result = await calls.apply(
            {
              token: preview.token,
              keys: preview.agents.map((agent) => agent.key),
              includeSettings: options.includeSettings,
            },
            options.targetId,
          );
          if (current !== run) return;
          setState((draft) => {
            draft.phase = "done";
            draft.result = result;
          });
        } catch (error) {
          // `apply` consumes a token it reaches. A token that never got there still expires.
          await discard(preview.token, options.targetId);
          if (current !== run) return;
          setState((draft) => {
            draft.phase = "error";
            draft.failedStep = "apply";
            draft.error = errorMessage(error, t("settings.transfer.copy.failed"));
          });
        }
      } catch (error) {
        if (current !== run) return;
        setState((draft) => {
          draft.phase = "error";
          draft.failedStep = "prepare";
          draft.error = errorMessage(error, t("settings.transfer.copy.failed"));
        });
      }
    })();
  }

  function retry(): void {
    if (state.preview && state.targetId) void discard(state.preview.token, state.targetId);
    setState((draft) => {
      draft.phase = "choose";
      draft.preview = null;
      draft.result = null;
      draft.error = null;
      draft.failedStep = null;
    });
  }

  function close(): void {
    run += 1;
    if (state.preview && state.phase !== "done" && state.targetId) void discard(state.preview.token, state.targetId);
    setCopySetupSourceId(null);
  }

  function done(): void {
    run += 1;
    setCopySetupSourceId(null);
  }

  return (
    <CopySetupDialog
      open={source() !== null}
      sourceName={source()?.name ?? ""}
      summary={state.summary}
      summaryError={state.summaryError}
      targets={targets()}
      targetId={state.targetId}
      phase={state.phase}
      preview={state.preview}
      result={state.result}
      error={state.error}
      failedStep={state.failedStep}
      onSelectTarget={(serverId) =>
        setState((draft) => {
          draft.targetId = serverId;
        })
      }
      onPrepare={prepare}
      onRetry={retry}
      onClose={close}
      onDone={done}
    />
  );
}
