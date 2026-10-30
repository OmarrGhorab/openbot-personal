import type { BoardTicketProvider, BoardTicketSyncState, BoardTicketSyncTarget } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, Check, Dialog, Input, RefreshCw, TriangleAlert } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import { TicketsProviderMark } from "./TicketsProviderMark";

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

/** The name of each ticket system, as the Sync dialog and the empty board show it. */
export const PROVIDER_LABEL = {
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
  const [query, setQuery] = createSignal("");
  /** The list is long for an account with many repositories, so it filters as the person types. */
  const visibleProjects = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const list = projects() ?? [];
    return needle ? list.filter((name) => name.toLowerCase().includes(needle)) : list;
  });
  const changed = () => provider() !== target()?.provider || project() !== target()?.project;

  createEffect(provider, (current) => {
    setProjects(null);
    setQuery("");
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
          <Dialog.Content class="tickets-new tickets-sync" as="section">
            <header class="tickets-sync-header">
              <span class="tickets-sync-badge" aria-hidden="true">
                <RefreshCw />
              </span>
              <div class="tickets-sync-heading">
                <Dialog.Title as="h2" class="tickets-new-title">
                  {t("tickets.sync.title")}
                </Dialog.Title>
                <Dialog.Description class="tickets-muted">{t("tickets.sync.description")}</Dialog.Description>
              </div>
            </header>
            <div class="tickets-new-form">
              <section class="tickets-sync-group" aria-label={t("tickets.sync.provider")}>
                <h3 class="tickets-stat-label">{t("tickets.sync.provider")}</h3>
                <div class="tickets-sync-systems">
                  <For each={state()?.providers ?? []}>
                    {(option) => (
                      <Button
                        type="button"
                        variant="outline"
                        class="tickets-sync-system"
                        aria-pressed={provider() === option ? "true" : "false"}
                        disabled={busy() !== null}
                        onClick={() => {
                          if (option === provider()) return;
                          setProvider(option);
                          setProject(null);
                        }}
                      >
                        <TicketsProviderMark provider={option} class="tickets-sync-mark" />
                        <span class="tickets-sync-system-name">{t(PROVIDER_LABEL[option])}</span>
                        <Show when={provider() === option}>
                          <Check aria-hidden="true" class="tickets-sync-check" />
                        </Show>
                      </Button>
                    )}
                  </For>
                </div>
              </section>
              <section class="tickets-sync-group" aria-label={t("tickets.sync.project")}>
                <h3 class="tickets-stat-label">{t("tickets.sync.project")}</h3>
                <Show when={(projects()?.length ?? 0) > 6}>
                  <Input
                    value={query()}
                    placeholder={t("tickets.sync.search")}
                    aria-label={t("tickets.sync.search")}
                    disabled={busy() !== null}
                    onValueChange={setQuery}
                  />
                </Show>
                <Show when={provider() && projects() === null}>
                  <p class="tickets-muted">{t("tickets.sync.loading")}</p>
                </Show>
                <Show when={projects()?.length === 0}>
                  <p class="tickets-muted">{t("tickets.sync.noProjects")}</p>
                </Show>
                <Show when={(projects()?.length ?? 0) > 0}>
                  <div class="tickets-sync-projects">
                    <For
                      each={visibleProjects()}
                      fallback={<p class="tickets-muted tickets-sync-nomatch">{t("tickets.sync.noMatch")}</p>}
                    >
                      {(option) => (
                        <Button
                          type="button"
                          variant="ghost"
                          class="tickets-sync-project"
                          aria-pressed={project() === option ? "true" : "false"}
                          disabled={busy() !== null}
                          onClick={() => setProject(option)}
                        >
                          <TicketsProviderMark provider={provider()} class="tickets-sync-mark" />
                          <span class="tickets-sync-project-name">{option}</span>
                          <Show when={project() === option}>
                            <Check aria-hidden="true" class="tickets-sync-check" />
                          </Show>
                        </Button>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
              <div class="tickets-sync-status" data-failed={state()?.error ? "" : undefined}>
                <Show
                  when={state()?.error}
                  fallback={
                    <>
                      <span
                        class="tickets-sync-dot"
                        data-synced={state()?.lastSyncedAt ? "" : undefined}
                        aria-hidden="true"
                      />
                      <Show when={state()?.lastSyncedAt} fallback={t("tickets.sync.never")}>
                        {(time) =>
                          t("tickets.sync.lastSynced", {
                            time: format.date(new Date(time()), { dateStyle: "medium", timeStyle: "short" }),
                          })
                        }
                      </Show>
                    </>
                  }
                >
                  {(error) => (
                    <>
                      <TriangleAlert aria-hidden="true" />
                      <span>{error()}</span>
                    </>
                  )}
                </Show>
              </div>
              <footer class="tickets-new-actions">
                <Show when={target()}>
                  <Button
                    type="button"
                    variant="ghost"
                    class="tickets-sync-stop"
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
