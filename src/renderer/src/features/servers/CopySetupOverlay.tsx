import type {
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSecretOutcome,
  InstanceTransferSecretSection,
  InstanceTransferSecretsSummary,
  InstanceTransferSummary,
  MoveInstanceSourceResult,
} from "@openbot/contracts/ipc";
import {
  CopySetupDialog,
  type CopySetupMode,
  type CopySetupOptions,
  type CopySetupPhase,
  type CopySetupStep,
} from "@openbot/ui/features/servers/CopySetupDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, untrack } from "solid-js";
import { canCopyFrom, copyTargetOptions } from "./copy-setup-targets";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

interface CopySetupState {
  summary: InstanceTransferSummary | null;
  summaryError: string | null;
  secrets: InstanceTransferSecretsSummary | null;
  secretsError: string | null;
  secretOutcomes: InstanceTransferSecretOutcome[] | null;
  targetId: string | null;
  mode: CopySetupMode;
  /** The source agents to remove after a move confirms, by id and name. */
  moveAgents: { id: string; name: string }[];
  phase: CopySetupPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  move: MoveInstanceSourceResult | null;
  rolledBack: number | null;
  rollbackBusy: boolean;
  error: string | null;
  failedStep: CopySetupStep | null;
}

const INITIAL: CopySetupState = {
  summary: null,
  summaryError: null,
  secrets: null,
  secretsError: null,
  secretOutcomes: null,
  targetId: null,
  mode: "copy",
  moveAgents: [],
  phase: "choose",
  preview: null,
  result: null,
  move: null,
  rolledBack: null,
  rollbackBusy: false,
  error: null,
  failedStep: null,
};

/**
 * Server switcher > Copy setup to…: one dialog over the two servers. Main reads the source and
 * stages on the target; the dialog then applies the token on the target and reports what moved.
 * A copy leaves the source untouched. A move archives the source after the target confirms, then
 * removes the moved agents, and a failed run can undo only what this migration created.
 */
