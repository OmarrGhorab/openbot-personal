import type { BoardTicketProvider, BoardTicketSyncState, BoardTicketSyncTarget } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, buttonVariants, Dialog, DropdownMenu, RefreshCw } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";

/** The sync controls of the Tickets page. The page shows them only while a ticket system is connected. */
export interface TicketsSyncControls {
  /** Null until it loads. */
  state: BoardTicketSyncState | null;
  /** The repositories or projects of the system. Null when they could not be read. */
  onLoadProjects: (provider: BoardTicketProvider) => Promise<string[] | null>;
  /** Saves the target and imports its issues, or stops the sync with null. True when it worked. */
  onSetTarget: (target: BoardTicketSyncTarget | null) => Promise<boolean>;
  /** Imports the open issues of the target now. True when it worked. */
  onSyncNow: () => Promise<boolean>;
}

const PROVIDER_LABEL = {
  github: "tickets.sync.provider.github",
  jira: "tickets.sync.provider.jira",
  linear: "tickets.sync.provider.linear",
} as const satisfies Record<BoardTicketProvider, AppTextKey>;

type SyncAction = "save" | "sync" | "stop";

/**
 * The Sync dialog: the ticket system, the repository or project of the board, the last sync and its
 * failure. Save and sync imports the open issues at once; Sync now imports them again; Stop sync keeps the
 * tickets and ends the sync.
 */
export function TicketsSyncDialog(props: { sync: TicketsSyncControls; onClose: () => void }) {
  const { t, format } = useText();
  const state = () => props.sync.state;
  const target = () => state()?.target ?? null;
  const [provider, setProvider] = createSignal<BoardTicketProvider | null>(
    untrack(() => props.sync.state?.target?.provider ?? props.sync.state?.providers[0] ?? null),
  );
  const [project, setProject] = createSignal<string | null>(untrack(() => props.sync.state?.target?.project ?? null));
  const [projects, setProjects] = createSignal<string[] | null>(null);
  const [busy, setBusy] = createSignal<SyncAction | null>(null);
  const changed = () => provider() !== target()?.provider || project() !== target()?.project;

  createEffect(provider, (current) => {
    setProjects(null);
    if (!current) return;
    let live = true;
    void props.sync.onLoadProjects(current).then((list) => {
      if (live) setProjects(list ?? []);
    });
    return () => {
      live = false;
    };
  });

  async function run(action: SyncAction, work: () => Promise<boolean>): Promise<void> {
    if (busy()) return;
    setBusy(action);
    const done = await work();
    setBusy(null);
    if (done && action !== "sync") props.onClose();
  }

  function save(): void {
    const system = provider();
    const name = project();
    if (!system || !name) return;
    void run("save", () => props.sync.onSetTarget({ provider: system, project: name }));
  }

  return (
    <Dialog.Root
      open={true}
      onOpenChange={(open) => {
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content class="tickets-new" as="section">
            <header class="tickets-new-header">
              <Dialog.Title as="h2" class="tickets-new-title">
                {t("tickets.sync.title")}
              </Dialog.Title>
              <Dialog.Description class="tickets-muted">{t("tickets.sync.description")}</Dialog.Description>
            </header>
            <div class="tickets-new-form">
              <div class="tickets-new-agent">
                <span class="tickets-stat-label">{t("tickets.sync.provider")}</span>
                <DropdownMenu.Root placement="bottom-start" gutter={4}>
                  <DropdownMenu.Trigger
                    class={buttonVariants({ variant: "outline", size: "sm" })}
                    aria-label={t("tickets.sync.provider")}
                    disabled={busy() !== null}
                  >
                    <Show when={provider()} fallback={t("tickets.sync.choose")}>
                      {(current) => t(PROVIDER_LABEL[current()])}
                    </Show>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content>
                      <DropdownMenu.RadioGroup
                        value={provider() ?? ""}
                        onChange={(value: string) => {
                          const next = state()?.providers.find((candidate) => candidate === value);
                          if (!next || next === provider()) return;
                          setProvider(next);
                          setProject(null);
                        }}
                      >
                        <For each={state()?.providers ?? []}>
                          {(option) => (
                            <DropdownMenu.RadioItem value={option} closeOnSelect>
                              {t(PROVIDER_LABEL[option])}
                            </DropdownMenu.RadioItem>
                          )}
                        </For>
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              <div class="tickets-new-agent">
                <span class="tickets-stat-label">{t("tickets.sync.project")}</span>
                <DropdownMenu.Root placement="bottom-start" gutter={4}>
                  <DropdownMenu.Trigger
                    class={buttonVariants({ variant: "outline", size: "sm" })}
                    aria-label={t("tickets.sync.project")}
                    disabled={busy() !== null || !projects()?.length}
                  >
                    {project() ?? t("tickets.sync.choose")}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content>
                      <DropdownMenu.RadioGroup value={project() ?? ""} onChange={(value: string) => setProject(value)}>
                        <For each={projects() ?? []}>
                          {(option) => (
                            <DropdownMenu.RadioItem value={option} closeOnSelect>
                              {option}
                            </DropdownMenu.RadioItem>
                          )}
                        </For>
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              <Show when={provider() && projects() === null}>
                <p class="tickets-muted">{t("tickets.sync.loading")}</p>
              </Show>
              <Show when={projects()?.length === 0}>
                <p class="tickets-muted">{t("tickets.sync.noProjects")}</p>
              </Show>
              <p class="tickets-muted">
                <Show when={state()?.lastSyncedAt} fallback={t("tickets.sync.never")}>
                  {(time) =>
                    t("tickets.sync.lastSynced", {
                      time: format.date(new Date(time()), { dateStyle: "medium", timeStyle: "short" }),
                    })
                  }
                </Show>
              </p>
              <Show when={state()?.error}>{(error) => <p class="tickets-muted">{error()}</p>}</Show>
              <footer class="tickets-new-actions">
                <Show when={target()}>
                  <Button
                    type="button"
                    variant="ghost"
                    loading={busy() === "stop"}
                    disabled={busy() !== null}
                    onClick={() => void run("stop", () => props.sync.onSetTarget(null))}
                  >
                    {t("tickets.sync.stop")}
                  </Button>
                </Show>
                <Button type="button" variant="ghost" disabled={busy() !== null} onClick={props.onClose}>
                  {t("common.close")}
                </Button>
                <Show
                  when={target() && !changed()}
                  fallback={
                    <Button
                      type="button"
                      loading={busy() === "save"}
                      disabled={!provider() || !project() || busy() !== null}
                      onClick={save}
                    >
                      {t("tickets.sync.save")}
                    </Button>
                  }
                >
                  <Button
                    type="button"
                    loading={busy() === "sync"}
                    disabled={busy() !== null}
                    onClick={() => void run("sync", props.sync.onSyncNow)}
                  >
                    <RefreshCw aria-hidden="true" />
                    {t("tickets.sync.now")}
                  </Button>
                </Show>
              </footer>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
