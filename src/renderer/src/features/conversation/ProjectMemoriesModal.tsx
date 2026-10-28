import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  PROJECT_MEMORY_KINDS,
  PROJECT_MEMORY_LIMIT,
  type ProjectMemory,
  type ProjectMemoryKind,
  type ProjectMemoryState,
  type ProjectMemoryUndo,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppMessages } from "@openbot/i18n";
import { Button, Dialog, IconButton, Pencil, Plus, RotateCcw, Textarea, Trash2, toast, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";

interface ProjectMemoriesModalProps {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange: (count: number) => void;
}

const KIND_LABEL = {
  rule: "memory.project.kind.rule",
  command: "memory.project.kind.command",
  "known-problem": "memory.project.kind.known-problem",
  decision: "memory.project.kind.decision",
} as const satisfies Record<ProjectMemoryKind, keyof AppMessages>;

/** The message a failed change shows. Each names a key without parameters. */
type ChangeFailure = "memory.saveFailed" | "memory.updateFailed" | "memory.deleteFailed" | "memory.project.undoFailed";

const UNDO_ACTION = {
  create: "memory.project.undoAction.create",
  update: "memory.project.undoAction.update",
  delete: "memory.project.undoAction.delete",
} as const satisfies Record<ProjectMemoryUndo["action"], keyof AppMessages>;

/**
 * The facts that every agent in one project folder shares. The user sees who saved each entry and
 * when, edits or deletes it, and undoes the last change of the folder. Each call goes to this
 * computer; the modal keeps no copy of the entries after it closes.
 */
export function ProjectMemoriesModal(props: ProjectMemoriesModalProps) {
  const { t, format, errorMessage } = useText();
  const [state, setState] = createSignal<ProjectMemoryState | null>(null);
  const [agentNames, setAgentNames] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [addOpen, setAddOpen] = createSignal(false);
  const [newKind, setNewKind] = createSignal<ProjectMemoryKind>("command");
  const [newText, setNewText] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingKind, setEditingKind] = createSignal<ProjectMemoryKind>("command");
  const [editingText, setEditingText] = createSignal("");

  const atLimit = () => {
    const current = state();
    return current !== null && current.memories.length >= current.limit;
  };

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [next, agents] = await Promise.all([
        window.openbot.agent.getProjectMemories({ agentId: props.agentId }),
        window.openbot.agent.listAgents().catch(() => []),
      ]);
      setState(next);
      setAgentNames(new Map(agents.map((agent) => [agent.id, agent.name])));
      props.onCountChange(next.memories.length);
    } catch (caught) {
      setError(errorMessage(caught, t("memory.project.loadFailed")));
    } finally {
      setLoading(false);
    }
  }

  /** Runs one change. It returns true when the folder changed, and shows the error when it did not. */
  async function change(action: () => Promise<ProjectMemoryState>, failure: ChangeFailure): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setState(next);
      props.onCountChange(next.memories.length);
      return true;
    } catch (caught) {
      setError(errorMessage(caught, t(failure)));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addEntry(): Promise<void> {
    const text = newText().trim();
    if (!text) return;
    const saved = await change(
      () => window.openbot.agent.createProjectMemory({ agentId: props.agentId, kind: newKind(), text }),
      "memory.saveFailed",
    );
    if (saved) {
      setNewText("");
      setAddOpen(false);
    }
  }

  function startEditing(memory: ProjectMemory): void {
    setEditingId(memory.id);
    setEditingKind(memory.kind);
    setEditingText(memory.text);
  }

  async function saveEdit(memory: ProjectMemory): Promise<void> {
    const text = editingText().trim();
    if (!text) return;
    const saved = await change(
      () =>
        window.openbot.agent.updateProjectMemory({
          agentId: props.agentId,
          memoryId: memory.id,
          kind: editingKind(),
          text,
        }),
      "memory.updateFailed",
    );
    if (saved) setEditingId(null);
  }

  function remove(memory: ProjectMemory): Promise<boolean> {
    return change(
      () => window.openbot.agent.deleteProjectMemory({ agentId: props.agentId, memoryId: memory.id }),
      "memory.deleteFailed",
    );
  }

  async function undo(): Promise<void> {
    const reverted = await change(
      () => window.openbot.agent.undoProjectMemory({ agentId: props.agentId }),
      "memory.project.undoFailed",
    );
    if (reverted) toast.success(t("memory.project.undone"));
  }

  createEffect(
    () => [props.open, props.agentId] as const,
    ([open]) => {
      if (!open) return;
      setAddOpen(false);
      setNewText("");
      setEditingId(null);
      void untrack(() => load());
    },
  );

  function savedBy(memory: ProjectMemory): string {
    if (memory.savedByAgentId === null) return t("memory.project.savedByUser");
    const name = agentNames().get(memory.savedByAgentId);
    return name ? t("memory.project.savedByAgent", { name }) : t("memory.project.savedByDeleted");
  }

  function metaLine(memory: ProjectMemory): string {
    const parts = [t(KIND_LABEL[memory.kind]), savedBy(memory), formatDate(memory.createdAt, format)];
    if (memory.updatedAt !== memory.createdAt)
      parts.push(t("memory.project.updated", { date: formatDate(memory.updatedAt, format) }));
    return parts.join(" · ");
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="agent-memories-overlay" />
        <Dialog.Content class="agent-memories-modal">
          <header class="agent-memories-header">
            <div class="agent-memories-heading">
              <Dialog.Title>{t("memory.project.title")}</Dialog.Title>
              <Dialog.Description class="sr-only">
                {t("memory.project.description", { path: state()?.projectPath ?? "" })}
              </Dialog.Description>
            </div>
            <div class="agent-memories-header-actions">
              <IconButton
                label={t("memory.project.add")}
                class="agent-memories-add-button"
                variant="ghost"
                disabled={loading() || busy() || atLimit()}
                onClick={() => setAddOpen(true)}
              >
                <Plus />
              </IconButton>
              <IconButton label={t("memory.project.close")} variant="ghost" onClick={() => props.onOpenChange(false)}>
                <X />
              </IconButton>
            </div>
          </header>

          <div class="agent-memories-body">
            <Show when={state()}>
              {(current) => (
                <>
                  <p class="agent-memory-meta">{t("memory.project.description", { path: current().projectPath })}</p>
                  <p class="agent-memory-limit">
                    {t("memory.project.count", { count: current().memories.length, limit: current().limit })}
                  </p>
                </>
              )}
            </Show>
            <Show when={atLimit()}>
              <p class="agent-memory-limit" role="status">
                {t("memory.project.limitReached", { limit: state()?.limit ?? PROJECT_MEMORY_LIMIT })}
              </p>
            </Show>

            <Show when={addOpen()}>
              <section class="agent-memory-composer" aria-label={t("memory.project.add")}>
                <KindChoices value={newKind()} onChange={setNewKind} disabled={busy()} />
                <Textarea
                  class="agent-memory-input"
                  rows="2"
                  maxlength={INPUT_LIMITS.agentMemoryText}
                  placeholder={t("memory.project.newPlaceholder")}
                  value={newText()}
                  aria-label={t("memory.project.newPlaceholder")}
                  onValueChange={setNewText}
                />
                <div class="agent-memory-composer-actions">
                  <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!newText().trim() || busy()}
                    loading={busy()}
                    onClick={() => void addEntry()}
                  >
                    {t("memory.save")}
                  </Button>
                </div>
              </section>
            </Show>

            <Show when={error()}>
              {(message) => (
                <p class="agent-memory-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>

            <Show when={!loading()} fallback={<p class="agent-memory-state">{t("memory.loading")}</p>}>
              <Show
                when={(state()?.memories.length ?? 0) > 0}
                fallback={<p class="agent-memory-state">{t("memory.project.empty")}</p>}
              >
                <ul class="agent-memory-list">
                  <For each={state()?.memories ?? []} keyed={(memory) => memory.id}>
                    {(memory) => (
                      <li class="agent-memory-row">
                        <Show
                          when={editingId() === memory().id}
                          fallback={
                            <>
                              <div class="agent-memory-row-main">
                                <span class="agent-memory-text">{memory().text}</span>
                                <span class="agent-memory-meta">{metaLine(memory())}</span>
                              </div>
                              <IconButton
                                label={t("memory.edit")}
                                variant="ghost"
                                disabled={busy()}
                                onClick={() => startEditing(memory())}
                              >
                                <Pencil />
                              </IconButton>
                              <IconButton
                                label={t("memory.delete")}
                                class="agent-memory-delete-button"
                                variant="destructive-ghost"
                                disabled={busy()}
                                onClick={() => void remove(memory())}
                              >
                                <Trash2 />
                              </IconButton>
                            </>
                          }
                        >
                          <div class="agent-memory-editor">
                            <KindChoices value={editingKind()} onChange={setEditingKind} disabled={busy()} />
                            <Textarea
                              class="agent-memory-input"
                              rows="2"
                              maxlength={INPUT_LIMITS.agentMemoryText}
                              value={editingText()}
                              aria-label={t("memory.edit")}
                              onValueChange={setEditingText}
                            />
                            <div class="agent-memory-editor-actions">
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                                {t("common.cancel")}
                              </Button>
                              <Button
                                size="sm"
                                variant="default"
                                disabled={!editingText().trim() || busy()}
                                loading={busy()}
                                onClick={() => void saveEdit(memory())}
                              >
                                {t("common.save")}
                              </Button>
                            </div>
                          </div>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </div>

          <footer class="agent-memories-footer">
            <Show when={state()?.undo}>
              {(last) => (
                <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void undo()}>
                  <RotateCcw aria-hidden="true" />
                  {t("memory.project.undo")}
                  <span class="agent-memory-meta">
                    {t("memory.project.undoLast", {
                      action: t(UNDO_ACTION[last().action]),
                      date: formatDate(last().changedAt, format),
                    })}
                  </span>
                </Button>
              )}
            </Show>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The four kinds as toggles. Each toggle names its kind, so a screen reader reads the choice. */
function KindChoices(props: {
  value: ProjectMemoryKind;
  onChange: (kind: ProjectMemoryKind) => void;
  disabled: boolean;
}) {
  const { t } = useText();
  return (
    <div class="agent-memory-inclusion-actions">
      <For each={PROJECT_MEMORY_KINDS}>
        {(kind) => (
          <Button
            size="sm"
            variant={props.value === kind ? "default" : "ghost"}
            aria-pressed={props.value === kind ? "true" : "false"}
            disabled={props.disabled}
            onClick={() => props.onChange(kind)}
          >
            {t(KIND_LABEL[kind])}
          </Button>
        )}
      </For>
    </div>
  );
}

function formatDate(value: string, format: AppFormat): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return format.date(date, { dateStyle: "medium" });
}