export function CopySetupOverlay() {
  const { servers, copySetupSourceId, setCopySetupSourceId } = useServers();
  const { openServerSettings } = useServerSettings();
  const { t, errorMessage } = useText();
  const calls = window.openbot.instanceTransfer;
  const [state, setState] = createStore<CopySetupState>({ ...INITIAL });
  /** Distinguishes the current copy from an answer that arrived after the dialog closed. */
  let run = 0;

  const source = () => servers().find((server) => server.id === copySetupSourceId()) ?? null;

  const targets = createMemo(() =>
    copyTargetOptions(servers(), copySetupSourceId() ?? "").map(({ server, disabledReason, resumable, secrets }) => ({
      id: server.id,
      name: server.name,
      kind: server.kind,
      disabledReason,
      resumable,
      secrets,
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
      void calls
        .secrets(sourceId)
        .then((summary) => {
          if (current === run) {
            setState((draft) => {
              draft.secrets = summary;
            });
          }
        })
        .catch((error: unknown) => {
          if (current !== run) return;
          setState((draft) => {
            draft.secretsError = errorMessage(error, t("settings.transfer.copy.secretsUnavailable"));
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

  async function rollback(): Promise<void> {
    const migrationId = state.preview?.migrationId;
    const targetId = state.targetId;
    if (!migrationId || !targetId) return;
    setState((draft) => {
      draft.rollbackBusy = true;
    });
    try {
      const removed = await calls.rollback({ targetServerId: targetId, migrationId });
      setState((draft) => {
        draft.rollbackBusy = false;
        draft.rolledBack = removed.agents;
        draft.result = null;
        draft.move = null;
        draft.error = null;
        draft.failedStep = null;
        draft.phase = "done";
      });
    } catch (error) {
      setState((draft) => {
        draft.rollbackBusy = false;
        draft.error = errorMessage(error, t("settings.transfer.copy.rollbackFailed"));
      });
    }
  }

  function prepare(options: CopySetupOptions): void {
    const from = source();
    if (!from) return;
    const current = ++run;
    const moveAgents =
      options.mode === "move"
        ? options.agentIds.map((id) => ({
            id,
            name: state.summary?.agents.find((agent) => agent.id === id)?.name ?? id,
          }))
        : [];
    setState((draft) => {
      draft.targetId = options.targetId;
      draft.mode = options.mode;
      draft.moveAgents = moveAgents;
      draft.phase = "preparing";
      draft.preview = null;
      draft.result = null;
      draft.move = null;
      draft.secretOutcomes = null;
      draft.rolledBack = null;
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
          mode: options.mode,
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
          const incomplete = result.skipped.length > 0 || result.agents.length !== preview.agents.length;
          if (options.mode === "move" && incomplete) {
            // The target did not confirm every item, so the source stays as it is. The rollback
            // removes only the agents this migration created.
            setState((draft) => {
              draft.phase = "error";
              draft.failedStep = "apply";
              draft.result = result;
              draft.error = t("settings.transfer.copy.moveIncomplete", { name: targetName(options.targetId) });
            });
            return;
          }
          let secretOutcomes: InstanceTransferSecretOutcome[] = [];
          const selectedTarget = targets().find((target) => target.id === options.targetId);
          const sourceSecrets = state.secrets?.items ?? [];
          if (selectedTarget?.secrets && options.secretIds.length > 0) {
            if (!preview.migrationId) {
              setState((draft) => {
                draft.phase = "error";
                draft.failedStep = "secrets";
                draft.result = result;
                draft.error = t("settings.transfer.copy.secretsMigrationMissing");
              });
              return;
            }
            setState((draft) => {
              draft.phase = "secrets";
              draft.result = result;
            });
            try {
              const transferred = await calls.transferSecrets({
                sourceServerId: from.id,
                targetServerId: options.targetId,
                migrationId: preview.migrationId,
                secretIds: options.secretIds,
              });
              if (current !== run) return;
              secretOutcomes = transferred.outcomes;
            } catch (error) {
              if (current !== run) return;
              setState((draft) => {
                draft.phase = "error";
                draft.failedStep = "secrets";
                draft.result = result;
                draft.error = errorMessage(error, t("settings.transfer.copy.secretsFailed"));
              });
              return;
            }
          } else if (!selectedTarget?.secrets && sourceSecrets.length > 0) {
            const reason = t("settings.transfer.copy.secretsUnsupportedReason");
            secretOutcomes = sourceSecrets.map((item) => ({
              id: item.id,
              kind: item.kind,
              label: item.label,
              status: "failed",
              reason,
            }));
          }
          setState((draft) => {
            draft.secretOutcomes = secretOutcomes;
          });
          if (options.mode === "move") {
            // The target must confirm the same migration the source held bytes for, so a different
            // archive can never delete the source.
            const migrationId = preview.migrationId;
            if (!migrationId || result.migration?.id !== migrationId) {
              setState((draft) => {
                draft.phase = "error";
                draft.failedStep = "apply";
                draft.result = result;
                draft.error = t("settings.transfer.copy.moveIncomplete", { name: targetName(options.targetId) });
              });
              return;
            }
            setState((draft) => {
              draft.phase = "archiving";
              draft.result = result;
            });
            try {
              const moved = await calls.moveSource({
                sourceServerId: from.id,
                migrationId,
                agents: moveAgents,
              });
              if (current !== run) return;
              setState((draft) => {
                draft.phase = "done";
                draft.result = result;
                draft.move = moved;
              });
            } catch (error) {
              if (current !== run) return;
              setState((draft) => {
                draft.phase = "error";
                draft.failedStep = "archive";
                draft.result = result;
                draft.error = errorMessage(error, t("settings.transfer.copy.archiveFailed"));
              });
            }
            return;
          }
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

  function targetName(targetId: string): string {
    return targets().find((target) => target.id === targetId)?.name ?? "";
  }

  function retry(): void {
    if (state.preview && state.targetId) void discard(state.preview.token, state.targetId);
    setState((draft) => {
      draft.phase = "choose";
      draft.preview = null;
      draft.result = null;
      draft.move = null;
      draft.secretOutcomes = null;
      draft.rolledBack = null;
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
      mode={state.mode}
      phase={state.phase}
      preview={state.preview}
      result={state.result}
      secrets={state.secrets}
      secretsError={state.secretsError}
      secretOutcomes={state.secretOutcomes}
      move={state.move}
      rolledBack={state.rolledBack}
      rollbackBusy={state.rollbackBusy}
      error={state.error}
      failedStep={state.failedStep}
      onSelectTarget={(serverId) =>
        setState((draft) => {
          draft.targetId = serverId;
        })
      }
      onSelectMode={(mode) =>
        setState((draft) => {
          draft.mode = mode;
        })
      }
      onPrepare={prepare}
      onRetry={retry}
      onRollback={() => void rollback()}
      onShowArchive={(archiveFileName) => {
        void calls.showArchive({ archiveFileName }).catch(() => undefined);
      }}
      onReauthenticate={(section: InstanceTransferSecretSection) => {
        const targetId = state.targetId;
        if (targetId) openServerSettings(targetId, null, section);
      }}
      onClose={close}
      onDone={done}
    />
  );
}
