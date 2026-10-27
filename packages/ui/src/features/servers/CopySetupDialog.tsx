import { agentProviderName } from "@openbot/contracts/agent-providers";
import type {
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSummary,
  ServerSummary,
} from "@openbot/contracts/ipc";
import {
  Button,
  Check,
  CircleCheck,
  CircleDot,
  Dialog,
  IconButton,
  Spinner,
  SwitchField,
  TriangleAlert,
  X,
} from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  AgentChecklist,
  Alert,
  type ChecklistAgent,
  Notes,
  SetupSummary,
  type Totals,
} from "../transfer/InstanceTransferView";

export type CopySetupPhase = "choose" | "preparing" | "copying" | "error" | "done";

export type CopySetupTarget = Pick<ServerSummary, "id" | "name" | "kind"> & {
  /** Why this server cannot receive the copy, or null when it can. */
  disabledReason: "not-admin" | "no-transfer" | null;
};

export interface CopySetupOptions {
  targetId: string;
  agentIds: string[];
  includeFiles: boolean;
  includeSettings: boolean;
}

export interface CopySetupDialogProps {
  open: boolean;
  /** The server whose setup is copied. */
  sourceName: string;
  summary: InstanceTransferSummary | null;
  summaryError: string | null;
  targets: readonly CopySetupTarget[];
  targetId: string | null;
  phase: CopySetupPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  error: string | null;
  /** Which step failed, so the progress list marks the right one. */
  failedStep: "prepare" | "apply" | null;
  onSelectTarget: (serverId: string) => void;
  onPrepare: (options: CopySetupOptions) => void;
  onRetry: () => void;
  onClose: () => void;
  onDone: () => void;
}

const STEP_KEYS = {
  prepare: {
    label: "settings.transfer.copy.stepPrepare",
    detail: "settings.transfer.copy.stepPrepareDetail",
  },
  apply: {
    label: "settings.transfer.copy.stepApply",
    detail: "settings.transfer.copy.stepApplyDetail",
  },
} as const;

const TARGET_REASON_KEYS = {
  "not-admin": "settings.transfer.copy.targetNeedsAdmin",
  "no-transfer": "settings.transfer.copy.targetNoTransfer",
} as const;

/**
 * Server switcher > Copy setup to…: pick a server, choose what goes, then watch the two steps.
 * The dialog does not know how to copy; the desktop overlay owns the calls and the cleanup.
 */
