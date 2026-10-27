import { agentProviderName } from "@openbot/contracts/agent-providers";
import type {
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSecretKind,
  InstanceTransferSecretOutcome,
  InstanceTransferSecretSection,
  InstanceTransferSecretsSummary,
  InstanceTransferSummary,
  MoveInstanceSourceResult,
  ServerSummary,
} from "@openbot/contracts/ipc";
import {
  Button,
  Check,
  Checkbox,
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

export type CopySetupMode = "copy" | "move";

export type CopySetupPhase = "choose" | "preparing" | "copying" | "secrets" | "archiving" | "error" | "done";

export type CopySetupStep = "prepare" | "apply" | "secrets" | "archive";

export type CopySetupTarget = Pick<ServerSummary, "id" | "name" | "kind"> & {
  /** Why this server cannot receive the copy, or null when it can. */
  disabledReason: "not-admin" | "no-transfer" | null;
  /** The target records the migration, so it can confirm a move and roll it back. */
  resumable: boolean;
  /** Both sides can seal and open secrets, so the dialog offers the sign-ins it holds. */
  secrets: boolean;
};

export interface CopySetupOptions {
  targetId: string;
  agentIds: string[];
  includeFiles: boolean;
  includeSettings: boolean;
  mode: CopySetupMode;
  /** The secrets to seal for the target: the transferable ones chosen, and every unsupported one. */
  secretIds: string[];
}

export interface CopySetupDialogProps {
  open: boolean;
  /** The server whose setup is copied or moved. */
  sourceName: string;
  summary: InstanceTransferSummary | null;
  summaryError: string | null;
  targets: readonly CopySetupTarget[];
  targetId: string | null;
  mode: CopySetupMode;
  phase: CopySetupPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  /** The secrets this computer holds, without a value. */
  secrets: InstanceTransferSecretsSummary | null;
  secretsError: string | null;
  /** What became of every secret the transfer named, or null when none was sent. */
  secretOutcomes: InstanceTransferSecretOutcome[] | null;
  /** The source archive a confirmed move left, and what could not be removed. */
  move: MoveInstanceSourceResult | null;
  /** Agents removed by a rollback, or null when no rollback ran. */
  rolledBack: number | null;
  rollbackBusy: boolean;
  error: string | null;
  /** Which step failed, so the progress list marks the right one. */
  failedStep: CopySetupStep | null;
  onSelectTarget: (serverId: string) => void;
  onSelectMode: (mode: CopySetupMode) => void;
  onPrepare: (options: CopySetupOptions) => void;
  onRetry: () => void;
  onRollback: () => void;
  onShowArchive: (fileName: string) => void;
  /** Opens the target's settings where a sign-in or key has to be entered again. */
  onReauthenticate: (section: InstanceTransferSecretSection) => void;
  onClose: () => void;
  onDone: () => void;
}

const TARGET_REASON_KEYS = {
  "not-admin": "settings.transfer.copy.targetNeedsAdmin",
  "no-transfer": "settings.transfer.copy.targetNoTransfer",
} as const;

/** Which settings section opens a sign-in of each kind, for the one-click re-auth action. */
const SECRET_KIND_SECTIONS: Record<InstanceTransferSecretKind, InstanceTransferSecretSection> = {
  "provider-key": "providers",
  "provider-sign-in": "providers",
  "custom-provider": "providers",
  "mcp-values": "mcp",
  "mcp-sign-in": "mcp",
  github: "connectors",
  onepassword: "connectors",
  bitwarden: "connectors",
};

const SECRET_SECTION_KEYS = {
  providers: "settings.transfer.copy.openProviders",
  mcp: "settings.transfer.copy.openMcp",
  connectors: "settings.transfer.copy.openConnectors",
} as const;

const SECRET_STATUS_KEYS = {
  transferred: "settings.transfer.copy.secretTransferred",
  "already-present": "settings.transfer.copy.secretAlreadyPresent",
  "target-missing": "settings.transfer.copy.secretTargetMissing",
  failed: "settings.transfer.copy.secretFailed",
} as const;

/**
 * Server switcher > Copy setup to…: pick a server, choose what goes, then watch the steps. Copy
 * keeps the source. Move archives it after the target confirms, then removes the moved agents.
 * The dialog does not know how to transfer; the desktop overlay owns the calls and the cleanup.
 */
export function CopySetupDialog(props: CopySetupDialogProps) {
  const { t } = useText();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [excludedSecrets, setExcludedSecrets] = createSignal<ReadonlySet<string>>(new Set());
  const [files, setFiles] = createSignal(true);
  const [settings, setSettings] = createSignal(true);

  const busy = () =>
    props.phase === "preparing" ||
    props.phase === "copying" ||
    props.phase === "secrets" ||
    props.phase === "archiving";
  const target = () => props.targets.find((server) => server.id === props.targetId) ?? null;
  const selectedTarget = () => target()?.disabledReason === null;
  const agents = () => props.summary?.agents ?? [];
  const selected = createMemo(() => agents().filter((agent) => !excluded().has(agent.id)));
  const targetName = () => target()?.name ?? "";
  const hasSecretStep = () =>
    target()?.secrets === true ||
    props.secrets === null ||
    (props.secrets?.items.length ?? 0) > 0 ||
    props.secretsError !== null;
  const steps = (): readonly CopySetupStep[] => [
    "prepare",
    "apply",
    ...(hasSecretStep() ? ["secrets" as const] : []),
    ...(props.mode === "move" ? ["archive" as const] : []),
  ];
  const selectedSecretIds = () => {
    if (!target()?.secrets) return [];
    return (props.secrets?.items ?? [])
      .filter((item) => !item.transferable || !excludedSecrets().has(item.id))
      .map((item) => item.id);
  };
  const secretsLoading = () => props.secrets === null && props.secretsError === null;

  // A new opening starts with every agent and both optional parts selected.
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setExcluded(new Set<string>());
      setExcludedSecrets(new Set<string>());
      setFiles(true);
      setSettings(true);
    },
  );

  // A target without the migration ledger cannot accept a move. Keep the choice honest.
  createEffect(
    () => target()?.resumable,
    (resumable) => {
      if (resumable === false && props.mode === "move") props.onSelectMode("copy");
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

  function stepStatus(step: CopySetupStep): "pending" | "active" | "done" | "failed" {
    const list = steps();
    const index = list.indexOf(step);
    if (props.phase === "done") return "done";
    if (props.phase === "error") {
      if (!props.failedStep) return "pending";
      const failed = list.indexOf(props.failedStep);
      if (failed === index) return "failed";
      return index < failed ? "done" : "pending";
    }
    const active =
      props.phase === "preparing"
        ? "prepare"
        : props.phase === "copying"
          ? "apply"
          : props.phase === "secrets"
            ? "secrets"
            : props.phase === "archiving"
              ? "archive"
              : null;
    if (!active) return "pending";
    const activeIndex = list.indexOf(active);
    return index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
  }

  const title = () => {
    if (props.phase !== "done") return t("settings.transfer.copy.title");
    if (props.rolledBack !== null) return t("settings.transfer.copy.rolledBackTitle");
    return props.mode === "move" ? t("settings.transfer.copy.moveDoneTitle") : t("settings.transfer.copy.doneTitle");
  };
  const description = () =>
    props.mode === "move"
      ? t("settings.transfer.copy.moveLede")
      : t("settings.transfer.copy.lede", { source: props.sourceName });
  const busyLabel = () => {
    if (props.phase === "archiving") return t("settings.transfer.copy.archiving", { source: props.sourceName });
    if (props.phase === "secrets") return t("settings.transfer.copy.transferringSecrets");
    if (props.phase === "copying") return t("settings.transfer.copy.copying", { name: targetName() });
    return t("settings.transfer.copy.preparing");
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        // Escape or an outside click while the transfer runs would discard a staging the target is using.
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="join-server-backdrop">
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
                  <ProgressList
                    stepStatus={stepStatus}
                    steps={steps()}
                    targetName={targetName()}
                    sourceName={props.sourceName}
                  />
                  <Show when={props.result && props.result.skipped.length > 0}>
                    <Notes
                      title={t("settings.transfer.result.notImported")}
                      notes={props.result?.skipped.map((entry) => `${entry.name}: ${entry.reason}`) ?? []}
                    />
                  </Show>
                  <Show when={props.secretOutcomes && props.secretOutcomes.length > 0}>
                    <SecretOutcomes outcomes={props.secretOutcomes ?? []} onReauthenticate={props.onReauthenticate} />
                  </Show>
                  <Show
                    when={target()?.resumable === true && props.preview?.migrationId && props.failedStep !== "prepare"}
                  >
                    <div class="copy-setup-sign-in">
                      <h3 class="copy-setup-section-title">{t("settings.transfer.copy.rollbackTitle")}</h3>
                      <p class="agent-import-step-note">
                        {t("settings.transfer.copy.rollbackText", { name: targetName() })}
                      </p>
                      <Button type="button" variant="outline" disabled={props.rollbackBusy} onClick={props.onRollback}>
                        {t(
                          props.rollbackBusy
                            ? "settings.transfer.copy.rollbackBusy"
                            : "settings.transfer.copy.rollback",
                        )}
                      </Button>
                    </div>
                  </Show>
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

                <Show when={props.phase === "choose" && props.targets.length > 0}>
                  <h3 class="copy-setup-section-title">{t("settings.transfer.copy.mode")}</h3>
                  <ul class="copy-setup-targets" aria-label={t("settings.transfer.copy.mode")}>
                    <For each={["copy", "move"] as const}>
                      {(mode) => {
                        const resumable = () => target()?.resumable === true;
                        return (
                          <li>
                            <Button
                              type="button"
                              variant={props.mode === mode ? "secondary" : "outline"}
                              class="copy-setup-target"
                              aria-pressed={props.mode === mode ? "true" : "false"}
                              disabled={mode === "move" && !resumable()}
                              onClick={() => props.onSelectMode(mode)}
                            >
                              <span class="copy-setup-target-copy">
                                <span class="copy-setup-target-name">
                                  {t(
                                    mode === "copy"
                                      ? "settings.transfer.copy.modeCopy"
                                      : "settings.transfer.copy.modeMove",
                                  )}
                                </span>
                                <span class="copy-setup-target-kind">
                                  {t(
                                    mode === "copy"
                                      ? "settings.transfer.copy.modeCopyDetail"
                                      : "settings.transfer.copy.modeMoveDetail",
                                  )}
                                </span>
                                <Show when={mode === "move" && !resumable()}>
                                  <span class="copy-setup-target-reason">
                                    {t("settings.transfer.copy.modeMoveUnsupported")}
                                  </span>
                                </Show>
                              </span>
                              <Show when={props.mode === mode}>
                                <Check class="copy-setup-target-check" aria-hidden="true" />
                              </Show>
                            </Button>
                          </li>
                        );
                      }}
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
                  <Show when={hasSecretStep()}>
                    <div class="copy-setup-sign-in">
                      <h3 class="copy-setup-section-title">{t("settings.transfer.copy.secretsTitle")}</h3>
                      <p class="agent-import-step-note">
                        {t(
                          target()?.secrets
                            ? "settings.transfer.copy.secretsDescription"
                            : "settings.transfer.copy.secretsUnsupported",
                        )}
                      </p>
                      <Show when={props.secretsError}>
                        {(error) => (
                          <Alert title={t("settings.transfer.copy.secretsUnavailable")} description={error()} />
                        )}
                      </Show>
                      <Show when={secretsLoading()}>
                        <p class="agent-import-step-note">{t("settings.transfer.copy.secretsLoading")}</p>
                      </Show>
                      <Show when={props.secrets?.items.length}>
                        <ul class="copy-setup-secret-list">
                          <For each={props.secrets?.items ?? []}>
                            {(item) => (
                              <li class="storage-row agent-import-row">
                                <Checkbox
                                  checked={
                                    item.transferable && target()?.secrets === true && !excludedSecrets().has(item.id)
                                  }
                                  disabled={busy() || !item.transferable || target()?.secrets !== true}
                                  aria-label={t("settings.transfer.copy.includeSecret", { name: item.label })}
                                  onChange={(event) => {
                                    const next = new Set(excludedSecrets());
                                    if (event.currentTarget.checked) next.delete(item.id);
                                    else next.add(item.id);
                                    setExcludedSecrets(next);
                                  }}
                                />
                                <span class="storage-row-copy">
                                  <span class="storage-row-title">{item.label}</span>
                                  <span class="storage-row-meta">
                                    {item.transferable && target()?.secrets
                                      ? t("settings.transfer.copy.secretReady")
                                      : t("settings.transfer.copy.secretNeedsSignIn")}
                                  </span>
                                </span>
                                <Show when={item.count > 1}>
                                  <span class="storage-row-size">{item.count}</span>
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </div>
                  </Show>
                  <p class="instance-transfer-not-moved">
                    <TriangleAlert class="instance-transfer-not-moved-icon" aria-hidden="true" />
                    <span>
                      {t(props.mode === "move" ? "settings.transfer.copy.moveNote" : "settings.transfer.notMoved", {
                        source: props.sourceName,
                      })}
                    </span>
                  </p>
                </Show>

                <div class="agent-import-actions instance-transfer-start">
                  <Show
                    when={props.phase === "error"}
                    fallback={
                      <Button
                        type="button"
                        disabled={
                          !selectedTarget() ||
                          !props.summary ||
                          secretsLoading() ||
                          (selected().length === 0 && !settings() && selectedSecretIds().length === 0) ||
                          busy()
                        }
                        onClick={() => {
                          if (!props.targetId) return;
                          props.onPrepare({
                            targetId: props.targetId,
                            agentIds: selected().map((agent) => agent.id),
                            includeFiles: files(),
                            includeSettings: settings(),
                            mode: props.mode,
                            secretIds: selectedSecretIds(),
                          });
                        }}
                      >
                        {t(
                          props.mode === "move" ? "settings.transfer.copy.moveSubmit" : "settings.transfer.copy.submit",
                          { name: targetName() },
                        )}
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

              <Show
                when={
                  props.phase === "preparing" ||
                  props.phase === "copying" ||
                  props.phase === "secrets" ||
                  props.phase === "archiving"
                }
              >
                <ProgressList
                  stepStatus={stepStatus}
                  steps={steps()}
                  targetName={targetName()}
                  sourceName={props.sourceName}
                />
                <Show when={props.preview && props.preview.warnings.length > 0}>
                  <Notes title={t("settings.transfer.result.warnings")} notes={props.preview?.warnings ?? []} />
                </Show>
                <div class="agent-import-actions instance-transfer-start">
                  <Button type="button" variant="ghost" disabled>
                    {busyLabel()}
                  </Button>
                </div>
              </Show>

              <Show when={props.phase === "done"}>
                <Show
                  when={props.rolledBack !== null}
                  fallback={
                    <Show when={props.result}>
                      {(result) => (
                        <>
                          <p class="storage-summary-total agent-import-done" role="status">
                            <CircleCheck class="agent-import-done-icon" aria-hidden="true" />
                            {t(
                              props.mode === "move" ? "settings.transfer.copy.moveDone" : "settings.transfer.copy.done",
                              { name: targetName() },
                            )}
                          </p>
                          <p class="agent-import-lede">
                            {t(
                              props.mode === "move"
                                ? "settings.transfer.copy.moveDoneText"
                                : "settings.transfer.copy.doneText",
                              { name: targetName(), source: props.sourceName },
                            )}
                          </p>
                          <Show when={result().migration?.resumed}>
                            <p class="agent-import-step-note">{t("settings.transfer.copy.resumed")}</p>
                          </Show>
                          <Show when={props.move}>
                            {(move) => (
                              <div class="settings-modal-card copy-setup-archive">
                                <h3 class="copy-setup-section-title">{t("settings.transfer.copy.archiveTitle")}</h3>
                                <p class="copy-setup-archive-name">{move().archiveFileName}</p>
                                <p class="agent-import-step-note">{move().archiveDirectory}</p>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => props.onShowArchive(move().archiveFileName)}
                                >
                                  {t("settings.transfer.copy.showArchive")}
                                </Button>
                              </div>
                            )}
                          </Show>
                          <Show when={props.move && props.move.retained.length > 0}>
                            <Notes
                              title={t("settings.transfer.copy.retainedTitle")}
                              notes={props.move?.retained.map((entry) => `${entry.name}: ${entry.reason}`) ?? []}
                            />
                          </Show>
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
                            <Notes
                              title={t("settings.transfer.result.warnings")}
                              notes={props.preview?.warnings ?? []}
                            />
                          </Show>
                          <Show when={result().warnings.length > 0}>
                            <Notes title={t("settings.transfer.result.warnings")} notes={result().warnings} />
                          </Show>
                          <Show when={props.secretOutcomes && props.secretOutcomes.length > 0}>
                            <SecretOutcomes
                              outcomes={props.secretOutcomes ?? []}
                              onReauthenticate={props.onReauthenticate}
                            />
                          </Show>
                          <Show when={props.secretsError}>
                            {(error) => (
                              <div class="copy-setup-sign-in">
                                <Alert title={t("settings.transfer.copy.secretsUnavailable")} description={error()} />
                                <div class="copy-setup-secret-result">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => props.onReauthenticate("providers")}
                                  >
                                    {t("settings.transfer.copy.openProviders")}
                                  </Button>
                                  <Button type="button" variant="outline" onClick={() => props.onReauthenticate("mcp")}>
                                    {t("settings.transfer.copy.openMcp")}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => props.onReauthenticate("connectors")}
                                  >
                                    {t("settings.transfer.copy.openConnectors")}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </Show>
                          <div class="agent-import-actions instance-transfer-start">
                            <Button type="button" variant="secondary" onClick={() => props.onDone()}>
                              {t("common.done")}
                            </Button>
                          </div>
                        </>
                      )}
                    </Show>
                  }
                >
                  <p class="storage-summary-total agent-import-done" role="status">
                    <CircleCheck class="agent-import-done-icon" aria-hidden="true" />
                    {t("settings.transfer.copy.rolledBackTitle")}
                  </p>
                  <p class="agent-import-lede">
                    {t("settings.transfer.copy.rolledBack", { count: props.rolledBack ?? 0 })}
                  </p>
                  <div class="agent-import-actions instance-transfer-start">
                    <Button type="button" variant="secondary" onClick={() => props.onDone()}>
                      {t("common.done")}
                    </Button>
                  </div>
                </Show>
              </Show>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProgressList(props: {
  stepStatus: (step: CopySetupStep) => "pending" | "active" | "done" | "failed";
  steps: readonly CopySetupStep[];
  targetName: string;
  sourceName: string;
}) {
  const { t } = useText();
  const label = (step: CopySetupStep) => {
    switch (step) {
      case "prepare":
        return t("settings.transfer.copy.stepPrepare");
      case "apply":
        return t("settings.transfer.copy.stepApply", { name: props.targetName });
      case "secrets":
        return t("settings.transfer.copy.stepSecrets");
      case "archive":
        return t("settings.transfer.copy.stepArchive", { source: props.sourceName });
    }
  };
  const detail = (step: CopySetupStep) => {
    switch (step) {
      case "prepare":
        return t("settings.transfer.copy.stepPrepareDetail");
      case "apply":
        return t("settings.transfer.copy.stepApplyDetail", { name: props.targetName });
      case "secrets":
        return t("settings.transfer.copy.stepSecretsDetail");
      case "archive":
        return t("settings.transfer.copy.stepArchiveDetail", { source: props.sourceName });
    }
  };
  return (
    <ol class="copy-setup-progress" aria-label={t("settings.transfer.copy.progress")}>
      <For each={props.steps}>
        {(step) => (
          <li class="copy-setup-step" data-status={props.stepStatus(step)}>
            <span class="copy-setup-step-icon" aria-hidden="true">
              <StepIcon status={props.stepStatus(step)} />
            </span>
            <span class="copy-setup-step-text">
              <span class="copy-setup-step-label">{label(step)}</span>
              <span class="copy-setup-step-detail">{detail(step)}</span>
            </span>
          </li>
        )}
      </For>
    </ol>
  );
}

function SecretOutcomes(props: {
  outcomes: readonly InstanceTransferSecretOutcome[];
  onReauthenticate: (section: InstanceTransferSecretSection) => void;
}) {
  const { t } = useText();
  return (
    <div class="copy-setup-sign-in">
      <h3 class="copy-setup-section-title">{t("settings.transfer.copy.secretsResultTitle")}</h3>
      <ul class="copy-setup-secret-list">
        <For each={props.outcomes}>
          {(outcome) => {
            const needsSignIn = outcome.status === "failed" || outcome.status === "target-missing";
            const section = SECRET_KIND_SECTIONS[outcome.kind];
            return (
              <li class="copy-setup-secret-result">
                <span class="storage-row-copy">
                  <span class="storage-row-title">{outcome.label}</span>
                  <span class="storage-row-meta">{t(SECRET_STATUS_KEYS[outcome.status])}</span>
                  <Show when={outcome.reason}>{(reason) => <span class="storage-row-meta">{reason()}</span>}</Show>
                </span>
                <Show when={needsSignIn}>
                  <Button type="button" variant="outline" onClick={() => props.onReauthenticate(section)}>
                    {t("settings.transfer.copy.reauthenticate", { section: t(SECRET_SECTION_KEYS[section]) })}
                  </Button>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
    </div>
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