export function CopySetupDialog(props: CopySetupDialogProps) {
  const { t } = useText();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [files, setFiles] = createSignal(true);
  const [settings, setSettings] = createSignal(true);

  const busy = () => props.phase === "preparing" || props.phase === "copying";
  const target = () => props.targets.find((server) => server.id === props.targetId) ?? null;
  const selectedTarget = () => target()?.disabledReason === null;
  const agents = () => props.summary?.agents ?? [];
  const selected = createMemo(() => agents().filter((agent) => !excluded().has(agent.id)));
  const targetName = () => target()?.name ?? "";

  // A new opening starts with every agent and both optional parts selected.
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setExcluded(new Set<string>());
      setFiles(true);
      setSettings(true);
    },
  );

  const totals = (): Totals => ({
    agents: selected().length,
    skills: selected().reduce((total, agent) => total + agent.skillCount, 0),
    routines: selected().reduce((total, agent) => total + agent.routineCount, 0),
    memories: selected().reduce((total, agent) => total + agent.memoryCount, 0),
    fileBytes: files() ? selected().reduce((total, agent) => total + agent.fileBytes, 0) : null,
    settings: settings(),
  });

  function stepStatus(step: "prepare" | "apply"): "pending" | "active" | "done" | "failed" {
    if (props.phase === "done") return "done";
    if (props.phase === "error") {
      if (props.failedStep === step) return "failed";
      if (step === "apply" && props.failedStep === "prepare") return "pending";
      return step === "prepare" ? "done" : "pending";
    }
    if (props.phase === "preparing") return step === "prepare" ? "active" : "pending";
    if (props.phase === "copying") return step === "prepare" ? "done" : "active";
    return "pending";
  }

  const title = () =>
    props.phase === "done" ? t("settings.transfer.copy.doneTitle") : t("settings.transfer.copy.title");
  const description = () => t("settings.transfer.copy.lede", { source: props.sourceName });

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        // Escape or an outside click while the copy runs would discard a staging the target is using.
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="join-server-backdrop" />
        <Dialog.Content as="section" class="copy-setup-dialog" aria-busy={busy() ? "true" : undefined}>
          <IconButton
            class="join-server-close"
            label={t("common.close")}
            tooltip={t("common.close")}
            variant="ghost"
            disabled={busy()}
            onClick={() => props.onClose()}
          >
            <X />
          </IconButton>
          <div class="copy-setup-content">
            <header class="copy-setup-header">
              <Dialog.Title as="h2" class="copy-setup-title">
                {title()}
              </Dialog.Title>
              <Dialog.Description class="agent-import-lede">{description()}</Dialog.Description>
            </header>

            <Show when={props.phase === "choose" || props.phase === "error"}>
              <Show when={props.summaryError}>
                {(error) => <Alert title={t("settings.transfer.copy.sourceFailed")} description={error()} />}
              </Show>
              <Show when={props.error}>
                {(error) => <Alert title={t("settings.transfer.copy.failed")} description={error()} />}
              </Show>
              <Show when={props.phase === "error"}>
                <ProgressList stepStatus={stepStatus} targetName={targetName()} />
              </Show>
              <Show
                when={props.targets.length > 0}
                fallback={<p class="agent-import-lede">{t("settings.transfer.copy.noTargets")}</p>}
              >
                <h3 class="copy-setup-section-title">{t("settings.transfer.copy.target")}</h3>
                <ul class="copy-setup-targets" aria-label={t("settings.transfer.copy.target")}>
                  <For each={props.targets}>
                    {(server) => (
                      <li>
                        <Button
                          type="button"
                          variant={server.id === props.targetId ? "secondary" : "outline"}
                          class="copy-setup-target"
                          aria-pressed={server.id === props.targetId ? "true" : "false"}
                          disabled={server.disabledReason !== null}
                          onClick={() => props.onSelectTarget(server.id)}
                        >
                          <span class="copy-setup-target-copy">
                            <span class="copy-setup-target-name">{server.name}</span>
                            <span class="copy-setup-target-kind">
                              {t(
                                server.kind === "local"
                                  ? "settings.transfer.copy.thisComputer"
                                  : "settings.transfer.copy.joinedServer",
                              )}
                            </span>
                            <Show when={server.disabledReason}>
                              {(reason) => (
                                <span class="copy-setup-target-reason">{t(TARGET_REASON_KEYS[reason()])}</span>
                              )}
                            </Show>
                          </span>
                          <Show when={server.id === props.targetId}>
                            <Check class="copy-setup-target-check" aria-hidden="true" />
                          </Show>
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <Show
                when={props.summary}
                fallback={
                  <Show when={!props.summaryError}>
                    <p class="agent-import-lede">{t("settings.transfer.loading")}</p>
                  </Show>
                }
              >
                <h3 class="copy-setup-section-title">{t("settings.transfer.copy.summaryLabel")}</h3>
                <SetupSummary totals={totals()} label={t("settings.transfer.copy.summaryLabel")} />
                <AgentChecklist
                  label={t("settings.transfer.copy.agentsLabel")}
                  agents={agents().map(
                    (agent): ChecklistAgent => ({
                      key: agent.id,
                      name: agent.name,
                      avatar: <AgentAvatar agent={agent} class="storage-row-avatar" />,
                      skillCount: agent.skillCount,
                      routineCount: agent.routineCount,
                      memoryCount: agent.memoryCount,
                      fileCount: files() ? agent.fileCount : 0,
                      fileBytes: files() ? agent.fileBytes : 0,
                      nameExists: false,
                    }),
                  )}
                  excluded={excluded()}
                  disabled={busy()}
                  onToggle={(key, include) => {
                    const next = new Set(excluded());
                    if (include) next.delete(key);
                    else next.add(key);
                    setExcluded(next);
                  }}
                />
                <div class="settings-modal-card">
                  <SwitchField
                    class="settings-modal-row"
                    checked={files()}
                    disabled={busy()}
                    onChange={setFiles}
                    label={t("settings.transfer.export.files")}
                    description={t("settings.transfer.export.filesDescription")}
                  />
                  <SwitchField
                    class="settings-modal-row"
                    checked={settings()}
                    disabled={busy()}
                    onChange={setSettings}
                    label={t("settings.transfer.export.settings")}
                    description={t("settings.transfer.export.settingsDescription")}
                  />
                </div>
                <p class="instance-transfer-not-moved">
                  <TriangleAlert class="instance-transfer-not-moved-icon" aria-hidden="true" />
                  <span>{t("settings.transfer.notMoved")}</span>
                </p>
              </Show>

              <div class="agent-import-actions instance-transfer-start">
                <Show
                  when={props.phase === "error"}
                  fallback={
                    <Button
                      type="button"
                      disabled={
                        !selectedTarget() || !props.summary || (selected().length === 0 && !settings()) || busy()
                      }
                      onClick={() => {
                        if (!props.targetId) return;
                        props.onPrepare({
                          targetId: props.targetId,
                          agentIds: selected().map((agent) => agent.id),
                          includeFiles: files(),
                          includeSettings: settings(),
                        });
                      }}
                    >
                      {t("settings.transfer.copy.submit", { name: targetName() })}
                    </Button>
                  }
                >
                  <Button type="button" onClick={() => props.onRetry()}>
                    {t("common.tryAgain")}
                  </Button>
                </Show>
                <Button type="button" variant="ghost" disabled={busy()} onClick={() => props.onClose()}>
                  {t("common.cancel")}
                </Button>
              </div>
            </Show>

            <Show when={props.phase === "preparing" || props.phase === "copying"}>
              <ProgressList stepStatus={stepStatus} targetName={targetName()} />
              <Show when={props.preview && props.preview.warnings.length > 0}>
                <Notes title={t("settings.transfer.result.warnings")} notes={props.preview?.warnings ?? []} />
              </Show>
              <div class="agent-import-actions instance-transfer-start">
                <Button type="button" variant="ghost" disabled>
                  {t(
                    props.phase === "preparing" ? "settings.transfer.copy.preparing" : "settings.transfer.copy.copying",
                    { name: targetName() },
                  )}
                </Button>
              </div>
            </Show>

            <Show when={props.phase === "done" && props.result}>
              {(result) => (
                <>
                  <p class="storage-summary-total agent-import-done" role="status">
                    <CircleCheck class="agent-import-done-icon" aria-hidden="true" />
                    {t("settings.transfer.copy.done", { name: targetName() })}
                  </p>
                  <p class="agent-import-lede">{t("settings.transfer.copy.doneText", { name: targetName() })}</p>
                  <Show when={result().signIn.length > 0}>
                    <div class="copy-setup-sign-in">
                      <h3 class="copy-setup-section-title">{t("settings.transfer.result.signIn")}</h3>
                      <p class="agent-import-step-note">{t("settings.transfer.result.signInText")}</p>
                      <ul class="copy-setup-sign-in-list">
                        <For each={result().signIn}>
                          {(provider) => <li class="instance-transfer-chip">{agentProviderName(provider)}</li>}
                        </For>
                      </ul>
                    </div>
                  </Show>
                  <Show when={result().skipped.length > 0}>
                    <Notes
                      title={t("settings.transfer.result.notImported")}
                      notes={result().skipped.map((entry) => `${entry.name}: ${entry.reason}`)}
                    />
                  </Show>
                  <Show when={props.preview && props.preview.warnings.length > 0}>
                    <Notes title={t("settings.transfer.result.warnings")} notes={props.preview?.warnings ?? []} />
                  </Show>
                  <Show when={result().warnings.length > 0}>
                    <Notes title={t("settings.transfer.result.warnings")} notes={result().warnings} />
                  </Show>
                  <div class="agent-import-actions instance-transfer-start">
                    <Button type="button" variant="secondary" onClick={() => props.onDone()}>
                      {t("common.done")}
                    </Button>
                  </div>
                </>
              )}
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProgressList(props: {
  stepStatus: (step: "prepare" | "apply") => "pending" | "active" | "done" | "failed";
  targetName: string;
}) {
  const { t } = useText();
  return (
    <ol class="copy-setup-progress" aria-label={t("settings.transfer.copy.progress")}>
      <For each={["prepare", "apply"] as const}>
        {(step) => (
          <li class="copy-setup-step" data-status={props.stepStatus(step)}>
            <span class="copy-setup-step-icon" aria-hidden="true">
              <StepIcon status={props.stepStatus(step)} />
            </span>
            <span class="copy-setup-step-text">
              <span class="copy-setup-step-label">{t(STEP_KEYS[step].label, { name: props.targetName })}</span>
              <span class="copy-setup-step-detail">{t(STEP_KEYS[step].detail, { name: props.targetName })}</span>
            </span>
          </li>
        )}
      </For>
    </ol>
  );
}

function StepIcon(props: { status: "pending" | "active" | "done" | "failed" }) {
  return (
    <Show when={props.status !== "active"} fallback={<Spinner />}>
      <Show when={props.status !== "done"} fallback={<CircleCheck />}>
        <Show when={props.status !== "failed"} fallback={<TriangleAlert />}>
          <CircleDot />
        </Show>
      </Show>
    </Show>
  );
}
